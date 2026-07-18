/**
 * TON — отправка транзакций через @ton/ton.
 *
 * Использует мастер-кошелёк с сид-фразой для автоматической
 * закупки звёзд на Fragment.
 */

import { TonClient, WalletContractV4, internal } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { toNano } from '@ton/core';

const TON_ENDPOINT = 'https://toncenter.com/api/v2/json-rpc';

let wallet: WalletContractV4 | null = null;
let client: TonClient | null = null;

async function getWallet(): Promise<{ wallet: WalletContractV4; key: any }> {
  if (wallet) {
    // Ключ кэшируется, но нужен для каждой транзакции
    const mnemonic = process.env.TON_WALLET_MNEMONIC!.split(' ');
    const key = await mnemonicToPrivateKey(mnemonic);
    return { wallet, key };
  }

  const mnemonic = process.env.TON_WALLET_MNEMONIC!.split(' ');
  const key = await mnemonicToPrivateKey(mnemonic);

  client = new TonClient({ endpoint: TON_ENDPOINT });
  wallet = WalletContractV4.create({ publicKey: key.publicKey });

  return { wallet, key };
}

export interface SendResult {
  txHash: string;
  success: boolean;
  error?: string;
}

/**
 * Отправляет TON на указанный адрес (инвойс Fragment).
 */
export async function sendTon(
  toAddress: string,
  amountTon: string,
): Promise<SendResult> {
  try {
    const { wallet: w, key } = await getWallet();
    const contract = client!.open(w);

    const seqno = await contract.getSeqno();

    await contract.sendTransfer({
      seqno,
      secretKey: key.secretKey,
      messages: [
        internal({
          to: toAddress,
          value: toNano(amountTon),
        }),
      ],
    });

    // Ждём подтверждения (до 30 секунд)
    let confirmed = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const info = await contract.getSeqno();
      if (info > seqno) {
        confirmed = true;
        break;
      }
    }

    if (!confirmed) {
      return {
        txHash: 'pending',
        success: false,
        error: 'Transaction not confirmed within 30s',
      };
    }

    // Хэш формируется из seqno + wallet address
    const txHash = `${w.address}-${seqno}`;

    return { txHash, success: true };
  } catch (err) {
    return {
      txHash: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
