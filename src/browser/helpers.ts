import type { Page } from 'puppeteer';
import { glob } from 'glob';
import config from '../common/config';

export const SANITIZE_FILEPATH = /^(\.\.(\/|\\|$))+/;
export const SANITIZE_REGEX =
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi;

export const replaceString = (string: string) => {
  return string.replace(/[-[\]{}()'`*+?.,\\^$|#]/g, '\\$&');
};

export const sanitizeFilepath = (input: string) => {
  return input.replace(SANITIZE_FILEPATH, '');
};

function getChromiumExecutablePath() {
  const home = process.env.HOME || '/root';
  const paths = glob.sync(
    `${home}/.cache/puppeteer/chrome-headless-shell/*/chrome-headless-shell-linux64/chrome-headless-shell`,
  );
  if (paths.length > 0) {
    return paths[0];
  } else {
    throw new Error('unable to locate chromium executable');
  }
}

/**
 * An explicit CHROMIUM_PATH wins over the glob above.
 *
 * Without it a production build only runs inside the production image, because
 * the glob matches the Linux cache layout alone — so `npm run build` followed by
 * `node dist/server.js` dies at import on any developer machine. That mattered:
 * RHCLOUD-51334 existed only in production builds (development builds do not
 * minify the emitted HTML), and being unable to run one locally is a large part
 * of why it reached stage unnoticed.
 */
export const CHROMIUM_PATH =
  config?.CHROMIUM_PATH ||
  (config?.IS_PRODUCTION ? getChromiumExecutablePath() : undefined);

const A4Width = 210;
const A4Height = 297;

// Get margin off and make it bigger resolution
export const pageWidth = (A4Height - 20) * 4;
export const pageHeight = (A4Width - 40) * 4;

export type PdfMargin = {
  top: string;
  bottom: string;
  left?: string;
  right?: string;
};

// A4 in CSS pixels at 96 dpi: the paper page.pdf prints on.
const A4_PX = { width: 794, height: 1123 };

/**
 * The box one printed page gives the document: the paper minus the margins
 * passed to page.pdf.
 */
export const printableArea = (landscape: boolean, margin: PdfMargin) => {
  const px = (value?: string) => parseInt(value ?? '0', 10) || 0;
  const paper = landscape
    ? { width: A4_PX.height, height: A4_PX.width }
    : A4_PX;
  return {
    width: paper.width - px(margin.left) - px(margin.right),
    height: paper.height - px(margin.top) - px(margin.bottom),
  };
};

/**
 * Pages are laid out for print from the start. A template that sizes itself
 * in JavaScript from the screen viewport can opt out by sending
 * `additionalData.printLayout: false`.
 */
export const usesPrintLayout = (additionalData?: Record<string, unknown>) =>
  additionalData?.printLayout !== false;

export const setWindowProperty = (page: Page, name: string, value: string) =>
  page.evaluateOnNewDocument(`
    Object.defineProperty(window, '${name}', {
      get() {
        return '${replaceString(value)}'
      }
    })
  `);
