/**
 * Fragment — автоматизация покупки звёзд через Puppeteer-Extra + Stealth.
 *
 * Парсим со страницы Fragment:
 *   1. TON-адрес продавца (куда отправить TON)
 *   2. Сумму TON
 *   3. Payload (уникальный хэш-комментарий для подтверждения покупки)
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

const FRAGMENT_URL = 'https://fragment.com';

export interface FragmentInvoice {
  /** Адрес продавца на Fragment */
  address: string;
  /** Сумма TON для оплаты */
  amountTon: string;
  /**
   * Payload — уникальный хэш-комментарий, который Fragment привязывает к платежу.
   * Без него Fragment не засчитает оплату.
   */
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
  if (proxyUrl) {
    args.push(`--proxy-server=${proxyUrl}`);
  }

  browser = await puppeteer.launch({ headless: true, args });
  return browser;
}

async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const page = await b.newPage();

  const ua =
    process.env.FRAGMENT_USER_AGENT ||
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
 * Парсит страницу Fragment и извлекает:
 *   - TON-адрес
 *   - Сумму TON
 *   - Payload (уникальный хэш для подтверждения)
 */
async function parseInvoiceFromPage(page: Page): Promise<FragmentInvoice> {
  const content = await page.content();

  // Извлекаем TON-адрес (EQ... или UQ..., base64url)
  const addressMatch = content.match(/(E[A-Za-z0-9_-]{46,48})/);
  if (!addressMatch) {
    throw new Error('Could not parse TON address from Fragment page');
  }

  // Извлекаем сумму TON
  const amountMatch = content.match(/(\d+\.?\d*)\s*TON/i);
  if (!amountMatch) {
    throw new Error('Could not parse TON amount from Fragment page');
  }

  // Извлекаем payload (уникальный хэш-комментарий)
  // Fragment показывает payload в формате hex или base64
  // Ищем в data-атрибутах, скрытых инпутах или тексте на странице
  let payload = '';

  // Способ 1: data-атрибуты
  const payloadDataMatch = content.match(/data-payload="([^"]+)"/i);
  if (payloadDataMatch) {
    payload = payloadDataMatch[1];
  }

  // Способ 2: скрытые инпуты
  if (!payload) {
    const payloadInputMatch = content.match(/name="payload"[^>]*value="([^"]+)"/i);
    if (payloadInputMatch) {
      payload = payloadInputMatch[1];
    }
  }

  // Способ 3: текст на странице (hex payload)
  if (!payload) {
    const payloadTextMatch = content.match(/payload[:\s]*([a-fA-F0-9]{32,})/i);
    if (payloadTextMatch) {
      payload = payloadTextMatch[1];
    }
  }

  // Способ 4: JSON в скрипте
  if (!payload) {
    const jsonPayloadMatch = content.match(/"payload"\s*:\s*"([^"]+)"/i);
    if (jsonPayloadMatch) {
      payload = jsonPayloadMatch[1];
    }
  }

  // Способ 5: Fragment использует текстовый инвойс (plain text comment)
  // Ищем строку вида "Stars for @username" или уникальный идентификатор
  if (!payload) {
    const commentMatch = content.match(/(?:comment|memo|description)["\s:]+([A-Za-z0-9_-]{8,})/i);
    if (commentMatch) {
      payload = commentMatch[1];
    }
  }

  // Если payload не найден, пробуем получить из URL/параметров
  if (!payload) {
    const currentUrl = page.url();
    const urlPayloadMatch = currentUrl.match(/payload[=:]([^&]+)/i);
    if (urlPayloadMatch) {
      payload = decodeURIComponent(urlPayloadMatch[1]);
    }
  }

  if (!payload) {
    throw new Error('Could not parse payload from Fragment page — Fragment may have changed their UI');
  }

  return {
    address: addressMatch[1],
    amountTon: amountMatch[1],
    payload,
  };
}

/**
 * Покупает звёзды на Fragment:
 *   1. Переходит на fragment.com/stars
 *   2. Вводит username и количество
 *   3. Нажимает Buy
 *   4. Парсит адрес, сумму и payload из.invoice
 */
export async function buyStarsOnFragment(
  username: string,
  starsCount: number,
): Promise<FragmentInvoice> {
  const page = await getPage();

  try {
    await page.goto(`${FRAGMENT_URL}/stars`, { waitUntil: 'networkidle2', timeout: 30000 });
    await humanDelay(1500, 3000);

    const content = await page.content();
    if (content.includes('Checking your browser') || content.includes('cf-browser-verification')) {
      throw new Error('Cloudflare challenge detected');
    }

    // Вводим @username
    const usernameInput = await page.waitForSelector(
      'input[placeholder*="username"], input[name="username"]',
      { timeout: 15000 },
    );
    if (!usernameInput) throw new Error('Username input not found');
    await usernameInput.click();
    await humanDelay(300, 600);
    await usernameInput.type(username, { delay: 50 + Math.random() * 80 });
    await humanDelay(1000, 2000);

    // Вводим количество звёзд
    const starsInput = await page.waitForSelector(
      'input[placeholder*="stars"], input[name="count"], input[type="number"]',
      { timeout: 5000 },
    );
    if (!starsInput) throw new Error('Stars count input not found');
    await starsInput.click({ clickCount: 3 });
    await humanDelay(200, 400);
    await starsInput.type(String(starsCount), { delay: 60 + Math.random() * 60 });
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

    // Парсим инвойс (адрес + сумма + payload)
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
