/**
 * Fragment Premium — автоматизация покупки Telegram Premium.
 *
 * Fragment позволяет купить Premium подписку для другого пользователя.
 * Парсим со страницы Fragment:
 *   1. Адрес кошелька
 *   2. Сумму TON
 *   3. Payload (хэш-комментарий)
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

const FRAGMENT_URL = 'https://fragment.com';

export interface FragmentPremiumInvoice {
  address: string;
  amountTon: string;
  payload: string;
}

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
  ];
  const proxyUrl = process.env.FRAGMENT_PROXY_URL;
  if (proxyUrl) args.push(`--proxy-server=${proxyUrl}`);
  browser = await puppeteer.launch({ headless: true, args });
  return browser;
}

async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const page = await b.newPage();
  const ua = process.env.FRAGMENT_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  await page.setUserAgent(ua);
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  return page;
}

function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Парсит инвойс со страницы Fragment (адрес + сумма + payload).
 */
async function parseInvoiceFromPage(page: Page): Promise<{ address: string; amountTon: string; payload: string }> {
  const content = await page.content();

  const addressMatch = content.match(/(E[A-Za-z0-9_-]{46,48})/);
  if (!addressMatch) throw new Error('Could not parse TON address from Fragment');
  const amountMatch = content.match(/(\d+\.?\d*)\s*TON/i);
  if (!amountMatch) throw new Error('Could not parse TON amount from Fragment');

  let payload = '';
  const payloadDataMatch = content.match(/data-payload="([^"]+)"/i);
  if (payloadDataMatch) payload = payloadDataMatch[1];
  if (!payload) {
    const m = content.match(/name="payload"[^>]*value="([^"]+)"/i);
    if (m) payload = m[1];
  }
  if (!payload) {
    const m = content.match(/"payload"\s*:\s*"([^"]+)"/i);
    if (m) payload = m[1];
  }
  if (!payload) {
    const m = content.match(/payload[=:]\s*([a-fA-F0-9]{32,})/i);
    if (m) payload = m[1];
  }
  if (!payload) {
    const url = page.url();
    const m = url.match(/payload[=:]([^&]+)/i);
    if (m) payload = decodeURIComponent(m[1]);
  }
  if (!payload) throw new Error('Could not parse payload from Fragment');

  return { address: addressMatch[1], amountTon: amountMatch[1], payload };
}

/**
 * Покупает Telegram Premium на Fragment.
 * @param username - юзернейм получателя
 * @param duration - '3m' | '6m' | '12m'
 */
export async function buyPremiumOnFragment(
  username: string,
  duration: '3m' | '6m' | '12m',
): Promise<FragmentPremiumInvoice> {
  const page = await getPage();

  try {
    // Переходим на страницу Premium
    await page.goto(`${FRAGMENT_URL}/premium`, { waitUntil: 'networkidle2', timeout: 30000 });
    await humanDelay(1500, 3000);

    const content = await page.content();
    if (content.includes('Checking your browser') || content.includes('cf-browser-verification')) {
      throw new Error('Cloudflare challenge detected');
    }

    // Вводим username
    const usernameInput = await page.waitForSelector(
      'input[placeholder*="username"], input[name="username"]',
      { timeout: 15000 },
    );
    if (!usernameInput) throw new Error('Username input not found');
    await usernameInput.click();
    await humanDelay(300, 600);
    await usernameInput.type(username, { delay: 50 + Math.random() * 80 });
    await humanDelay(1000, 2000);

    // Выбираем срок подписки
    // Fragment показывает кнопки: 3 months, 6 months, 1 year
    const durationMap: Record<string, string[]> = {
      '3m': ['3 months', '3 мес'],
      '6m': ['6 months', '6 мес'],
      '12m': ['1 year', '1 год', '12 months', '12 мес'],
    };

    const durationLabels = durationMap[duration] || durationMap['3m'];
    for (const label of durationLabels) {
      // Puppeteer не поддерживает :has-text — используем page.evaluate
      const clicked = await page.evaluate((text) => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const btn = buttons.find((b) => b.textContent?.includes(text));
        if (btn) { btn.click(); return true; }
        return false;
      }, label);
      if (clicked) {
        await humanDelay(500, 1000);
        break;
      }
    }

    await humanDelay(1500, 2500);

    // Кликаем Buy (Puppeteer не поддерживает :has-text — используем evaluate)
    const buyClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const patterns = ['Buy', 'Purchase', 'Pay', 'Купить'];
      const btn = buttons.find((b) => patterns.some((p) => b.textContent?.includes(p)));
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!buyClicked) throw new Error('Buy button not found');
    await humanDelay(3000, 5000);

    // Парсим инвойс
    return await parseInvoiceFromPage(page);
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}
