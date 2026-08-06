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
    `${home}/.cache/puppeteer/chrome/*/chrome-linux64/chrome`,
  );
  if (paths.length > 0) {
    return paths[0];
  } else {
    throw new Error('unable to locate chromium executable');
  }
}

export const CHROMIUM_PATH = config?.IS_PRODUCTION
  ? getChromiumExecutablePath()
  : undefined;

const A4Width = 210;
const A4Height = 297;

// Get margin off and make it bigger resolution
export const pageWidth = (A4Height - 20) * 4;
export const pageHeight = (A4Width - 40) * 4;

export const setWindowProperty = (page: Page, name: string, value: string) =>
  page.evaluateOnNewDocument(`
    Object.defineProperty(window, '${name}', {
      get() {
        return '${replaceString(value)}'
      }
    })
  `);
