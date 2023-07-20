// import WP from 'workerpool';
// import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import fse from 'fs-extra';
import os from 'os';
import {
  CHROMIUM_PATH,
  TemplateConfig,
  createCacheKey,
  getViewportConfig,
  pageHeight,
  pageWidth,
  // setWindowProperty,
} from './helpers';
import { getHeaderAndFooterTemplates } from '../server/render-template';
import config from '../common/config';
import { chromium } from 'playwright';

// 10 minutes cache
const CACHE_TIMEOUT = 10 * 60 * 10000;
// String match the 'pid not found' error
// const PID_NOT_FOUND = 'kill ESRCH';

// None of the paths here will hard exit
// const hardClearBrowserProcess = (browser: puppeteer.Browser) => {
//   const pid = browser.process()?.pid;
//   try {
//     process.kill(pid as number, 'SIGKILL');
//     console.log(`Removed ${pid}`);
//   } catch (error) {
//     if (error instanceof Error && error.message == PID_NOT_FOUND) {
//       console.log(`Process ${pid} cleaned up by puppeteer`);
//       return;
//     }
//     console.error(
//       `Unable to remove browser PID ${pid}, zombies might be around : ${error}`
//     );
//   }
// };

const generateCache: {
  [cacheKey: string]: {
    promiseLock: Promise<string>;
    expiration: number;
  };
} = {};

function cleanStaleCache(cacheKey: string, fileName: string) {
  setTimeout(() => {
    console.info('Calling clean stale cache for: ', fileName);
    delete generateCache[cacheKey];
    fse.unlink(fileName, (err) => {
      if (err) {
        console.info('warn', `Failed to unlink ${fileName}: ${err}`);
      }
    });
  }, CACHE_TIMEOUT);
}

async function retrieveFilenameFromCache(cacheKey: string) {
  const entry = generateCache[cacheKey];
  if (!entry) {
    return;
  }
  const fileName = await entry.promiseLock;
  // do not return if file does not exist
  if (!fse.existsSync(fileName)) {
    return;
  }
  if (entry.expiration < Date.now()) {
    delete generateCache[cacheKey];
    fse.unlink(fileName, (err) => {
      if (err) {
        console.info('warn', `Failed to unlink ${fileName}: ${err}`);
      }
    });
    return;
  }

  return entry.promiseLock;
}

function fillCache(cacheKey: string, promiseLock: Promise<string>) {
  const entry = generateCache[cacheKey];
  if (entry) {
    return;
  }
  // add 10 minutes cache expiration
  const expiration = new Date(Date.now() + CACHE_TIMEOUT);
  generateCache[cacheKey] = {
    expiration: expiration.getTime(),
    promiseLock,
  };
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  promiseLock.then((filename) => {
    cleanStaleCache(cacheKey, filename);
  });
}

const getNewPdfName = () => {
  const pdfFilename = `report_${uuidv4()}.pdf`;
  return `${os.tmpdir()}/${pdfFilename}`;
};

export const GeneratePdf = async ({
  url,
  rhIdentity,
  templateConfig,
  orientationOption,
  dataOptions,
}: {
  url: string;
  templateConfig: TemplateConfig;
  orientationOption?: boolean;
  rhIdentity: string;
  dataOptions: Record<string, any>;
}) => {
  const cacheKey = createCacheKey({
    templateConfig,
    orientationOption,
    url,
    rhIdentity,
    dataOptions,
  });
  try {
    const fileName = await retrieveFilenameFromCache(cacheKey);
    if (fileName) {
      return fileName;
    }
  } catch (error) {
    console.error(
      `Unable to retrieve cache ${error}. Generating report from scratch.`
    );
  }

  const pdfPath = getNewPdfName();
  const createFilename = async () => {
    const { browserMargins, landscape } = getViewportConfig(
      templateConfig,
      orientationOption
    );
    const browser = await chromium.launch({
      headless: true,
      ...(config?.IS_PRODUCTION
        ? {
            // we have a different dir structure than puppeteer expects. We have to point it to the correct chromium executable
            executablePath: CHROMIUM_PATH,
          }
        : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--no-zygote',
        '--disable-dev-shm-usage',
      ],
    });
    const page = await browser.newPage();

    await page.setViewportSize({ width: pageWidth, height: pageHeight });

    // Enables console logging in Headless mode - handy for debugging components
    page.on('console', (msg) => console.log(`[Headless log] ${msg.text()}`));

    // await setWindowProperty(
    //   page,
    //   'customPuppeteerParams',
    //   JSON.stringify({
    //     puppeteerParams: {
    //       pageWidth,
    //       pageHeight,
    //     },
    //   })
    //   // }) as undefined // probably a typings issue in puppeteer
    // );

    await page.setExtraHTTPHeaders({
      ...(dataOptions
        ? {
            [config?.OPTIONS_HEADER_NAME as string]:
              JSON.stringify(dataOptions),
          }
        : {}),

      ...(config?.IS_DEVELOPMENT && !rhIdentity
        ? {}
        : { 'x-rh-identity': rhIdentity }),
    });
    const pageStatus = await page.goto(url, { waitUntil: 'networkidle' });
    // get the error from DOM if it exists
    const error = await page.evaluate(() => {
      const elem = document.getElementById('error');
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
      } catch {
        // fallback to initial error value
        response = error;
      }

      await browser.close();
      throw response;
    }
    if (!pageStatus?.ok()) {
      await browser.close();
      throw new Error(
        `Puppeteer error while loading the react app: ${pageStatus?.statusText()}`
      );
    }

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
      });
      // await page.close();
      await browser.close();
      return pdfPath;
    } catch (error) {
      throw new Error(`PDF could not be generated : ${error}`);
    }
    // } finally {
    //   hardClearBrowserProcess(browser);
    // }
  };

  const promiseLock = createFilename();
  fillCache(cacheKey, promiseLock);
  return promiseLock;
};

// // register new worker to pool
// WP.worker({
//   generatePdf,
// });
