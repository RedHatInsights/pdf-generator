import ServiceNames from './service-names';
import config from './config';
import { Request } from 'express';

export type TemplateConfig = { service: ServiceNames; template: string };

export type PreviewReqBody = {
  orientation?: string;
};

export type PreviewReqQuery = {
  orientation?: string;
  template: string;
  service: ServiceNames;
};

export type PreviewHandlerRequest = Request<
  unknown,
  unknown,
  PreviewReqBody,
  PreviewReqQuery
>;

export type GenerateHandlerRequest = Request<
  unknown,
  unknown,
  Record<string, any>,
  { service: ServiceNames; template: string }
>;

export type HelloHandlerRequest = Request<
  unknown,
  unknown,
  unknown,
  { policyId: string; totalHostCount: number }
>;

export type PuppeteerBrowserRequest = Request<
  unknown,
  unknown,
  unknown,
  { service: ServiceNames; template: string }
>;

export type PdfRequestBody = {
  url: string;
  templateConfig: TemplateConfig;
  templateData?: Record<string, unknown>;
  orientationOption?: boolean;
  rhIdentity: string;
  dataOptions: Record<string, any>;
  uuid: string;
};

export type CacheKey = {
  request: Omit<PdfRequestBody, 'rhIdentity'>;
  accountID: string;
};

declare module 'http' {
  // globally declare custom headers
  interface IncomingHttpHeaders {
    // extra options for puppeteer requests
    [config.OPTIONS_HEADER_NAME]?: string;
    // identity headers
    [config.IDENTITY_HEADER_KEY]: string;
  }
}

declare global {
  interface Window {
    customPuppeteerParams?: string;
  }
}
