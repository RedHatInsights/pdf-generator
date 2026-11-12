import { EventEmitter } from 'events';
import type { Page } from 'puppeteer';
import { apiLogger } from '../common/logging';
import {
  MAX_NETWORK_WAIT_MS,
  RequestTracker,
  trackRequests,
  waitForPageReady,
} from './pageReady';

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    warning: jest.fn(),
  },
}));

const request = (url: string) => ({ url: () => url });

/** `evaluate` answers the flag check first, then every settle call. */
const makePage = (hasFlag = true) => {
  const page = new EventEmitter() as EventEmitter & { evaluate: jest.Mock };
  page.evaluate = jest
    .fn()
    .mockResolvedValue(undefined)
    .mockResolvedValueOnce(hasFlag);
  return page;
};

const asPage = (page: unknown) => page as Page;

const makeRequests = (
  pending: string[][],
  idle: RequestTracker['idle'] = () => Promise.resolve(),
) => {
  const answers = [...pending];
  return {
    // Repeats the last answer once the scripted ones run out.
    pending: jest.fn(() =>
      answers.length > 1 ? (answers.shift() as string[]) : answers[0],
    ),
    idle: jest.fn(idle),
  };
};

const settleCalls = (page: ReturnType<typeof makePage>) =>
  (page.evaluate.mock.calls as unknown[][]).slice(1);

describe('trackRequests', () => {
  it('lists requests until they finish or fail', () => {
    const page = makePage();
    const requests = trackRequests(asPage(page));
    const data = request('/data');
    const chunk = request('/chunk.js');

    page.emit('request', data);
    page.emit('request', chunk);
    expect(requests.pending()).toEqual(['/data', '/chunk.js']);

    page.emit('requestfinished', data);
    expect(requests.pending()).toEqual(['/chunk.js']);

    page.emit('requestfailed', chunk);
    expect(requests.pending()).toEqual([]);
  });

  it('is idle at once when nothing is open', async () => {
    const requests = trackRequests(asPage(makePage()));

    await expect(requests.idle(60_000)).resolves.toBeUndefined();
  });

  it('becomes idle when the last open request closes', async () => {
    const page = makePage();
    const requests = trackRequests(asPage(page));
    const first = request('/a');
    const second = request('/b');
    page.emit('request', first);
    page.emit('request', second);

    let idle = false;
    const waiting = requests.idle(60_000).then(() => {
      idle = true;
    });

    page.emit('requestfinished', first);
    await Promise.resolve();
    expect(idle).toBe(false);

    page.emit('requestfinished', second);
    await waiting;
    expect(idle).toBe(true);
  });

  it('stops waiting after maxMs when a request never closes', async () => {
    jest.useFakeTimers();
    try {
      const page = makePage();
      const requests = trackRequests(asPage(page));
      page.emit('request', request('/stuck'));

      const waiting = requests.idle(1_000);
      jest.advanceTimersByTime(1_000);

      await expect(waiting).resolves.toBeUndefined();
      expect(requests.pending()).toEqual(['/stuck']);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('waitForPageReady', () => {
  it('settles once when no request is open', async () => {
    const page = makePage();
    const requests = makeRequests([[]]);

    await waitForPageReady(asPage(page), requests);

    expect(settleCalls(page)).toHaveLength(1);
    expect(requests.idle).not.toHaveBeenCalled();
  });

  it('requires the ready flag only on pages that have one', async () => {
    const withFlag = makePage(true);
    const withoutFlag = makePage(false);

    await waitForPageReady(asPage(withFlag), makeRequests([[]]));
    await waitForPageReady(asPage(withoutFlag), makeRequests([[]]));

    // settleInPage(loadingAttr, readyEvent, needsFlag, ...)
    expect(settleCalls(withFlag)[0][3]).toBe(true);
    expect(settleCalls(withoutFlag)[0][3]).toBe(false);
  });

  it('waits for open requests, then settles again', async () => {
    const page = makePage();
    const requests = makeRequests([['/more-rows'], []]);

    await waitForPageReady(asPage(page), requests);

    expect(requests.idle).toHaveBeenCalledTimes(1);
    expect(settleCalls(page)).toHaveLength(2);
  });

  it('prints with a warning when requests stay open past the cap', async () => {
    let now = 0;
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const page = makePage();
      const requests = makeRequests([['/stuck']], (maxMs) => {
        now += maxMs;
        return Promise.resolve();
      });

      await waitForPageReady(asPage(page), requests, 120_000);

      expect(requests.idle).toHaveBeenCalledTimes(1);
      expect(requests.idle).toHaveBeenCalledWith(MAX_NETWORK_WAIT_MS);
      // Settled before waiting on the network, and again before printing.
      expect(settleCalls(page)).toHaveLength(2);
      expect(apiLogger.warning).toHaveBeenCalledWith(
        expect.stringContaining('/stuck'),
      );
    } finally {
      clock.mockRestore();
    }
  });

  it('rejects when the page does not settle in time', async () => {
    const page = makePage();
    page.evaluate.mockRejectedValueOnce(
      new Error(
        'Page not ready to print: waiting for the page to report ready',
      ),
    );

    await expect(
      waitForPageReady(asPage(page), makeRequests([[]])),
    ).rejects.toThrow(/waiting for the page to report ready/);
  });
});
