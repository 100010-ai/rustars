/**
 * Startup validation — fail fast if critical env vars are missing.
 *
 * Called ONCE at application boot. If any required variable is missing,
 * the app refuses to start. This prevents silent misconfiguration
 * that could lead to security bypasses.
 */

const REQUIRED_VARS = [
  'MY_WALLET_MNEMONIC',
  'MY_WALLET_ADDRESS',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'YOOKASSA_SHOP_ID',
  'YOOKASSA_SECRET_KEY',
  'ADMIN_BOT_TOKEN',
  'ADMIN_CHAT_ID',
  'TELEGRAM_WEBHOOK_SECRET',
  'ADMIN_SECRET',
  'CRON_SECRET',
  'TONCENTER_API_KEY',
] as const;

const RECOMMENDED_VARS = [
  'TELEGRAM_MINIAPP_BOT_TOKEN',
  'SUPPORT_BOT_TOKEN',
] as const;

let validated = false;

export function validateEnvironment(): void {
  if (validated) return;

  const missing: string[] = [];
  const missingRecommended: string[] = [];

  for (const v of REQUIRED_VARS) {
    if (!process.env[v]) missing.push(v);
  }

  for (const v of RECOMMENDED_VARS) {
    if (!process.env[v]) missingRecommended.push(v);
  }

  if (missing.length > 0) {
    const msg = `FATAL: Missing required env vars: ${missing.join(', ')}`;
    console.error(`[Security] ${msg}`);
    throw new Error(msg);
  }

  if (missingRecommended.length > 0) {
    console.warn(`[Security] WARNING: Missing recommended env vars: ${missingRecommended.join(', ')}`);
  }

  // Validate wallet mnemonic format
  const mnemonic = process.env.MY_WALLET_MNEMONIC!;
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error(`FATAL: MY_WALLET_MNEMONIC must be 24 words, got ${words.length}`);
  }

  // Validate admin secret is not default
  if (process.env.ADMIN_SECRET === 'generate_random_secret_here') {
    throw new Error('FATAL: ADMIN_SECRET must be changed from default value');
  }

  if (process.env.CRON_SECRET === 'generate_random_secret_here') {
    throw new Error('FATAL: CRON_SECRET must be changed from default value');
  }

  validated = true;
  console.log(`[Security] Environment validated OK — ${REQUIRED_VARS.length} required vars present`);
}
