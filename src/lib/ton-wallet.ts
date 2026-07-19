/**
 * TON Wallet — отправка транзакций через @ton/ton.
 *
 * Отправляет TON на указанный адрес с payload-комментарием из Fragment.
 */

import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { toNano, Address, beginCell, Cell } from '@ton/core';

let walletContract: WalletContractV4 | null = null;
let walletKeyPair: { publicKey: Buffer; secretKey: Buffer } | null = null;

async function getWallet() {
  if (walletContract && walletKeyPair) return { walletContract, walletKeyPair };

  const mnemonic = process.env.MY_WALLET_MNEMONIC;
  if (!mnemonic) throw new Error('MY_WALLET_MNEMONIC not set');

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) throw new Error('MNEMONIC must be 24 words');

  const keyPair = await mnemonicToPrivateKey(words);
  const wallet = WalletContractV4.create({ workchain: 0, publicKey: keyPair.publicKey });

  walletContract = wallet;
  walletKeyPair = keyPair;

  return { walletContract, walletKeyPair };
}

export async function getWalletAddress(): Promise<string> {
  const { walletContract } = await getWallet();
  return walletContract.address.toString();
}

export async function getWalletBalance(): Promise<bigint> {
  const { walletContract } = await getWallet();
  const client = new TonClient({
    endpoint: 'https://toncenter.com',
    apiKey: process.env.TONCENTER_API_KEY,
  });
  return client.getBalance(walletContract.address);
}

/**
 * Проверяет, хватает ли TON на кошельке для оплаты.
 */
export async function hasEnoughBalance(requiredTon: string): Promise<boolean> {
  try {
    const balance = await getWalletBalance();
    const required = toNano(requiredTon);
    const minGas = toNano('0.05');
    return balance > required + minGas;
  } catch {
    return false;
  }
}

/**
 * Отправляет TON на указанный адрес с payload-комментарием из Fragment.
 *
 * @param toAddress   — адрес продавца (из инвойса Fragment)
 * @param amountTon   — сумма TON (из инвойса Fragment)
 * @param payload     — уникальный хэш-комментарий из Fragment (НЕ username!)
 */
export async function sendTonWithPayload(
  toAddress: string,
  amountTon: string,
  payload: string,
): Promise<string> {
  const { walletContract, walletKeyPair } = await getWallet();

  const client = new TonClient({
    endpoint: 'https://toncenter.com',
    apiKey: process.env.TONCENTER_API_KEY,
  });

  const contract = client.open(walletContract);
  const seqno = await contract.getSeqno();
  const amount = toNano(amountTon);
  const destAddress = Address.parse(toAddress);

  // Payload из Fragment — это hex-строка, декодируем в байты
  const payloadHex = payload.startsWith('0x') ? payload.slice(2) : payload;
  const payloadBuf = Buffer.from(payloadHex, 'hex');
  const body = beginCell()
    .storeBuffer(payloadBuf)
    .endCell();

  const msg = beginCell()
    .storeUint(0x18, 6)
    .storeAddress(null)
    .storeAddress(destAddress)
    .storeCoins(amount)
    .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
    .storeBit(false)
    .storeBit(true)
    .storeMaybeRef(body)
    .endCell();

  const tx = walletContract.createTransfer({
    seqno,
    secretKey: walletKeyPair.secretKey,
    messages: [msg as any],
  });

  await contract.send(tx);
  return `tx-${seqno}-${Date.now()}`;
}

/**
 * Конвертирует hex-строку в Uint8Array (не используется, оставлен для справки).
 */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
  }
  return bytes;
}
