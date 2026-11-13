import type { Page } from 'puppeteer';
import { pageHeight, pageWidth, setWindowProperty } from './helpers';
import config from '../common/config';
import { getDevMockToken } from '../common/devMockToken';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import { apiLogger } from '../common/logging';
import { cluster } from '../server/cluster';
import { BROWSER_TIMEOUT } from '../common/constants';
import { trackRequests, waitForPageReady } from './pageReady';

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
      const mockToken = getDevMockToken(!!config?.IS_PRODUCTION);
      if (mockToken) {
        extraHeaders['Authorization'] = mockToken;
      }
      await page.setCookie({
        name: 'cs_jwt',
        value: 'bar',
        domain: 'localhost',
      });
      await page.setExtraHTTPHeaders(extraHeaders);

      // Same readiness flow as clusterTask.ts: no network-idle tail on goto.
      const requests = trackRequests(page);
      const pageStatus = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: BROWSER_TIMEOUT,
      });

      if (!pageStatus?.ok()) {
        throw new Error(
          `Puppeteer error while loading the react app: ${pageStatus?.statusText()}`,
        );
      }

      await waitForPageReady(page, requests);

      const { headerTemplate, footerTemplate } = getHeaderAndFooterTemplates();

      return await page.pdf({
        format: 'a4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        // Match /v2/create (see clusterTask.ts) so previews render the same way.
        tagged: false,
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
