import os from 'os';
import { AuthState, PdfRequestBody } from '../common/types';
import { apiLogger } from '../common/logging';
import { pageHeight, pageWidth, setWindowProperty } from './helpers';
import PdfCache, { PdfStatus } from '../common/pdfCache';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import config from '../common/config';
import { store } from '../common/store';
import { UpdateStatus, isValidPageResponse } from '../server/utils';
import { PdfGenerationError } from '../server/errors';
import { cluster } from '../server/cluster';
import { Page } from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { isTokenExpiringSoon, refreshAccessToken } from './tokenRefresh';

const BROWSER_TIMEOUT = 120_000;

const assetCache = new Map<string, { body: Buffer; contentType: string }>();

function assetCacheKey(url: string): string {
  return url.split('?')[0];
}

const getNewPdfName = (id: string) => {
  const pdfFilename = `report_${id}.pdf`;
  return `${os.tmpdir()}/${pdfFilename}`;
};

async function runPageTask(
  {
    url,
    identity,
    fetchDataParams,
    landscape = false,
    uuid: componentId,
  }: PdfRequestBody,
  collectionId: string,
  order: number,
  pdfPath: string,
  authState: AuthState,
): Promise<void> {
  await cluster.queue(async ({ page }: { page: Page }) => {
    if (PdfCache.getInstance().isCollectionFailed(collectionId)) {
      apiLogger.debug(
        `Skipping component ${componentId}: collection ${collectionId} already failed`,
      );
      await UpdateStatus({
        collectionId,
        status: PdfStatus.Failed,
        filepath: '',
        componentId,
        order,
        error: 'Collection failed before this component started',
      });
      return;
    }

    try {
      await UpdateStatus({
        status: PdfStatus.Generating,
        filepath: '',
        order,
        componentId,
        collectionId,
      });
      await page.setViewport({ width: pageWidth, height: pageHeight });
      page.on('console', (msg) =>
        apiLogger.info(`[Headless log] ${msg.text()}`),
      );

      page.on('response', async (response) => {
        if (response.status() >= 400) {
          let body = '';
          try {
            body = await response.text();
          } catch {
            body = '<unreadable>';
          }
          apiLogger.debug(
            `[Headless response] ${response.status()} ${response.url()} | body=${body}`,
          );
        }
      });

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

      // Refresh token if expiring before setting headers
      if (
        authState.refreshToken &&
        authState.authHeader &&
        isTokenExpiringSoon(authState.authHeader.replace(/^Bearer\s+/i, ''))
      ) {
        apiLogger.debug(
          `[token-refresh] Refreshing before component ${componentId}`,
        );
        const refreshed = await refreshAccessToken(authState.refreshToken);
        if (refreshed) {
          authState.authHeader = refreshed.accessToken;
        }
      }

      const extraHeaders: Record<string, string> = {};
      if (identity) {
        extraHeaders['x-rh-identity'] = identity;
      }

      if (fetchDataParams) {
        extraHeaders[config?.OPTIONS_HEADER_NAME] =
          JSON.stringify(fetchDataParams);
      }

      if (authState.authHeader) {
        extraHeaders[config.AUTHORIZATION_CONTEXT_KEY] = authState.authHeader;
      }

      if (authState.authCookie) {
        await page.setCookie({
          name: config.JWT_COOKIE_NAME,
          value: authState.authCookie,
          domain: 'localhost',
        });
      }

      await page.setRequestInterception(true);
      page.on('request', async (interceptedRequest) => {
        const reqUrl = interceptedRequest.url();
        if (
          interceptedRequest.method() === 'GET' &&
          reqUrl.includes('/apps/') &&
          /\.(js|css)(\?|$)/.test(reqUrl)
        ) {
          const cached = assetCache.get(assetCacheKey(reqUrl));
          if (cached) {
            await interceptedRequest.respond({
              status: 200,
              contentType: cached.contentType,
              body: cached.body,
            });
            return;
          }
        }
        await interceptedRequest.continue();
      });

      page.on('response', async (resp) => {
        const respUrl = resp.url();
        if (
          resp.ok() &&
          respUrl.includes('/apps/') &&
          /\.(js|css)(\?|$)/.test(respUrl) &&
          !assetCache.has(assetCacheKey(respUrl))
        ) {
          try {
            const body = await resp.buffer();
            assetCache.set(assetCacheKey(respUrl), {
              body,
              contentType:
                resp.headers()['content-type'] ||
                (respUrl.match(/\.css(\?|$)/)
                  ? 'text/css'
                  : 'application/javascript'),
            });
          } catch {
            // response body may not be available
          }
        }
      });

      await page.setExtraHTTPHeaders(extraHeaders);

      const pageResponse = await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: BROWSER_TIMEOUT,
      });
      await page.waitForNetworkIdle({
        idleTime: 1000,
      });
      const pageStatus = pageResponse?.status();

      const error = await page.evaluate(() => {
        const appError = document.getElementById('crc-pdf-generator-err');
        if (appError) {
          return appError.innerText;
        }
        const templateError = document.getElementById('report-error');
        if (templateError) {
          return templateError.innerText;
        }
      });

      if (error && error.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let response: any;
        try {
          response = JSON.parse(error);
          apiLogger.debug(response.data);
        } catch {
          response = error;
          apiLogger.debug(`Page render error ${response}`);
        }
        throw new PdfGenerationError(
          collectionId,
          componentId,
          `Page render error: ${response}`,
        );
      }
      if (!pageStatus || !isValidPageResponse(pageStatus)) {
        apiLogger.debug(`Page status: ${pageResponse?.statusText()}`);
        throw new PdfGenerationError(
          collectionId,
          componentId,
          `Puppeteer error while loading the react app: ${pageResponse?.statusText()}`,
        );
      }

      if (PdfCache.getInstance().isCollectionFailed(collectionId)) {
        apiLogger.debug(
          `Aborting component ${componentId}: collection ${collectionId} failed during page load`,
        );
        return;
      }

      const { headerTemplate, footerTemplate } = getHeaderAndFooterTemplates();

      const buffer = await page.pdf({
        path: pdfPath,
        format: 'a4',
        printBackground: true,
        margin: {
          top: '54px',
          bottom: '54px',
        },
        landscape,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        timeout: BROWSER_TIMEOUT,
      });
      await store.uploadPDF(componentId, pdfPath).catch((error: unknown) => {
        apiLogger.error(`Failed to upload PDF: ${error}`);
      });
      const pdfDoc = await PDFDocument.load(buffer);
      const numPages = pdfDoc.getPages().length;
      apiLogger.debug(`Generated PDF with ${numPages} pages`);
      await UpdateStatus({
        collectionId,
        status: PdfStatus.Generated,
        filepath: pdfPath,
        componentId,
        numPages,
        order,
      });
    } catch (taskError: unknown) {
      const message =
        taskError instanceof Error ? taskError.message : String(taskError);
      apiLogger.error(`Component ${componentId} failed: ${message}`);
      await UpdateStatus({
        collectionId,
        status: PdfStatus.Failed,
        filepath: '',
        componentId,
        order,
        error: message,
      });
      PdfCache.getInstance().invalidateCollection(collectionId, message);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

export const generatePdf = async (
  pdfRequest: PdfRequestBody,
  collectionId: string,
  order: number,
  authState: AuthState,
): Promise<void> => {
  const pdfPath = getNewPdfName(pdfRequest.uuid);
  await runPageTask(pdfRequest, collectionId, order, pdfPath, authState);
};
