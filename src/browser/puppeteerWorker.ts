import WP from 'workerpool';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import fs from 'fs';
import { PdfRequestBody } from '../common/types';
import { apiLogger } from '../common/logging';
import {
  CHROMIUM_PATH,
  getViewportConfig,
  pageHeight,
  pageWidth,
  setWindowProperty,
} from './helpers';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import config from '../common/config';
import { produceMessage } from '../common/kafka';
import { uploadPDF } from '../common/objectStore';
import { UPDATE_TOPIC } from '../browser/constants';

// Match the timeout on the gateway
const BROWSER_TIMEOUT = 60_000;

const redirectFontFiles = async (request: puppeteer.HTTPRequest) => {
  if (request.url().endsWith('.woff') || request.url().endsWith('.woff2')) {
    const modifiedUrl = request.url().replace(/^http:\/\/localhost:8000\//, '');
    const fontFile = `./dist/${modifiedUrl}`;
    fs.readFile(fontFile, async (err, data) => {
      if (err) {
        await request.respond({
          status: 404,
          body: `An error occurred while loading font ${modifiedUrl} : ${err}`,
        });
      }
      await request.respond({
        body: data,
        status: 200,
      });
    });
  } else {
    await request.continue();
  }
};

const getNewPdfName = () => {
  const pdfFilename = `report_${uuidv4()}.pdf`;
  return `${os.tmpdir()}/${pdfFilename}`;
};

const generatePdf = async ({
  url,
  rhIdentity,
  templateConfig,
  orientationOption,
  dataOptions,
  uuid,
}: PdfRequestBody) => {
  const pdfPath = getNewPdfName();
  const createFilename = async () => {
    // We don't expect a browser on every run, but we try to connect to it
    // incase one is left over. If we can connect to it, and successfully run,
    // it will be cleaned up by the last worker in the pool.
    const browserUrl = 'http://127.0.0.1:29222';
    let browser: puppeteer.Browser;
    try {
      browser = await puppeteer.connect({
        browserURL: browserUrl,
      });
      apiLogger.debug(`Reusing browser connection`);
    } catch (error) {
      apiLogger.debug(`Could not fetch browser status; starting a new browser`);
      browser = await puppeteer.launch({
        timeout: BROWSER_TIMEOUT,
        headless: true,
        ...(config?.IS_PRODUCTION
          ? {
              // we have a different dir structure than puppeteer expects. We have to point it to the correct chromium executable
              executablePath: CHROMIUM_PATH,
            }
          : {}),
        args: [
          '--no-sandbox',
          '--disable-gpu',
          '--remote-debugging-port=29222',
          '--no-zygote',
          '--no-first-run',
          '--disable-dev-shm-usage',
          '--single-process',
          '--mute-audio',
          "--proxy-server='direct://'",
          '--proxy-bypass-list=*',
          '--user-data-dir=/tmp/',
        ],
      });
    }

    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36'
    );

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
      // }) as undefined // probably a typings issue in puppeteer
    );

    await page.setExtraHTTPHeaders({
      ...(dataOptions
        ? {
            [config?.OPTIONS_HEADER_NAME]: JSON.stringify(dataOptions),
          }
        : {}),

      ...(config?.IS_DEVELOPMENT && !rhIdentity
        ? {}
        : { 'x-rh-identity': rhIdentity }),
    });

    // Intercept font requests from chrome and send them from dist
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      await redirectFontFiles(request);
    });

    const pageStatus = await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: BROWSER_TIMEOUT,
    });
    // get the error from DOM if it exists
    const error = await page.evaluate(() => {
      const elem = document.getElementById('report-error');
      if (elem) {
        return elem.innerText;
      }
    });

    // error happened during page rendering
    if (error && error.length > 0) {
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
        id: uuid,
        status: `Failed: ${response}`,
        filepath: '',
      };
      produceMessage(UPDATE_TOPIC, updated)
        .then(() => {
          apiLogger.debug('Kafka error message sent');
        })
        .catch((error: unknown) => {
          apiLogger.error(`Kafka message not sent : ${error}`);
        });
      throw new Error(`Page render error: ${response}`);
    }
    if (!pageStatus?.ok()) {
      apiLogger.debug(`Page status: ${pageStatus?.statusText()}`);
      const updated = {
        id: uuid,
        status: `Failed: ${pageStatus?.statusText()}`,
        filepath: '',
      };
      produceMessage(UPDATE_TOPIC, updated)
        .then(() => {
          apiLogger.debug('Kafka error message sent');
        })
        .catch((error: unknown) => {
          apiLogger.error(`Kafka message not sent: ${error}`);
        });
      throw new Error(
        `Puppeteer error while loading the react app: ${pageStatus?.statusText()}`
      );
    }
    const { browserMargins, landscape } = getViewportConfig(
      templateConfig,
      orientationOption
    );

    const { headerTemplate, footerTemplate } =
      getHeaderAndFooterTemplates(templateConfig);

    try {
      await page.pdf({
        path: pdfPath,
        format: 'a4',
        printBackground: true,
        margin: browserMargins,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        landscape,
        timeout: BROWSER_TIMEOUT,
      });
      uploadPDF(uuid, pdfPath).catch((error: unknown) => {
        apiLogger.error(`Failed to upload PDF: ${error}`);
      });
      const updated = {
        id: uuid,
        status: 'Generated',
        filepath: pdfPath,
      };
      produceMessage(UPDATE_TOPIC, updated)
        .then(() => {
          apiLogger.debug('Kafka success message sent');
        })
        .catch((error: unknown) => {
          apiLogger.error(`Kafka message not sent: ${error}`);
        });
    } catch (error: unknown) {
      const updated = {
        id: uuid,
        status: `Failed to print pdf: ${JSON.stringify(error)}`,
        filepath: '',
      };
      produceMessage(UPDATE_TOPIC, updated)
        .then(() => {
          apiLogger.debug('Kafka error message sent');
        })
        .catch((error: unknown) => {
          apiLogger.error(`Kafka message not sent: ${error}`);
        });
      throw new Error(`Failed to print pdf: ${JSON.stringify(error)}`);
    } finally {
      await page.close();
      browser.disconnect();
    }
    return pdfPath;
  };

  const filename = await createFilename()
    .then((filename) => {
      return filename;
    })
    .catch((error) => {
      throw error;
    });
  return filename;
};

const workerTerminated = (code: number | undefined) => {
  if (typeof code === 'number') {
    const workerResult = code > 0 ? `with error code ${code}` : `successfully`;
    apiLogger.debug(`Worker terminated ${workerResult}`);
  } else {
    apiLogger.warning(
      `A worker reached a termination issue and no code is available`
    );
  }
};

// register new worker to pool
WP.worker(
  {
    generatePdf,
  },
  {
    onTerminate: workerTerminated,
  }
);
