import os from 'os';
import { PdfRequestBody } from '../common/types';
import { apiLogger } from '../common/logging';
import { pageHeight, pageWidth, setWindowProperty } from './helpers';
import PdfCache, { PdfStatus } from '../common/pdfCache';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import config from '../common/config';
import { uploadPDF } from '../common/objectStore';
import { UpdateStatus, isValidPageResponse } from '../server/utils';
import { PdfGenerationError } from '../server/errors';
import { cluster } from '../server/cluster';
import { Page } from 'puppeteer';
import { PDFDocument } from 'pdf-lib';

// Match the timeout on the gateway
const BROWSER_TIMEOUT = 60_000;

const getNewPdfName = (id: string) => {
  const pdfFilename = `report_${id}.pdf`;
  return `${os.tmpdir()}/${pdfFilename}`;
};

export const generatePdf = async (
  {
    url,
    identity,
    fetchDataParams,
    uuid: componentId,
    authHeader,
    authCookie,
  }: PdfRequestBody,
  collectionId: string,
  order: number
): Promise<void> => {
  const pdfPath = getNewPdfName(componentId);
  await cluster.queue(async ({ page }: { page: Page }) => {
    const updateMessage = {
      status: PdfStatus.Generating,
      filepath: '',
      order: order,
      componentId: componentId,
      collectionId,
    };
    await UpdateStatus(updateMessage);
    await page.setViewport({ width: pageWidth, height: pageHeight });
    // Enables console logging in Headless mode - handy for debugging components
    page.on('console', (msg) => apiLogger.info(`[Headless log] ${msg.text()}`));

    await setWindowProperty(
      page,
      'customPuppeteerParams',
      JSON.stringify({
        puppeteerParams: {
          pageWidth,
          pageHeight,
        },
      })
    );

    const extraHeaders: Record<string, string> = {};
    if (identity) {
      extraHeaders['x-rh-identity'] = identity;
    }

    if (fetchDataParams) {
      extraHeaders[config?.OPTIONS_HEADER_NAME] =
        JSON.stringify(fetchDataParams);
    }

    if (authHeader) {
      extraHeaders[config.AUTHORIZATION_CONTEXT_KEY] = authHeader;
    }

    if (authCookie) {
      await page.setCookie({
        name: config.JWT_COOKIE_NAME,
        value: authCookie,
        // We might have to change the domain to match the proxy
        domain: 'localhost',
      });
    }

    await page.setExtraHTTPHeaders(extraHeaders);

    const pageResponse = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: BROWSER_TIMEOUT,
    });
    // wait for subsequent network requests to finish
    await page.waitForNetworkIdle({
      idleTime: 1000,
    });
    // because a cached response is a 3xx, puppeteer counts cache as an error
    // so we don't use pageResponse.ok()
    const pageStatus = pageResponse?.status();

    // get the error from DOM if it exists
    const error = await page.evaluate(() => {
      const elem = document.getElementById('crc-pdf-generator-err');
      if (elem) {
        return elem.innerText;
      }
    });

    // error happened during page rendering
    if (error && error.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let response: any;
      try {
        // error should be JSON
        response = JSON.parse(error);
        apiLogger.debug(response.data);
      } catch {
        // fallback to initial error value
        response = error;
        apiLogger.debug(`Page render error ${response}`);
      }
      const updated = {
        collectionId,
        status: PdfStatus.Failed,
        filepath: '',
        componentId: componentId,
        error: response,
        order: order,
      };
      UpdateStatus(updated);
      PdfCache.getInstance().invalidateCollection(collectionId, response);
      throw new PdfGenerationError(
        collectionId,
        componentId,
        `Page render error: ${response}`
      );
    }
    if (!pageStatus || !isValidPageResponse(pageStatus)) {
      apiLogger.debug(`Page status: ${pageResponse?.statusText()}`);
      const updated = {
        collectionId,
        status: PdfStatus.Failed,
        filepath: '',
        componentId: componentId,
        order: order,
        error: pageResponse?.statusText() || 'Page status not found',
      };
      UpdateStatus(updated);
      PdfCache.getInstance().invalidateCollection(
        collectionId,
        pageResponse?.statusText() || 'Page status not found'
      );
      throw new PdfGenerationError(
        collectionId,
        componentId,
        `Puppeteer error while loading the react app: ${pageResponse?.statusText()}`
      );
    }

    const { headerTemplate, footerTemplate } = getHeaderAndFooterTemplates();

    try {
      const buffer = await page.pdf({
        path: pdfPath,
        format: 'a4',
        printBackground: true,
        margin: {
          top: '54px',
          bottom: '54px',
        },
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        timeout: BROWSER_TIMEOUT,
      });
      await uploadPDF(componentId, pdfPath).catch((error: unknown) => {
        apiLogger.error(`Failed to upload PDF: ${error}`);
      });
      const pdfDoc = await PDFDocument.load(buffer);
      const numPages = pdfDoc.getPages().length;
      apiLogger.debug(`Generated PDF with ${numPages} pages`);
      const updated = {
        collectionId,
        status: PdfStatus.Generated,
        filepath: pdfPath,
        componentId: componentId,
        numPages: numPages,
        order: order,
      };
      UpdateStatus(updated);
    } catch (error: unknown) {
      const updated = {
        collectionId,
        status: PdfStatus.Failed,
        filepath: '',
        componentId: componentId,
        order: order,
        error: JSON.stringify(error),
      };
      UpdateStatus(updated);
      PdfCache.getInstance().invalidateCollection(
        collectionId,
        JSON.stringify(error)
      );
      throw new PdfGenerationError(
        collectionId,
        componentId,
        `Failed to print pdf: ${JSON.stringify(error)}`
      );
    } finally {
      await page.close();
    }
  });
};
