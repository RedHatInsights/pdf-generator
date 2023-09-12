import { replaceString } from './helpers';
import { resolve } from 'path';
import puppeteer from 'puppeteer';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';
import renderTemplate, {
  getHeaderandFooterTemplates,
} from '../server/render-template';
import ServiceNames from '../common/service-names';
import { glob } from 'glob';
import config from '../common/config';
import templates from '../templates';

const A4Width = 210;
const A4Height = 297;

function getChromiumExectuablePath() {
  const paths = glob.sync(
    resolve(
      __dirname,
      '../node_modules/puppeteer/.local-chromium/*/chrome-linux/chrome/'
    )
  );
  if (paths.length > 0) {
    return paths[0];
  } else {
    throw new Error('unable to locate chromium executable');
  }
}

const CHROMIUM_PATH = config?.IS_PRODUCTION
  ? getChromiumExectuablePath()
  : undefined;

const margins = {
  top: '2cm',
  bottom: '2cm',
  right: '1cm',
  left: '1cm',
};
// Get margin off and make it bigger resolution
const pageWidth = (A4Height - 20) * 4;
const pageHeight = (A4Width - 40) * 4;

const setWindowProperty = (page: puppeteer.Page, name: string, value: string) =>
  page.evaluateOnNewDocument(`
    Object.defineProperty(window, '${name}', {
      get() {
        return '${replaceString(value)}'
      }
    })
  `);

const getNewPdfName = () => {
  const pdfFilename = `report_${uuidv4()}.pdf`;
  return `${os.tmpdir()}/${pdfFilename}`;
};

export const previewPdf = async (
  url: string,
  templateConfig: { service: ServiceNames; template: string },
  templateData: Record<string, unknown>,
  orientationOption?: boolean
) => {
  const browserMargins = {
    ...margins,
    ...templates?.[templateConfig.service]?.[templateConfig.template]
      ?.browserMargins,
  };
  const landscape =
    typeof orientationOption !== 'undefined'
      ? orientationOption
      : templates?.[templateConfig.service]?.[templateConfig.template]
          ?.landscape;
  const browser = await puppeteer.launch({
    headless: true,
    ...(config?.IS_PRODUCTION
      ? {
          // we have a different dir structure than pupetter expects. We have to point it to the correct chromium executable
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
    getHeaderandFooterTemplates(templateConfig);

  await setWindowProperty(
    page,
    'customPupeteerParams',
    JSON.stringify({
      pupeteerParams: {
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
      `Pupeteer error while loading the react app: ${pageStatus?.statusText()}`
    );
  }

  await browser.close();
  return pdfBuffer;
};

const generatePdf = async (
  url: string,
  rhIdentity: string,
  templateConfig: { service: ServiceNames; template: string },
  orientationOption: boolean | undefined,
  dataOptions?: Record<string, any>
) => {
  const browserMargins = {
    ...margins,
    ...templates?.[templateConfig.service]?.[templateConfig.template]
      ?.browserMargins,
  };
  const landscape =
    typeof orientationOption !== 'undefined'
      ? orientationOption
      : templates?.[templateConfig.service]?.[templateConfig.template]
          ?.landscape;
  const pdfPath = getNewPdfName();
  const browser = await puppeteer.launch({
    headless: true,
    ...(config?.IS_PRODUCTION
      ? {
          // we have a different dir structure than pupetter expects. We have to point it to the correct chromium executable
          executablePath: CHROMIUM_PATH,
        }
      : {}),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();

  await page.setViewport({ width: pageWidth, height: pageHeight });

  // Enables console logging in Headless mode - handy for debugging components
  page.on('console', (msg) => console.log(`[Headless log] ${msg.text()}`));

  await setWindowProperty(
    page,
    'customPupeteerParams',
    JSON.stringify({
      pupeteerParams: {
        pageWidth,
        pageHeight,
      },
    })
    // }) as undefined // probably a typings issue in pupetter
  );

  await page.setExtraHTTPHeaders({
    ...(dataOptions
      ? {
          [config?.OPTIONS_HEADER_NAME as string]: JSON.stringify(dataOptions),
        }
      : {}),

    'x-rh-identity': rhIdentity,
  });
  const pageStatus = await page.goto(url, { waitUntil: 'networkidle2' });
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

    throw response;
  }
  if (!pageStatus?.ok()) {
    throw new Error(
      `Pupeteer error while loading the react app: ${pageStatus?.statusText()}`
    );
  }

  const { headerTemplate, footerTemplate } =
    getHeaderandFooterTemplates(templateConfig);

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

  await browser.close();
  return pdfPath;
};

export default generatePdf;
