/* eslint-disable @typescript-eslint/no-explicit-any */
import config from './config';
import { Request } from 'express';

export type PreviewReqBody = {
  orientation?: string;
};

export type GeneratePayload = {
  manifestLocation: string;
  scope: string;
  module: string;
  importName?: string;
  authHeader?: string;
  fetchDataParams?: Record<string, unknown>;
  additionalData?: Record<string, unknown>;
  identity?: string;
  authCookie?: string;
};

export type PreviewHandlerRequest = Request<
  unknown,
  unknown,
  PreviewReqBody,
  GeneratePayload
>;

export type GenerateHandlerRequest = Request<
  unknown,
  unknown,
  {
    payload: GeneratePayload | GeneratePayload[];
  }
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
  GeneratePayload
>;

export type PdfRequestBody = GeneratePayload & {
  uuid: string;
  url: string;
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
