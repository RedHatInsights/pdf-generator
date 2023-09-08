import puppeteer from 'puppeteer';
import {
  CHROMIUM_PATH,
  TemplateConfig,
  createCacheKey,
  getViewportConfig,
  pageHeight,
  pageWidth,
  setWindowProperty,
} from './helpers';
import config from '../common/config';
import renderTemplate, {
  getHeaderAndFooterTemplates,
} from '../server/render-template';

const previewCache: {
  [cacheKey: string]: {
    promiseLock: Promise<Buffer>;
    expiration: number;
  };
} = {};

async function retrieveBufferFromCache(cacheKey: string) {
  const entry = previewCache[cacheKey];
  if (!entry) {
    return;
  }
  if (entry.expiration < Date.now()) {
    delete previewCache[cacheKey];
    return;
  }

  return entry.promiseLock;
}

function fillCache(cacheKey: string, bufferLock: Promise<Buffer>) {
  const entry = previewCache[cacheKey];
  if (entry) {
    return;
  }
  // add 10 minutes cache expiration
  const expiration = new Date(Date.now() + 10 * 60 * 1000);
  previewCache[cacheKey] = {
    expiration: expiration.getTime(),
    promiseLock: bufferLock,
  };
}

const previewPdf = async (
  url: string,
  templateConfig: TemplateConfig,
  templateData: Record<string, unknown>,
  orientationOption?: boolean
) => {
  const cacheKey = createCacheKey({ templateConfig, orientationOption });
  try {
    const cacheBuffer = await retrieveBufferFromCache(cacheKey);
    if (cacheBuffer) {
      return cacheBuffer;
    }
  } catch (error) {
    console.error(
      `Unable to retrieve cache ${error}. Generating report from scratch.`
    );
  }

  const createBuffer = async () => {
    const { browserMargins, landscape } = getViewportConfig(
      templateConfig,
      orientationOption
    );
    const browser = await puppeteer.launch({
      headless: true,
      ...(config?.IS_PRODUCTION
        ? {
            // we have a different dir structure than puppeteer expects. We have to point it to the correct chromium executable
            executablePath: CHROMIUM_PATH,
          }
        : {}),
      args: ['--no-sandbox', '--disable-gpu'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: pageWidth, height: pageHeight });
    await page.setContent(renderTemplate(templateConfig, templateData));

    // // Enables console logging in Headless mode - handy for debugging components
    page.on('console', (msg) => console.log(`[Headless log] ${msg.text()}`));
    const { headerTemplate, footerTemplate } =
      getHeaderAndFooterTemplates(templateConfig);

    await setWindowProperty(
      page,
      'customPuppeteerParams',
      JSON.stringify({
        puppetteerParams: {
          pageWidth,
          pageHeight,
        },
      })
    );

    const pageStatus = await page.goto(url, { waitUntil: 'networkidle2' });

    const pdfBuffer = await page.pdf({
      format: 'a4',
      printBackground: true,
      margin: browserMargins,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      landscape,
    });

    if (!pageStatus?.ok()) {
      throw new Error(
        `Puppeteer error while loading the react app: ${pageStatus?.statusText()}`
      );
    }

    await browser.close();
    return pdfBuffer;
  };

  const bufferLock = createBuffer();
  fillCache(cacheKey, bufferLock);
  return await bufferLock;
};

export default previewPdf;
