import { Page, HTTPResponse } from 'puppeteer';

const DEFAULT_TIMEOUT = 120_000;

export async function navigateAndWaitForPdfReady(
  page: Page,
  url: string,
  options?: { timeout?: number },
): Promise<HTTPResponse | null> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const response = await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout,
  });
  await page.waitForNetworkIdle({ idleTime: 1000 });
  return response;
}
