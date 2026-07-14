import puppeteer, { Browser, Page } from 'puppeteer';
import http from 'http';
import { navigateAndWaitForPdfReady } from './navigateAndWaitForPdfReady';
import { startFixtureServer } from './fixtures/readiness-harness/server';

describe('navigateAndWaitForPdfReady (browser integration)', () => {
  let browser: Browser;
  let page: Page;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: process.env.PDF_E2E_HEADLESS !== 'false',
      args: ['--no-sandbox', '--disable-gpu'],
    });
  });

  afterAll(async () => {
    await browser?.close();
  });

  beforeEach(async () => {
    const fixture = await startFixtureServer();
    server = fixture.server;
    baseUrl = fixture.baseUrl;
    page = await browser.newPage();
    await page.setCacheEnabled(false);
    page.on('console', (msg) => {
      process.stdout.write(`[headless] ${msg.text()}\n`);
    });
  });

  afterEach(async () => {
    await page?.close().catch(() => {});
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  it('waits through 2500ms silent gap for batch 2', async () => {
    await navigateAndWaitForPdfReady(page, `${baseUrl}/`);

    const ready = await page.$eval('#root', (el) =>
      el.getAttribute('data-pdf-ready'),
    );
    const text = await page.$eval('#root', (el) => el.textContent);

    expect(ready).toBe('true');
    expect(text).toContain('BATCH-2-MARKER');
  });

  it('waits for fonts and images after consumer commit before ready', async () => {
    await navigateAndWaitForPdfReady(page, `${baseUrl}/`);

    const readyAt = await page.evaluate(
      () => (window as unknown as Record<string, number>).__readyTimestamp,
    );
    const callbackAt = await page.evaluate(
      () => (window as unknown as Record<string, number>).__callbackTimestamp,
    );
    const fontLoadedAt = await page.evaluate(
      () => (window as unknown as Record<string, number>).__fontTimestamp,
    );

    expect(callbackAt).toBeLessThanOrEqual(fontLoadedAt);
    expect(readyAt).toBeGreaterThanOrEqual(fontLoadedAt);
  });
});
