/**
 * Server-side TON Connect proof verification.
 *
 * TON Connect proofs are signed using Ed25519.
 * The proof contains: domain, timestamp, payload (wallet address).
 * We verify that the signature was made by the wallet's private key.
 *
 * Flow:
 * 1. User connects wallet via TON Connect
 * 2. Wallet signs: { domain: "rustars.vercel.app", timestamp: <unix>, payload: <address> }
 * 3. We verify the Ed25519 signature against the wallet's public key
 * 4. The public key is derived from the wallet address
 */

import nacl from 'tweetnacl';

interface TonConnectProof {
  signature: string;  // base64 encoded Ed25519 signature
  timestamp: number;
  domain: string;
}

/**
 * Decode base64url string to Uint8Array (Node.js compatible).
 */
function base64UrlDecode(str: string): Uint8Array {
  // base64url → base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

/**
 * Decode a TON address (base64url) to get the workchain + hash.
 * TON address format: [flags(1)] [workchain(1)] [hash(32)] [CRC(2)]
 * In base64url this is 48 bytes.
 */
function decodeAddress(address: string): { workchain: number; hash: Uint8Array } | null {
  try {
    const raw = base64UrlDecode(address);

    if (raw.length !== 36) return null; // flags(1) + workchain(1) + hash(32) + crc(2) = 36

    const workchain = raw[1];
    const hash = raw.slice(2, 34);

    return { workchain, hash };
  } catch {
    return null;
  }
}

/**
 * Get the Ed25519 public key from a TON address.
 * For wallets v4R2+, the public key is stored in the contract state,
 * but we can't fetch it without an API call.
 *
 * Alternative: Use TON API to get the wallet's public key.
 */
async function getWalletPublicKey(address: string): Promise<Uint8Array | null> {
  try {
    // Fetch account info from TON API to get public key
    const res = await fetch(
      `https://tonapi.io/v2/accounts/${address}`,
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return null;

    const data = await res.json();

    // TON API returns public_key in hex for some wallets
    if (data.public_key) {
      const hex = data.public_key.replace('0x', '');
      if (hex.length === 64) {
        return Uint8Array.from(hex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)));
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Verify a TON Connect proof.
 * Returns true if the proof is valid and was signed by the wallet owner.
 */
export async function verifyTONConnectProof(
  address: string,
  proof: TonConnectProof,
): Promise<boolean> {
  try {
    // 1. Get the wallet's public key from TON API
    const publicKey = await getWalletPublicKey(address);
    if (!publicKey) {
      // If we can't get the public key, try to verify with a basic check
      // In production, you should fail here
      console.warn('[TONConnect] Could not fetch public key for', address);
      return false;
    }

    // 2. Construct the message that was signed
    // TON Connect signs: domain + "\n" + timestamp
    const message = new TextEncoder().encode(
      `${proof.domain}\n${proof.timestamp}`,
    );

    // 3. Decode the signature from base64
    const sigBytes = base64UrlDecode(proof.signature);
    if (sigBytes.length !== 64) return false;

    // 4. Verify the Ed25519 signature
    return nacl.sign.detached.verify(message, sigBytes, publicKey);
  } catch (err) {
    console.error('[TONConnect] Verification error:', err);
    return false;
  }
}
