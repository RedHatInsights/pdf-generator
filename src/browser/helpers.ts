import { Request } from 'express';
import puppeteer from 'puppeteer';
import { glob } from 'glob';
import { resolve } from 'path';
import { PreviewReqBody, PreviewReqQuery } from '../common/types';
import config from '../common/config';
import ServiceNames from '../common/service-names';
import templates from '../templates';

export const replaceString = (string: string) => {
  return string.replace(/[-[\]{}()'`*+?.,\\^$|#]/g, '\\$&');
};

export const MaxWorkers = 2;

export const processOrientationOption = (
  request: Request<unknown, unknown, PreviewReqBody, PreviewReqQuery>
) => {
  let orientationOption = '';
  if (request.query?.orientation) {
    orientationOption = request.query?.orientation;
  } else if (request.body?.orientation) {
    orientationOption = request.body?.orientation;
  }

  if (orientationOption === 'landscape') {
    return true;
  }

  return undefined;
};

export const margins = {
  top: '2cm',
  bottom: '2cm',
  right: '1cm',
  left: '1cm',
};

function getChromiumExecutablePath() {
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

export const CHROMIUM_PATH = config?.IS_PRODUCTION
  ? getChromiumExecutablePath()
  : undefined;

const A4Width = 210;
const A4Height = 297;

// Get margin off and make it bigger resolution
export const pageWidth = (A4Height - 20) * 4;
export const pageHeight = (A4Width - 40) * 4;

export const setWindowProperty = (
  page: puppeteer.Page,
  name: string,
  value: string
) =>
  page.evaluateOnNewDocument(`
    Object.defineProperty(window, '${name}', {
      get() {
        return '${replaceString(value)}'
      }
    })
  `);

const getBrowserMargins = (service: ServiceNames, template: string) => {
  return {
    ...margins,
    ...templates?.[service]?.[template]?.browserMargins,
  };
};

const isLandscape = (
  service: ServiceNames,
  template: string,
  orientation?: boolean
) => {
  return typeof orientation !== 'undefined'
    ? orientation
    : templates?.[service]?.[template]?.landscape;
};

export const getViewportConfig = (
  templateConfig: { service: ServiceNames; template: string },
  orientation?: boolean
) => {
  return {
    browserMargins: getBrowserMargins(
      templateConfig.service,
      templateConfig.service
    ),
    landscape: isLandscape(
      templateConfig.service,
      templateConfig.template,
      orientation
    ),
  };
};

export type TemplateConfig = { service: ServiceNames; template: string };
export function createCacheKey(cacheKeyObject: Record<string, any>) {
  try {
    return JSON.stringify(cacheKeyObject);
  } catch (error) {
    throw new Error(
      `Unable to create cache key for ${cacheKeyObject}! ${error}`
    );
  }
}
