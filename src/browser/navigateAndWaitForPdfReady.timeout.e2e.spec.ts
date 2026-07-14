import puppeteer, { Browser, Page } from 'puppeteer';
import http from 'http';
import { navigateAndWaitForPdfReady } from './navigateAndWaitForPdfReady';
import { startFixtureServer } from './fixtures/readiness-harness/server';

describe('navigateAndWaitForPdfReady timeout (browser integration)', () => {
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

  it('times out when v1 contract present but ready never set', async () => {
    await expect(
      navigateAndWaitForPdfReady(page, `${baseUrl}/hang`, { timeout: 5000 }),
    ).rejects.toThrow(/exceeded|timeout/i);
  });
});
