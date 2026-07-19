/**
 * TON Wallet — отправка транзакций через @ton/ton + Circuit Breaker.
 *
 * SECURITY:
 *   - Все ключи строго из process.env
 *   - Circuit Breaker: max 30 TON per tx, max 150 TON daily
 *   - Валидация адреса перед отправкой
 *   - Логирование каждой транзакции
 */

import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { toNano, Address, beginCell } from '@ton/core';

// ═══════════════════════════════════════════════════════════
// WALLET INITIALIZATION
// ═══════════════════════════════════════════════════════════

let walletContract: WalletContractV4 | null = null;
let walletKeyPair: { publicKey: Buffer; secretKey: Buffer } | null = null;

async function getWallet() {
  if (walletContract && walletKeyPair) return { walletContract, walletKeyPair };

  const mnemonic = process.env.MY_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error('MY_WALLET_MNEMONIC not configured');

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error(`MNEMONIC must be 24 words, got ${words.length}`);
  }

  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

  walletContract = wallet;
  walletKeyPair = keyPair;

  console.log(`[Wallet] Initialized: ${wallet.address.toString()}`);
  return { walletContract, walletKeyPair };
}

function getTonClient(): TonClient {
  const apiKey = process.env.TONCENTER_API_KEY;
  if (!apiKey) throw new Error('TONCENTER_API_KEY not configured');

  return new TonClient({
    endpoint: 'https://toncenter.com',
    apiKey,
  });
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

export async function getWalletAddress(): Promise<string> {
  const { walletContract } = await getWallet();
  return walletContract.address.toString();
}

export async function getWalletBalance(): Promise<bigint> {
  const { walletContract } = await getWallet();
  const client = getTonClient();
  return client.getBalance(walletContract.address);
}

export async function hasEnoughBalance(requiredTon: string): Promise<boolean> {
  try {
    const balance = await getWalletBalance();
    const required = toNano(requiredTon);
    const gasReserve = toNano('0.05'); // запас на газ
    return balance > required + gasReserve;
  } catch (err) {
    console.error('[Wallet] Balance check failed:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════
// CIRCUIT BREAKER
// ═══════════════════════════════════════════════════════════

const MAX_PER_TX = 30;        // TON за одну транзакцию
const MAX_DAILY = 150;        // TON за сутки

interface CircuitState {
  /** Траты за текущие сутки */
  dailySpent: number;
  /** Дата последнего сброса (YYYY-MM-DD) */
  lastReset: string;
  /** Пауза при превышении лимита */
  isPaused: boolean;
}

const circuit: CircuitState = {
  dailySpent: 0,
  lastReset: new Date().toISOString().split('T')[0],
  isPaused: false,
};

function resetDailyIfNeeded(): void {
  const today = new Date().toISOString().split('T')[0];
  if (circuit.lastReset !== today) {
    console.log(`[Circuit Breaker] Daily reset: ${circuit.dailySpent} TON spent yesterday`);
    circuit.dailySpent = 0;
    circuit.lastReset = today;
    circuit.isPaused = false;
  }
}

function checkCircuitBreaker(amountTon: number): { ok: boolean; reason?: string } {
  resetDailyIfNeeded();

  // Проверка на паузу
  if (circuit.isPaused) {
    return { ok: false, reason: 'Circuit breaker PAUSED — daily limit exceeded' };
  }

  // Проверка на одну транзакцию
  if (amountTon > MAX_PER_TX) {
    const reason = `Single TX limit exceeded: ${amountTon} TON > ${MAX_PER_TX} TON`;
    console.error(`[Circuit Breaker] REJECTED — ${reason}`);
    return { ok: false, reason };
  }

  // Проверка на суточный лимит
  const newTotal = circuit.dailySpent + amountTon;
  if (newTotal > MAX_DAILY) {
    circuit.isPaused = true;
    const reason = `Daily limit exceeded: ${newTotal.toFixed(2)} TON > ${MAX_DAILY} TON`;
    console.error(`[Circuit Breaker] PAUSED — ${reason}`);
    return { ok: false, reason };
  }

  return { ok: true };
}

function trackSpending(amountTon: number): void {
  circuit.dailySpent += amountTon;
  console.log(
    `[Circuit Breaker] Spent: ${amountTon} TON | Daily: ${circuit.dailySpent.toFixed(2)}/${MAX_DAILY} TON | Remaining: ${(MAX_DAILY - circuit.dailySpent).toFixed(2)} TON`
  );
}

// ═══════════════════════════════════════════════════════════
// ADDRESS VALIDATION
// ═══════════════════════════════════════════════════════════

function validateAddress(address: string): void {
  try {
    const parsed = Address.parse(address);
    if (parsed.workChain !== 0) {
      throw new Error(`Invalid workChain: ${parsed.workChain}`);
    }
  } catch (err) {
    throw new Error(`Invalid TON address: ${address} — ${err instanceof Error ? err.message : err}`);
  }
}

// ═══════════════════════════════════════════════════════════
// SEND TON WITH PAYLOAD
// ═══════════════════════════════════════════════════════════

export async function sendTonWithPayload(
  toAddress: string,
  amountTon: string,
  payload: string,
): Promise<string> {
  const amountNum = parseFloat(amountTon);

  // ── Step 1: Circuit Breaker check ──
  const circuitCheck = checkCircuitBreaker(amountNum);
  if (!circuitCheck.ok) {
    throw new Error(`CIRCUIT_BREAKER: ${circuitCheck.reason}`);
  }

  // ── Step 2: Validate destination address ──
  validateAddress(toAddress);

  // ── Step 3: Validate amount ──
  if (!isFinite(amountNum) || amountNum <= 0) {
    throw new Error(`Invalid amount: ${amountTon}`);
  }

  // ── Step 4: Validate payload ──
  if (!payload || payload.length === 0) {
    throw new Error('Empty payload — Fragment requires a unique comment');
  }

  // ── Step 5: Check balance ──
  const balanceOk = await hasEnoughBalance(amountTon);
  if (!balanceOk) {
    const balance = await getWalletBalance();
    throw new Error(
      `Insufficient balance: need ${amountTon} TON + gas, have ${(Number(balance) / 1e9).toFixed(4)} TON`
    );
  }

  // ── Step 6: Build and send transaction ──
  const { walletContract, walletKeyPair } = await getWallet();
  const client = getTonClient();
  const contract = client.open(walletContract);
  const seqno = await contract.getSeqno();

  const amountNano = toNano(amountTon);
  const destAddress = Address.parse(toAddress);

  // Payload: hex string → Cell
  const payloadHex = payload.startsWith('0x') ? payload.slice(2) : payload;
  const payloadBuf = Buffer.from(payloadHex, 'hex');
  const body = beginCell()
    .storeBuffer(payloadBuf)
    .endCell();

  // Internal message: 0x18 = bounceable
  const msg = beginCell()
    .storeUint(0x18, 6)            // flags
    .storeAddress(null)             // src (wallet)
    .storeAddress(destAddress)      // dest (Fragment)
    .storeCoins(amountNano)         // amount
    .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1) // init + body flags
    .storeBit(false)                // no init
    .storeBit(true)                 // has body
    .storeMaybeRef(body)            // payload cell
    .endCell();

  // Sign transaction
  const tx = walletContract.createTransfer({
    seqno,
    secretKey: walletKeyPair.secretKey,
    messages: [msg as any],
  });

  // ── Step 7: Send ──
  console.log(
    `[Wallet] Sending ${amountTon} TON to ${toAddress}\n` +
    `  Payload: ${payload.slice(0, 32)}...\n` +
    `  Seqno: ${seqno}`
  );

  await contract.send(tx);

  // ── Step 8: Track spending ──
  trackSpending(amountNum);

  const txRef = `tx-${seqno}-${Date.now()}`;
  console.log(`[Wallet] TX sent: ${txRef}`);

  return txRef;
}
