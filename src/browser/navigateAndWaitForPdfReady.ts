import { Page, HTTPResponse } from 'puppeteer';
import config from '../common/config';
import { apiLogger } from '../common/logging';

const DEFAULT_TIMEOUT = 120_000;

export async function navigateAndWaitForPdfReady(
  page: Page,
  url: string,
  options?: { timeout?: number },
): Promise<HTTPResponse | null> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  if (!config.pdfReadinessEnabled) {
    const response = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout,
    });
    await page.waitForNetworkIdle({ idleTime: 1000 });
    return response;
  }

  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout,
  });

  let contractV1Detected = false;
  try {
    await page.waitForSelector('#root[data-pdf-readiness-contract="v1"]', {
      timeout: config.pdfReadinessCapabilityDetectionMs,
    });
    contractV1Detected = true;
  } catch {
    // v1 marker not found within detection window
  }

  if (contractV1Detected) {
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        if (document.getElementById('crc-pdf-generator-err')) return true;
        if (document.getElementById('report-error')) return true;
        return root?.getAttribute('data-pdf-ready') === 'true';
      },
      { timeout },
    );

    const errorState = await page.evaluate(() => {
      const appError = document.getElementById('crc-pdf-generator-err');
      if (appError) return appError.innerText;
      const templateError = document.getElementById('report-error');
      if (templateError) return templateError.innerText;
      return null;
    });

    if (errorState) {
      throw new Error(`Page render error: ${errorState}`);
    }

    return response;
  }

  if (config.pdfReadinessFallbackNetworkIdle) {
    apiLogger.info(
      '[pdf-readiness] v1 contract not detected, falling back to networkidle',
    );
    // TODO: metrics.pdfReadinessFallbackTotal.inc()
    await page.waitForNetworkIdle({ idleTime: 1000, timeout });
  }

  return response;
}
