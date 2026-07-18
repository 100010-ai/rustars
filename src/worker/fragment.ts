/**
 * Fragment — автоматизация покупки звёзд через Puppeteer-Extra + Stealth.
 *
 * Используем puppeteer-extra с плагином stealth для обхода
 * Cloudflare anti-bot на fragment.com. Прокси и user-agent
 * настраиваются через переменные окружения.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';
import path from 'path';

puppeteer.use(StealthPlugin());

const FRAGMENT_URL = 'https://fragment.com';
const SESSION_DIR = path.resolve(__dirname, '../../fragment-session');

export interface FragmentInvoice {
  address: string;
  amountTon: string;
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

  // Прокси: формат http://user:pass@host:port или socks5://host:port
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

  // User-Agent из env или дефолтный реалистичный
  const ua =
    process.env.FRAGMENT_USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

  await page.setUserAgent(ua);

  // Реалистичные viewport и lang
  await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

  // Эмуляция реальных движений мыши
  page.mouse.move = async (x: number, y: number, options?: { steps?: number }) => {
    const steps = options?.steps || 10;
    for (let i = 0; i < steps; i++) {
      const stepX = x * ((i + 1) / steps);
      const stepY = y * ((i + 1) / steps);
      await page.mouse.move(stepX, stepY);
    }
  };

  return page;
}

/**
 * Случайная задержка для имитации поведения человека.
 */
function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Покупает звёзды на Fragment и возвращает инвойс-адрес + сумму.
 */
export async function buyStarsOnFragment(
  username: string,
  starsCount: number,
): Promise<FragmentInvoice> {
  const page = await getPage();

  try {
    // Навигация с задержкой
    await page.goto(`${FRAGMENT_URL}/stars`, { waitUntil: 'networkidle2', timeout: 30000 });
    await humanDelay(1500, 3000);

    // Проверяем, нет ли Cloudflare challenge
    const content = await page.content();
    if (content.includes('Checking your browser') || content.includes('cf-browser-verification')) {
      throw new Error('Cloudflare challenge detected — retry with different proxy');
    }

    // Вводим @username с имитацией набора
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

    await starsInput.click({ clickCount: 3 }); // выделить всё
    await humanDelay(200, 400);
    await starsInput.type(String(starsCount), { delay: 60 + Math.random() * 60 });
    await humanDelay(1500, 2500);

    // Кликаем кнопку покупки
    const buyButton = await page.waitForSelector(
      'button:has-text("Buy"), button:has-text("Purchase"), button:has-text("Pay")',
      { timeout: 5000 },
    );
    if (!buyButton) throw new Error('Buy button not found');

    await buyButton.click();
    await humanDelay(3000, 5000);

    // Парсим инвойс
    const pageContent = await page.content();

    // TON-адрес (EQ... или UQ..., 48 символов base64url)
    const addressMatch = pageContent.match(/(E[A-Za-z0-9_-]{46,48})/);
    if (!addressMatch) {
      throw new Error('Could not parse TON invoice address from Fragment');
    }

    // Сумма TON
    const amountMatch = pageContent.match(/(\d+\.?\d*)\s*TON/i);
    if (!amountMatch) {
      throw new Error('Could not parse TON amount from Fragment');
    }

    return {
      address: addressMatch[1],
      amountTon: amountMatch[1],
    };
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
