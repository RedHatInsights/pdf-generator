import type { HTTPRequest, Page } from 'puppeteer';
import { apiLogger } from '../common/logging';
import { BROWSER_TIMEOUT } from '../common/constants';
import { PDF_LOADING_ATTR, PDF_READY_EVENT } from '../client/pdfReady';

/**
 * Generator-side half of the PDF readiness contract (page side:
 * src/client/pdfReady.ts).
 *
 * Pages are opened with `waitUntil: 'domcontentloaded'`. A page is then ready
 * to print once all of these hold:
 *
 *   - it reports ready (`window.__PDF_READY__ === true`), if it has the flag
 *   - no loading placeholder (`data-pdf-loading`) is showing
 *   - the DOM has not changed for DOM_QUIET_MS and fonts are loaded
 *   - no request is still downloading
 *
 * Requests are counted here, not in the page, because Puppeteer sees every
 * kind (lazy script chunks, styles, images, fonts, XHR, fetch) and reports a
 * request finished only once its body has arrived.
 */

/** How long the DOM must stay unchanged before rendering counts as settled. */
export const DOM_QUIET_MS = 100;
/** Cap on the quiet wait once nothing is loading, e.g. for animations. */
export const MAX_SETTLE_MS = 5_000;
/** Cap on waiting for open requests, so a stuck one cannot hold the page. */
export const MAX_NETWORK_WAIT_MS = 30_000;

export type RequestTracker = {
  /** URLs of the requests that are still downloading. */
  pending: () => string[];
  /** Resolves when no request is downloading, or after `maxMs`. */
  idle: (maxMs: number) => Promise<void>;
};

/** Counts the page's open requests. Call before `page.goto`. */
export function trackRequests(page: Page): RequestTracker {
  const open = new Set<HTTPRequest>();
  let onIdle: (() => void) | undefined;

  const closed = (request: HTTPRequest) => {
    open.delete(request);
    if (open.size === 0) {
      onIdle?.();
    }
  };
  page.on('request', (request) => open.add(request));
  page.on('requestfinished', closed);
  page.on('requestfailed', closed);

  return {
    pending: () => Array.from(open, (request) => request.url()),
    idle: (maxMs) =>
      new Promise<void>((resolve) => {
        if (open.size === 0) {
          resolve();
          return;
        }
        const timer = setTimeout(() => onIdle?.(), maxMs);
        onIdle = () => {
          clearTimeout(timer);
          onIdle = undefined;
          resolve();
        };
      }),
  };
}

/**
 * Runs in the page. Resolves once the page is rendered and the DOM has been
 * still for `quietMs`; rejects, saying what it was waiting for, after `timeoutMs`.
 * Driven by DOM mutations and the ready event, not by polling.
 *
 * While the report is loading the wait has no cap of its own: printing a
 * placeholder is the failure this guards against. Once it has rendered, the
 * quiet wait is capped at `maxSettleMs` so continuous DOM updates cannot hold
 * the page.
 *
 * Puppeteer sends this function to the browser as source text, and the server
 * build targets ES5: keep it self-contained and free of syntax that compiles
 * to helper calls (async/await, spread, for...of).
 */
function settleInPage(
  loadingAttr: string,
  readyEvent: string,
  needsFlag: boolean,
  quietMs: number,
  maxSettleMs: number,
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timers: { quiet?: number; cap?: number; deadline?: number } = {};
    const watchers: (() => void)[] = [];
    let waitingFor = 'the page to report ready';

    const stopWatching = () => {
      watchers.forEach((unwatch) => unwatch());
      clearTimeout(timers.quiet);
      clearTimeout(timers.cap);
    };
    const settled = () => {
      stopWatching();
      waitingFor = 'fonts to load';
      void document.fonts.ready.then(() => {
        clearTimeout(timers.deadline);
        resolve();
      });
    };
    const check = () => {
      clearTimeout(timers.quiet);
      if (needsFlag && window.__PDF_READY__ !== true) {
        return;
      }
      if (document.querySelector('[' + loadingAttr + ']') !== null) {
        waitingFor = 'a loading placeholder to go away';
        return;
      }
      waitingFor = 'the DOM to stop changing';
      if (timers.cap === undefined) {
        timers.cap = window.setTimeout(settled, maxSettleMs);
      }
      timers.quiet = window.setTimeout(settled, quietMs);
    };

    timers.deadline = window.setTimeout(() => {
      stopWatching();
      reject(new Error('Page not ready to print: waiting for ' + waitingFor));
    }, timeoutMs);

    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener(readyEvent, check);
    watchers.push(
      () => observer.disconnect(),
      () => window.removeEventListener(readyEvent, check),
    );
    check();
  });
}

export async function waitForPageReady(
  page: Page,
  requests: RequestTracker,
  timeout: number = BROWSER_TIMEOUT,
): Promise<void> {
  const started = Date.now();
  const timeLeft = () => Math.max(1, timeout - (Date.now() - started));

  // The client bundle is a deferred script, so it has run and set the flag by
  // DOMContentLoaded. No flag means no bundle (a static page, or the bundle
  // failed to load): settle on the DOM and the network alone.
  const needsFlag = await page.evaluate(
    () => typeof window.__PDF_READY__ === 'boolean',
  );

  let networkDeadline: number | undefined;
  for (;;) {
    await page.evaluate(
      settleInPage,
      PDF_LOADING_ATTR,
      PDF_READY_EVENT,
      needsFlag,
      DOM_QUIET_MS,
      MAX_SETTLE_MS,
      timeLeft(),
    );
    // A request that is still open can change the page when it lands, so wait
    // for it and settle again.
    if (requests.pending().length === 0) {
      break;
    }
    networkDeadline ??= Date.now() + MAX_NETWORK_WAIT_MS;
    const networkTimeLeft = networkDeadline - Date.now();
    if (networkTimeLeft <= 0) {
      apiLogger.warning(
        `Printing with requests still open after ${MAX_NETWORK_WAIT_MS}ms: ${requests.pending().join(', ')}`,
      );
      break;
    }
    await requests.idle(Math.min(networkTimeLeft, timeLeft()));
  }

  apiLogger.debug(
    `Page ready to print in ${Date.now() - started}ms (${needsFlag ? 'ready flag' : 'no ready flag'})`,
  );
}
