import puppeteer from 'puppeteer';

import { PdfRequestBody } from '../common/types';
import { apiLogger } from '../common/logging';
import PdfCache, { PdfStatus } from '../common/pdfCache';
import { UpdateStatus } from '../server/utils';
import cluster from '../server/cluster';
import { Page } from 'puppeteer';
import pageTask from '../server/pageTask';

let cachedBrowser;
let cachedPage;

export const generatePdf = async (
  {
    url,
    identity,
    fetchDataParams,
    landscape = false,
    uuid: componentId,
    authHeader,
    authCookie,
  }: PdfRequestBody,
  collectionId: string,
  order: number,
): Promise<void> => {
  try {
    if (process.env['SINGLE_MODE'] === 'true') {
      const browser = await (async () => {
        if (!cachedBrowser) {
          cachedBrowser = await puppeteer.launch({
            headless: false,
            devtools: true,
          });
        }

        return cachedBrowser;
      })();
      const page = await (async () => {
        if (!cachedPage) {
          cachedPage = await browser.newPage();
        }

        return cachedPage;
      })();

      await pageTask(
        {
          url,
          identity,
          fetchDataParams,
          landscape,
          uuid: componentId,
          authHeader,
          authCookie,
        } as PdfRequestBody,
        collectionId,
        order,
        { page },
      );
    } else {
      (await cluster()).queue(async ({ page }: { page: Page }) => {
        return await pageTask(
          {
            url,
            identity,
            fetchDataParams,
            landscape,
            uuid: componentId,
            authHeader,
            authCookie,
          } as PdfRequestBody,
          collectionId,
          order,
          { page },
        );
      });
    }
  } catch (error: unknown) {
    // Catch any errors that escape the cluster queue (e.g., cluster shutdown, browser crash)
    // This prevents unhandled rejections when generatePdf is called without await
    apiLogger.error(
      `generatePdf outer catch for ${componentId}:`,
      JSON.stringify(error),
    );
    const updated = {
      collectionId,
      status: PdfStatus.Failed,
      filepath: '',
      componentId: componentId,
      order: order,
      error: JSON.stringify(error),
    };
    await UpdateStatus(updated);
    PdfCache.getInstance().invalidateCollection(
      collectionId,
      JSON.stringify(error),
    );
  }
};
