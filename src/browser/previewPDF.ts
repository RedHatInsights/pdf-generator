import type { Page } from 'puppeteer';
import { pageHeight, pageWidth, setWindowProperty } from './helpers';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import { apiLogger } from '../common/logging';
import { cluster } from '../server/cluster';
import { BROWSER_TIMEOUT } from '../common/constants';

const previewPdf = async (url: string): Promise<Buffer> => {
  const pdf = await cluster.execute(async ({ page }: { page: Page }) => {
    try {
      page.on('console', (msg) =>
        apiLogger.debug(`[Headless log] ${msg.text()}`),
      );
      await page.setViewport({ width: pageWidth, height: pageHeight });

      await setWindowProperty(
        page,
        'customPuppeteerParams',
        JSON.stringify({
          puppeteerParams: {
            pageWidth,
            pageHeight,
          },
        }),
      );

      const extraHeaders: Record<string, string> = {};
      if (process.env.MOCK_TOKEN) {
        extraHeaders['Authorization'] = process.env.MOCK_TOKEN;
      }
      await page.setCookie({
        name: 'cs_jwt',
        value: 'bar',
        domain: 'localhost',
      });
      await page.setExtraHTTPHeaders(extraHeaders);

      const pageStatus = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: BROWSER_TIMEOUT,
      });

      if (!pageStatus?.ok()) {
        throw new Error(
          `Puppeteer error while loading the react app: ${pageStatus?.statusText()}`,
        );
      }

      await page.waitForNetworkIdle({
        idleTime: 1000,
        timeout: BROWSER_TIMEOUT,
      });

      const { headerTemplate, footerTemplate } = getHeaderAndFooterTemplates();

      return await page.pdf({
        format: 'a4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        margin: {
          top: '54px',
          bottom: '54px',
        },
        timeout: BROWSER_TIMEOUT,
      });
    } finally {
      try {
        await page.close();
      } catch {
        // page may already be closed
      }
    }
  });

  return Buffer.from(pdf as Uint8Array);
};

export default previewPdf;
