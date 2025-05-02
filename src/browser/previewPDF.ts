import puppeteer from 'puppeteer';
import {
  CHROMIUM_PATH,
  pageHeight,
  pageWidth,
  setWindowProperty,
} from './helpers';
import config from '../common/config';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import { apiLogger } from '../common/logging';

function delay(time: number) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

const previewPdf = async (url: string) => {
  const createBuffer = async () => {
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

    // Enables console logging in Headless mode - handy for debugging components
    page.on('console', (msg) =>
      apiLogger.debug(`[Headless log] ${msg.text()}`),
    );
    await page.setViewport({ width: pageWidth, height: pageHeight });
    const extraHeaders: Record<string, string> = {};
    if (process.env.MOCK_TOKEN) {
      extraHeaders['Authorization'] = process.env.MOCK_TOKEN;
    }
    await page.setCookie({ name: 'cs_jwt', value: 'bar', domain: 'localhost' });
    await page.setExtraHTTPHeaders(extraHeaders);

    const pageStatus = await page.goto(url, {
      waitUntil: 'networkidle2',
    });

    await delay(1000);
    await page.waitForNetworkIdle();
    const { headerTemplate, footerTemplate } = getHeaderAndFooterTemplates();

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

    const pdfBuffer = await page.pdf({
      format: 'a4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: {
        top: '54px',
        bottom: '54px',
      },
    });

    if (!pageStatus?.ok()) {
      throw new Error(
        `Puppeteer error while loading the react app: ${pageStatus?.statusText()}`,
      );
    }

    await browser.close();
    return pdfBuffer;
  };

  const bufferLock = createBuffer();
  return await bufferLock;
};

export default previewPdf;
