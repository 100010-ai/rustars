/**
 * DEPRECATED — replaced by src/lib/fragment-api.ts
 */

export async function buyStarsOnFragment(username: string, starsCount: number) {
  const { getStarsInvoice } = await import('../lib/fragment-api');
  return getStarsInvoice(username, starsCount);
}

export async function closeBrowser() {
  // No-op — Puppeteer removed
}
