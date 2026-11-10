/**
 * Browser-side half of the PDF readiness contract (see src/browser/pageReady.ts).
 *
 * The generator used to wait for the network to go quiet (networkidle2's fixed
 * 500 ms plus a further 1 s idle wait) before printing, even though the report
 * was usually rendered well before that. Instead, the page now says when it is
 * ready to print:
 *
 *   window.__PDF_READY__ === false  - the client bundle is running, not ready yet
 *   window.__PDF_READY__ === true   - rendered (or failed) and safe to print
 *   undefined                       - the bundle never ran; the generator falls
 *                                     back to the old network-idle wait
 *
 * Errors also mark the page ready, so the generator's existing error checks
 * (#crc-pdf-generator-err, #report-error, blank #root) fail the report quickly
 * instead of waiting out the browser timeout.
 */

/** Put on any placeholder rendered while a template or its data is loading. */
export const PDF_LOADING_ATTR = 'data-pdf-loading';

/** How long the DOM must stay unchanged before we consider rendering settled. */
export const DOM_QUIET_MS = 100;
/** Upper bound on the settle wait once nothing is loading (e.g. animations). */
export const MAX_SETTLE_MS = 5_000;
/** Upper bound on waiting for <img> elements to finish loading. */
export const MAX_IMAGE_WAIT_MS = 5_000;
/**
 * Upper bound on treating in-flight XHR/fetch requests as "still loading", so a
 * long-poll or stuck request cannot hold the page until the browser timeout.
 */
export const MAX_NETWORK_WAIT_MS = 30_000;

declare global {
  interface Window {
    __PDF_READY__?: boolean;
  }
}

export function markPdfPending(): void {
  window.__PDF_READY__ = false;
}

export function markPdfReady(): void {
  window.__PDF_READY__ = true;
}

/*
 * In-flight request tracking. Templates may fetch more data after they mount
 * (their own axios/fetch calls) without showing a tagged placeholder. While such
 * a request is open the DOM can sit still for longer than DOM_QUIET_MS, so an
 * open request counts as loading. This is the safety net networkidle2 used to
 * provide, without its fixed 500 ms tail.
 */
let inFlightRequests = 0;
let trackingRequests = false;
const requestsIdleListeners = new Set<() => void>();

function requestStarted(): void {
  inFlightRequests += 1;
}

function requestEnded(): void {
  inFlightRequests = Math.max(0, inFlightRequests - 1);
  if (inFlightRequests === 0) {
    requestsIdleListeners.forEach((listener) => listener());
  }
}

export function pendingRequestCount(): number {
  return inFlightRequests;
}

const BODY_READERS = [
  'json',
  'text',
  'arrayBuffer',
  'blob',
  'formData',
] as const;

function wrapBodyReaders(
  response: Response,
  onReadStart: () => void,
  onReadEnd: () => void,
): void {
  for (const reader of BODY_READERS) {
    if (typeof response[reader] !== 'function') {
      continue;
    }
    const original = (response[reader] as () => Promise<unknown>).bind(
      response,
    );
    response[reader] = (() => {
      onReadStart();
      const reading = original();
      reading.then(onReadEnd, onReadEnd);
      return reading;
    }) as never;
  }
}

/**
 * fetch() resolves when the response headers arrive, before the body has
 * downloaded. Keep the request counted until the caller has finished reading
 * the body (`await res.json()` etc.), so a large or slow body cannot let the
 * page settle early. If no body read starts by the next task, the caller is not
 * going to read it, so stop counting then.
 */
function holdUntilBodyRead(response: Response): void {
  let ended = false;
  const end = () => {
    if (!ended) {
      ended = true;
      requestEnded();
    }
  };
  let readStarted = false;
  setTimeout(() => {
    if (!readStarted) {
      end();
    }
  }, 0);
  try {
    wrapBodyReaders(
      response,
      () => {
        readStarted = true;
      },
      end,
    );
  } catch {
    end();
  }
}

