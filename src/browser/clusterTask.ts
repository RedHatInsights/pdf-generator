import os from 'os';
import { PdfRequestBody } from '../common/types';
import { apiLogger } from '../common/logging';
import { pageHeight, pageWidth, setWindowProperty } from './helpers';
import PdfCache, { PdfStatus } from '../common/pdfCache';
import {
  getHeaderAndFooterTemplates,
  resolveHeaderBrand,
} from '../server/render-template';
import config from '../common/config';
import { store } from '../common/store';
import { UpdateStatus, isValidPageResponse } from '../server/utils';
import { PdfGenerationError } from '../server/errors';
import { cluster } from '../server/cluster';
import { Page } from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import { TokenManager } from './tokenRefresh';
import { BROWSER_TIMEOUT } from '../common/constants';

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
    additionalData,
    landscape = false,
    uuid: componentId,
  }: PdfRequestBody,
  collectionId: string,
  order: number,
  pdfPath: string,
  tokenManager: TokenManager,
  authCookie?: string,
): Promise<void> {
  await cluster.queue(
    { collectionId, componentId, order },
    async ({ page }: { page: Page }) => {
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
        page.on('console', (msg) => {
          apiLogger.debug(`[Headless log] ${msg.text()}`);
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

        const authHeader = await tokenManager.getValidToken();

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
          // Auth headers are forwarded only to same-origin (localhost) requests
          // to prevent credential exfiltration via cross-origin requests.
          let isSameOrigin = false;
          try {
            isSameOrigin = new URL(reqUrl).hostname === 'localhost';
          } catch {
            // unparseable URL — treat as cross-origin
          }
          if (isSameOrigin && Object.keys(extraHeaders).length > 0) {
            await interceptedRequest.continue({
              headers: { ...interceptedRequest.headers(), ...extraHeaders },
            });
          } else {
            await interceptedRequest.continue();
          }
        });

        page.on('response', async (response) => {
          const respUrl = response.url();

          if (response.status() >= 400) {
            let body = '';
            try {
              body = await response.text();
            } catch {
              body = '<unreadable>';
            }
            apiLogger.debug(
              `[Headless response] ${response.status()} ${respUrl} | body=${body}`,
            );
            return;
          }

          if (
            response.ok() &&
            respUrl.includes('/apps/') &&
            /\.(js|css)(\?|$)/.test(respUrl) &&
            !assetCache.has(assetCacheKey(respUrl))
          ) {
            try {
              const body = await response.buffer();
              assetCache.set(assetCacheKey(respUrl), {
                body,
                contentType:
                  response.headers()['content-type'] ||
                  (respUrl.match(/\.css(\?|$)/)
                    ? 'text/css'
                    : 'application/javascript'),
              });
            } catch {
              // response body may not be available
            }
          }
        });

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

        const brand = resolveHeaderBrand(additionalData);

        let lightwellSvg: string | null = null;
        if (brand === 'lightwell') {
          try {
            await page.waitForSelector('#pdf-header-logo-source svg', {
              timeout: 5000,
            });
          } catch {
            // fall through to text-only header below
          }
          lightwellSvg = await page.evaluate(() => {
            const el = document.getElementById('pdf-header-logo-source');
            return el?.innerHTML?.trim() || null;
          });
          if (!lightwellSvg) {
            apiLogger.warning(
              'Lightwell logomark not rendered from frontend-assets — text-only header',
            );
          }
        }

        const { headerTemplate, footerTemplate } = getHeaderAndFooterTemplates(
          brand,
          lightwellSvg,
        );

        const buffer = await page.pdf({
          path: pdfPath,
          format: 'a4',
          printBackground: true,
          margin:
            brand === 'lightwell'
              ? { top: '80px', bottom: '54px', left: '28px', right: '28px' }
              : { top: '54px', bottom: '54px' },
          landscape,
          displayHeaderFooter: true,
          headerTemplate,
          footerTemplate,
          timeout: BROWSER_TIMEOUT,
        });
        await store.uploadPDF(componentId, pdfPath);
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
        // Do not UpdateStatus(Failed) here - it triggers verifyCollection → invalidateCollection
        // which sets collection.status = Failed before cluster retries run.
        // The taskerror handler in cluster.ts records the failure after retries exhausted.
        throw taskError;
      } finally {
        await page.close().catch(() => {});
      }
    },
  );
}

export const generatePdf = async (
  pdfRequest: PdfRequestBody,
  collectionId: string,
  order: number,
  tokenManager: TokenManager,
  authCookie?: string,
): Promise<void> => {
  const pdfPath = getNewPdfName(pdfRequest.uuid);
  await runPageTask(
    pdfRequest,
    collectionId,
    order,
    pdfPath,
    tokenManager,
    authCookie,
  );
};
