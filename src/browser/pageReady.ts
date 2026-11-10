import type { Page } from 'puppeteer';
import { apiLogger } from '../common/logging';
import { BROWSER_TIMEOUT } from '../common/constants';

/**
 * Generator-side half of the PDF readiness contract (see src/client/pdfReady.ts).
 *
 * Pages are opened with `waitUntil: 'domcontentloaded'`, then this waits for the
 * page to set `window.__PDF_READY__ = true`. That replaces networkidle2's fixed
 * 500 ms quiet period and the extra 1 s network-idle wait that used to follow it.
 *
 * Pages that never define the flag (no client bundle — e.g. a plain HTML page or
 * a bundle that failed to load) fall back to the old network-idle wait, so they
 * print exactly as before.
 */

/** How long to wait for the client bundle to define the flag at all. */
export const READY_FLAG_DETECT_TIMEOUT = 5_000;
/** Matches networkidle2's quiet window, used only on the fallback path. */
export const FALLBACK_IDLE_MS = 500;
/** Interval polling avoids requestAnimationFrame, which can pause for hidden pages. */
const POLL_INTERVAL_MS = 50;

export type ReadyOutcome = 'ready' | 'fallback';

type ReadyWindow = { __PDF_READY__?: boolean };

export async function waitForPageReady(
  page: Page,
  timeout: number = BROWSER_TIMEOUT,
): Promise<ReadyOutcome> {
  const started = Date.now();

  const adopted = await page
    .waitForFunction(
      () =>
        typeof (window as unknown as ReadyWindow).__PDF_READY__ === 'boolean',
      { timeout: READY_FLAG_DETECT_TIMEOUT, polling: POLL_INTERVAL_MS },
    )
    .then(
      () => true,
      () => false,
    );

  if (!adopted) {
    apiLogger.debug(
      `Page did not expose __PDF_READY__ within ${READY_FLAG_DETECT_TIMEOUT}ms; falling back to network idle`,
    );
    await page.waitForNetworkIdle({ idleTime: FALLBACK_IDLE_MS, timeout });
    apiLogger.debug(
      `Page ready via network-idle fallback in ${Date.now() - started}ms`,
    );
    return 'fallback';
  }

  await page.waitForFunction(
    () => (window as unknown as ReadyWindow).__PDF_READY__ === true,
    { timeout, polling: POLL_INTERVAL_MS },
  );
  apiLogger.debug(`Page signalled ready in ${Date.now() - started}ms`);
  return 'ready';
}
