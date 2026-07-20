/**
 * DEPRECATED — replaced by src/lib/fragment-api.ts
 */

export async function buyPremiumOnFragment(username: string, duration: '3m' | '6m' | '12m') {
  const { getPremiumInvoice } = await import('../lib/fragment-api');
  return getPremiumInvoice(username, duration);
}

export async function closeBrowser() {
  // No-op — Puppeteer removed
}