/** Install XHR/fetch counters. Call before the app starts making requests. */
export function trackNetworkRequests(): void {
  if (trackingRequests) {
    return;
  }
  trackingRequests = true;

  if (typeof XMLHttpRequest !== 'undefined') {
    // Re-applied with the request as `this` below.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (
      this: XMLHttpRequest,
      ...args: Parameters<XMLHttpRequest['send']>
    ) {
      requestStarted();
      // loadend fires after load, error, abort and timeout alike.
      this.addEventListener('loadend', requestEnded, { once: true });
      try {
        return originalSend.apply(this, args);
      } catch (error) {
        this.removeEventListener('loadend', requestEnded);
        requestEnded();
        throw error;
      }
    };
  }

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args: Parameters<typeof fetch>) => {
      requestStarted();
      let result: Promise<Response>;
      try {
        result = originalFetch(...args);
      } catch (error) {
        requestEnded();
        throw error;
      }
      result.then(holdUntilBodyRead, requestEnded);
      return result;
    };
  }
}

function hasLoadingPlaceholder(root: ParentNode): boolean {
  return root.querySelector(`[${PDF_LOADING_ATTR}]`) !== null;
}

/**
 * requestAnimationFrame can be paused for pages Chrome considers hidden, and
 * several PDF pages render concurrently in one browser. Race it with a timer so
 * a paused frame cannot stall readiness.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 50);
  });
}

/**
 * Resolves once nothing under `root` is marked loading, no tracked request is in
 * flight, and the DOM has not changed for `quietMs`. While a loading placeholder
 * is present it waits without a cap — printing a placeholder is exactly the
 * failure this guards against, and the generator's own timeout bounds the whole
 * page. In-flight requests are honoured for up to `maxNetworkMs`. Once loading
 * is over, the quiet wait is capped at `maxSettleMs` so continuous DOM updates
 * (animations) cannot hold the page forever.
 */
export function waitForDomSettled(
  root: Node & ParentNode,
  quietMs = DOM_QUIET_MS,
  maxSettleMs = MAX_SETTLE_MS,
  maxNetworkMs = MAX_NETWORK_WAIT_MS,
): Promise<void> {
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let settleDeadline: ReturnType<typeof setTimeout> | undefined;
  let networkWaitOver = false;
  let resolveSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const isLoading = () =>
    hasLoadingPlaceholder(root) || (!networkWaitOver && inFlightRequests > 0);

  const onChange = () => {
    clearTimeout(quietTimer);
    if (isLoading()) {
      return;
    }
    if (settleDeadline === undefined) {
      settleDeadline = setTimeout(resolveSettled, maxSettleMs);
    }
    quietTimer = setTimeout(resolveSettled, quietMs);
  };

  const networkDeadline = setTimeout(() => {
    networkWaitOver = true;
    onChange();
  }, maxNetworkMs);
  requestsIdleListeners.add(onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  onChange();

  return settled.then(() => {
    observer.disconnect();
    requestsIdleListeners.delete(onChange);
    clearTimeout(quietTimer);
    clearTimeout(settleDeadline);
    clearTimeout(networkDeadline);
  });
}

function waitForImages(root: ParentNode, maxMs: number): Promise<void> {
  const pending = Array.from(root.querySelectorAll('img')).filter(
    (img) => !img.complete,
  );
  if (pending.length === 0) {
    return Promise.resolve();
  }
  const loaded = Promise.all(
    pending.map(
      (img) =>
        new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        }),
    ),
  ).then(() => undefined);
  const cap = new Promise<void>((resolve) => setTimeout(resolve, maxMs));
  return Promise.race([loaded, cap]);
}

/**
 * Wait until the report under `root` has rendered and settled, then mark the
 * page ready. Never rejects: on any unexpected failure it still marks ready so
 * the generator's error/blank checks decide the outcome.
 */
export async function signalReadyWhenSettled(root: HTMLElement): Promise<void> {
  try {
    await waitForDomSettled(root);
    await waitForImages(root, MAX_IMAGE_WAIT_MS);
    // Fonts are only requested once layout needs them, so let a frame pass
    // before asking, then wait for any that are still loading.
    await nextFrame();
    await document.fonts?.ready;
    await nextFrame();
    await nextFrame();
  } catch (error) {
    console.error('[crc-pdf-generator] readiness wait failed', error);
  } finally {
    markPdfReady();
  }
}
