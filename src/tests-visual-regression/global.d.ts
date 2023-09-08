/* eslint-disable no-var */
export {};

declare global {
  var SEVER_HOST: string;
  interface Window {
    customPuppeteerParams?: string;
  }
}
