import type { Page } from 'puppeteer';
import {
  FALLBACK_IDLE_MS,
  READY_FLAG_DETECT_TIMEOUT,
  waitForPageReady,
} from './pageReady';

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
  },
}));

const makePage = () => ({
  waitForFunction: jest.fn().mockResolvedValue(true),
  waitForNetworkIdle: jest.fn().mockResolvedValue(undefined),
});

const asPage = (page: ReturnType<typeof makePage>) => page as unknown as Page;

describe('waitForPageReady', () => {
  it('waits for the page to signal ready when it exposes the flag', async () => {
    const page = makePage();

    await expect(waitForPageReady(asPage(page), 30_000)).resolves.toBe('ready');

    expect(page.waitForFunction).toHaveBeenCalledTimes(2);
    expect(page.waitForFunction).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      expect.objectContaining({ timeout: READY_FLAG_DETECT_TIMEOUT }),
    );
    expect(page.waitForFunction).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      expect.objectContaining({ timeout: 30_000 }),
    );
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it('polls on an interval rather than animation frames', async () => {
    const page = makePage();

    await waitForPageReady(asPage(page));

    for (const [, options] of page.waitForFunction.mock.calls) {
      expect(typeof options.polling).toBe('number');
    }
  });

  it('falls back to network idle when the page never defines the flag', async () => {
    const page = makePage();
    page.waitForFunction.mockRejectedValueOnce(new Error('Waiting failed'));

    await expect(waitForPageReady(asPage(page), 30_000)).resolves.toBe(
      'fallback',
    );

    expect(page.waitForFunction).toHaveBeenCalledTimes(1);
    expect(page.waitForNetworkIdle).toHaveBeenCalledWith({
      idleTime: FALLBACK_IDLE_MS,
      timeout: 30_000,
    });
  });

  it('rejects when the page exposes the flag but never becomes ready', async () => {
    const page = makePage();
    page.waitForFunction
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Waiting failed: 30000ms exceeded'));

    await expect(waitForPageReady(asPage(page), 30_000)).rejects.toThrow(
      /exceeded/,
    );
    expect(page.waitForNetworkIdle).not.toHaveBeenCalled();
  });

  it('propagates a fallback network-idle timeout', async () => {
    const page = makePage();
    page.waitForFunction.mockRejectedValueOnce(new Error('Waiting failed'));
    page.waitForNetworkIdle.mockRejectedValueOnce(new Error('idle timeout'));

    await expect(waitForPageReady(asPage(page))).rejects.toThrow(
      'idle timeout',
    );
  });
});
