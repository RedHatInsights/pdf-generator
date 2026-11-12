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
  /**
   * URLs of the requests that are still downloading, without their query
   * strings: these end up in logs, and a query can carry identifiers.
   */
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
    pending: () =>
      Array.from(open, (request) => request.url().split(/[?#]/, 1)[0]),
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

type SettleOptions = {
  loadingAttr: string;
  readyEvent: string;
  needsFlag: boolean;
  quietMs: number;
  maxSettleMs: number;
  timeoutMs: number;
};

/**
 * Runs in the page. Resolves once nothing is loading and the DOM has been
 * still for `quietMs`; rejects, saying what it was waiting for, after
 * `timeoutMs`. Driven by DOM mutations and events, not by polling.
 *
 * "Loading" means the ready flag is not true yet, a loading placeholder is
 * showing, or fonts are loading. While any of those holds the wait has no cap
 * of its own: printing a placeholder is the failure this guards against. Only
 * the quiet wait that follows is capped, at `maxSettleMs`, so continuous DOM
 * updates cannot hold the page.
 *
 * Puppeteer sends this function to the browser as source text, and the server
 * build targets ES5: keep it self-contained and free of syntax that compiles
 * to helper calls (async/await, spread, destructuring, for...of).
 */
function settleInPage(options: SettleOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timers: { quiet?: number; cap?: number; deadline?: number } = {};
    const watchers: (() => void)[] = [];
    let lastChange = Date.now();
    let capped = false;
    let waitingFor = 'the page to settle';

    const loading = () => {
      if (options.needsFlag && window.__PDF_READY__ !== true) {
        return 'the page to report ready';
      }
      if (document.querySelector('[' + options.loadingAttr + ']') !== null) {
        return 'a loading placeholder to go away';
      }
      if (document.fonts.status === 'loading') {
        return 'fonts to load';
      }
      return undefined;
    };
    const stopWatching = () => {
      watchers.forEach((unwatch) => unwatch());
      clearTimeout(timers.quiet);
      clearTimeout(timers.cap);
      clearTimeout(timers.deadline);
    };
    // Every wake-up comes through here, so the loading checks always run
    // right before the page is declared settled.
    const check = () => {
      clearTimeout(timers.quiet);
      const blocker = loading();
      if (blocker !== undefined) {
        waitingFor = blocker;
        clearTimeout(timers.cap);
        timers.cap = undefined;
        capped = false;
        return;
      }
      waitingFor = 'the DOM to stop changing';
      const quietLeft = options.quietMs - (Date.now() - lastChange);
      if (capped || quietLeft <= 0) {
        stopWatching();
        resolve();
        return;
      }
      if (timers.cap === undefined) {
        timers.cap = window.setTimeout(() => {
          capped = true;
          check();
        }, options.maxSettleMs);
      }
      timers.quiet = window.setTimeout(check, quietLeft);
    };
    // The DOM changed or the page reported ready: restart the quiet wait.
    const changed = () => {
      lastChange = Date.now();
      check();
    };

    timers.deadline = window.setTimeout(() => {
      stopWatching();
      reject(new Error('Page not ready to print: waiting for ' + waitingFor));
    }, options.timeoutMs);

    const observer = new MutationObserver(changed);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    window.addEventListener(options.readyEvent, changed);
    // Fonts arriving do not change the DOM, so they do not restart the wait.
    document.fonts.addEventListener('loadingdone', check);
    watchers.push(
      () => observer.disconnect(),
      () => window.removeEventListener(options.readyEvent, changed),
      () => document.fonts.removeEventListener('loadingdone', check),
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
  const settle = () =>
    page.evaluate(settleInPage, {
      loadingAttr: PDF_LOADING_ATTR,
      readyEvent: PDF_READY_EVENT,
      needsFlag,
      quietMs: DOM_QUIET_MS,
      maxSettleMs: MAX_SETTLE_MS,
      timeoutMs: timeLeft(),
    });

  await settle();

  // A request that is still open can change the page when it lands, so wait
  // for it and settle again. This cannot hang: idle() returns by the network
  // deadline at the latest, settle() rejects once `timeout` has run out, and
  // the cluster's task timeout bounds the page as a whole.
  const networkDeadline = Date.now() + MAX_NETWORK_WAIT_MS;
  while (requests.pending().length > 0 && Date.now() < networkDeadline) {
    await requests.idle(Math.min(networkDeadline - Date.now(), timeLeft()));
    await settle();
  }

  const stillOpen = requests.pending();
  if (stillOpen.length > 0) {
    apiLogger.warning(
      `Printing with ${stillOpen.length} request(s) still open after ${MAX_NETWORK_WAIT_MS}ms: ${stillOpen.join(', ')}`,
    );
  }

  apiLogger.debug(
    `Page ready to print in ${Date.now() - started}ms (${needsFlag ? 'ready flag' : 'no ready flag'})`,
  );
}
