/**
 * Page-side half of the PDF readiness contract (generator side:
 * src/browser/pageReady.ts).
 *
 *   window.__PDF_READY__ === false  - the client bundle is running, still loading
 *   window.__PDF_READY__ === true   - report data is in (or loading failed)
 *   undefined                       - no client bundle on this page
 *
 * The page reports only what it alone knows. The generator decides when the
 * render has settled: it watches the DOM, loading placeholders and the network.
 *
 * Errors also mark the page ready, so the generator's error checks
 * (#crc-pdf-generator-err, #report-error, blank #root) fail the report quickly
 * instead of waiting out the browser timeout.
 */

/** Put on any placeholder rendered while a template or its data is loading. */
export const PDF_LOADING_ATTR = 'data-pdf-loading';

/** Dispatched on window when the flag turns true, so nobody has to poll it. */
export const PDF_READY_EVENT = 'pdf-ready';

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
  window.dispatchEvent(new Event(PDF_READY_EVENT));
}
