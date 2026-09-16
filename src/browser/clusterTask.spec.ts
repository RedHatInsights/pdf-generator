import PdfCache, { PdfStatus } from '../common/pdfCache';
import { generatePdf } from './clusterTask';
import { PdfRequestBody } from '../common/types';
import { TokenManager } from './tokenRefresh';
import { PdfGenerationError } from '../server/errors';
// Metrics are deliberately not mocked: prom-client works in node, and the point
// of these assertions is that the real counters move.
import { register } from 'prom-client';
import { ComponentOutcome, componentResultTotal } from '../common/metrics';

const mockPage = {
  setViewport: jest.fn(),
  on: jest.fn(),
  evaluate: jest.fn().mockResolvedValue(undefined),
  goto: jest
    .fn()
    .mockResolvedValue({ status: () => 200, statusText: () => 'OK' }),
  waitForNetworkIdle: jest.fn(),
  waitForSelector: jest.fn().mockResolvedValue(undefined),
  setExtraHTTPHeaders: jest.fn(),
  setRequestInterception: jest.fn(),
  setCookie: jest.fn(),
  pdf: jest.fn().mockResolvedValue(Buffer.from('')),
  close: jest.fn(),
};

jest.mock('../server/cluster', () => ({
  cluster: {
    queue: jest.fn(
      (
        _taskData: unknown,
        taskFn: ({ page }: { page: unknown }) => Promise<void>,
      ) => taskFn({ page: mockPage }),
    ),
  },
}));

jest.mock('../common/config', () => ({
  __esModule: true,
  default: {
    webPort: 8000,
    OPTIONS_HEADER_NAME: 'x-pdf-gen-options',
    IDENTITY_HEADER_KEY: 'x-rh-identity',
    AUTHORIZATION_CONTEXT_KEY: 'x-pdf-auth',
    AUTHORIZATION_HEADER_KEY: 'Authorization',
    JWT_COOKIE_NAME: 'cs_jwt',
    SSO_URL: 'https://sso.example.com/auth/',
    SSO_CLIENT_ID: 'cloud-services',
  },
}));

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../server/utils', () => ({
  UpdateStatus: jest.fn(),
  isValidPageResponse: (code: number) => code >= 200 && code < 400,
}));

jest.mock('./helpers', () => ({
  pageWidth: 1024,
  pageHeight: 768,
  setWindowProperty: jest.fn(),
}));

jest.mock('../server/render-template', () => ({
  getHeaderAndFooterTemplates: jest.fn(() => ({
    headerTemplate: '<div></div>',
    footerTemplate: '<div></div>',
  })),
  resolveHeaderBrand: (additionalData?: Record<string, unknown>) =>
    additionalData?.headerBrand === 'lightwell' ? 'lightwell' : 'redhat',
}));

jest.mock('../common/store', () => ({
  store: {
    uploadPDF: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    load: jest.fn().mockResolvedValue({
      getPages: () => [{}],
    }),
  },
}));

const { UpdateStatus } = jest.requireMock('../server/utils');

async function outcomeCount(outcome: ComponentOutcome): Promise<number> {
  const metric = await componentResultTotal.get();
  return metric.values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
}

function makePdfRequest(
  overrides: Partial<PdfRequestBody> = {},
): PdfRequestBody {
  return {
    manifestLocation: 'https://example.com/manifest.json',
    scope: 'test',
    module: './TestModule',
    uuid: 'comp-' + Math.random().toString(36).slice(2, 8),
    url: 'http://localhost:8000/puppeteer?scope=test',
    ...overrides,
  };
}

function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify({ exp })).toString('base64url');
  return `${header}.${body}.fake`;
}

const FRESH_TOKEN = `Bearer ${makeJwt(Math.floor(Date.now() / 1000) + 600)}`;
const EXPIRING_TOKEN = `Bearer ${makeJwt(Math.floor(Date.now() / 1000) + 10)}`;

function makeTokenManager(
  authHeader = FRESH_TOKEN,
  refreshToken = 'Bearer some-refresh-token',
): TokenManager {
  return new TokenManager(authHeader, refreshToken);
}

function initCollection(collectionId: string) {
  const pdfCache = PdfCache.getInstance();
  pdfCache.setExpectedLength(collectionId, 1);
}

type MockInterceptedRequest = {
  url: () => string;
  method: () => string;
  headers: () => Record<string, string>;
  continue: jest.Mock;
  respond: jest.Mock;
};

function makeInterceptedRequest(url: string): MockInterceptedRequest {
  return {
    url: () => url,
    method: () => 'GET',
    headers: () => ({}),
    continue: jest.fn(),
    respond: jest.fn(),
  };
}

async function getRequestInterceptorResult(url: string): Promise<jest.Mock> {
  const handler = mockPage.on.mock.calls.find(
    ([event]: [string]) => event === 'request',
  )?.[1];
  const req = makeInterceptedRequest(url);
  if (handler) {
    await handler(req);
  }
  return req.continue;
}

describe('generatePdf', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPage.goto.mockResolvedValue({
      status: () => 200,
      statusText: () => 'OK',
    });
    mockPage.evaluate.mockResolvedValue(undefined);
    mockPage.pdf.mockResolvedValue(Buffer.from(''));
    mockPage.close.mockResolvedValue(undefined);
  });

  describe('successful generation', () => {
    it('updates status to Generating then Generated', async () => {
      const req = makePdfRequest();
      await generatePdf(req, 'coll-1', 1, makeTokenManager());

      expect(UpdateStatus).toHaveBeenCalledTimes(2);
      expect(UpdateStatus).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          status: PdfStatus.Generating,
          componentId: req.uuid,
          collectionId: 'coll-1',
        }),
      );
      expect(UpdateStatus).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          status: PdfStatus.Generated,
          componentId: req.uuid,
          collectionId: 'coll-1',
        }),
      );
    });

    it('closes the page after success', async () => {
      await generatePdf(makePdfRequest(), 'coll-1', 1, makeTokenManager());
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('uses Lightwell header branding when requested', async () => {
      const { getHeaderAndFooterTemplates } = jest.requireMock(
        '../server/render-template',
      );
      const fakeSvg = '<svg><circle r="10"/></svg>';
      // First evaluate = error check (no error), second = logo extraction
      mockPage.evaluate
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(fakeSvg);

      await generatePdf(
        makePdfRequest({ additionalData: { headerBrand: 'lightwell' } }),
        'coll-1',
        1,
        makeTokenManager(),
      );

      expect(getHeaderAndFooterTemplates).toHaveBeenCalledWith(
        'lightwell',
        fakeSvg,
      );
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          margin: {
            top: '80px',
            bottom: '54px',
            left: '28px',
            right: '28px',
          },
        }),
      );
    });

    it('falls back to text-only Lightwell header when logo extraction returns null', async () => {
      const { getHeaderAndFooterTemplates } = jest.requireMock(
        '../server/render-template',
      );
      // First evaluate = error check (no error), second = logo extraction (null)
      mockPage.evaluate
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(null);

      await generatePdf(
        makePdfRequest({ additionalData: { headerBrand: 'lightwell' } }),
        'coll-1',
        1,
        makeTokenManager(),
      );

      expect(getHeaderAndFooterTemplates).toHaveBeenCalledWith(
        'lightwell',
        null,
      );
    });

    it('keeps Red Hat header branding by default', async () => {
      const { getHeaderAndFooterTemplates } = jest.requireMock(
        '../server/render-template',
      );

      await generatePdf(makePdfRequest(), 'coll-1', 1, makeTokenManager());

      expect(getHeaderAndFooterTemplates).toHaveBeenCalledWith('redhat', null);
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          margin: { top: '54px', bottom: '54px' },
        }),
      );
    });

    it('forwards auth header to same-origin (localhost) requests', async () => {
      const tm = makeTokenManager('Bearer my-token');
      await generatePdf(makePdfRequest(), 'coll-1', 1, tm);

      const continueMock = await getRequestInterceptorResult(
        'http://localhost:8000/api/something',
      );
      expect(continueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-pdf-auth': 'Bearer my-token' }),
        }),
      );
    });

    it('does not forward auth header to cross-origin requests', async () => {
      const tm = makeTokenManager('Bearer my-token');
      await generatePdf(makePdfRequest(), 'coll-1', 1, tm);

      const continueMock = await getRequestInterceptorResult(
        'https://cdn.example.com/script.js',
      );
      expect(continueMock).toHaveBeenCalledWith();
    });
  });

  describe('page render error', () => {
    it('throws error without calling UpdateStatus(Failed) - retry not defeated', async () => {
      mockPage.evaluate.mockResolvedValue(
        'Request failed with status code 401',
      );
      const req = makePdfRequest();
      initCollection('coll-err');

      await expect(
        generatePdf(req, 'coll-err', 1, makeTokenManager()),
      ).rejects.toThrow('Page render error');

      // UpdateStatus called once for Generating, never for Failed (catch block removed it)
      expect(UpdateStatus).toHaveBeenCalledTimes(1);
      expect(UpdateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: PdfStatus.Generating }),
      );
    });

    it('throws error without invalidating collection (retry handled by cluster)', async () => {
      mockPage.evaluate.mockResolvedValue('Some error');
      initCollection('coll-inv');
      const pdfCache = PdfCache.getInstance();
      const spy = jest.spyOn(pdfCache, 'invalidateCollection');

      await expect(
        generatePdf(makePdfRequest(), 'coll-inv', 1, makeTokenManager()),
      ).rejects.toThrow('Page render error');

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('closes the page after render error', async () => {
      mockPage.evaluate.mockResolvedValue('Error');
      initCollection('coll-close-err');
      await expect(
        generatePdf(makePdfRequest(), 'coll-close-err', 1, makeTokenManager()),
      ).rejects.toThrow();
      expect(mockPage.close).toHaveBeenCalled();
    });
  });

  describe('page load failure', () => {
    it('throws error without calling UpdateStatus(Failed) on 500 response', async () => {
      mockPage.goto.mockResolvedValue({
        status: () => 500,
        statusText: () => 'Internal Server Error',
      });
      const req = makePdfRequest();
      initCollection('coll-500');

      await expect(
        generatePdf(req, 'coll-500', 1, makeTokenManager()),
      ).rejects.toThrow('Puppeteer error');

      // Only Generating status, no Failed
      expect(UpdateStatus).toHaveBeenCalledTimes(1);
      expect(UpdateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: PdfStatus.Generating }),
      );
    });

    it('throws error without calling UpdateStatus(Failed) on null response', async () => {
      mockPage.goto.mockResolvedValue(null);
      const req = makePdfRequest();
      initCollection('coll-null');

      await expect(
        generatePdf(req, 'coll-null', 1, makeTokenManager()),
      ).rejects.toThrow('Puppeteer error');

      // Only Generating status, no Failed
      expect(UpdateStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('error wrapping', () => {
    it('wraps non-PdfGenerationError in PdfGenerationError with collectionId and componentId', async () => {
      mockPage.pdf.mockRejectedValue(new Error('pdf generation crashed'));
      const req = makePdfRequest();
      initCollection('coll-wrap');

      const error = await generatePdf(
        req,
        'coll-wrap',
        1,
        makeTokenManager(),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PdfGenerationError);
      if (error instanceof PdfGenerationError) {
        expect(error.collectionId).toBe('coll-wrap');
        expect(error.componentId).toBe(req.uuid);
        expect(error.message).toContain('pdf generation crashed');
      }
    });

    it('does not double-wrap PdfGenerationError', async () => {
      mockPage.evaluate.mockResolvedValue('Some render error');
      const req = makePdfRequest();
      initCollection('coll-no-double');

      const error = await generatePdf(
        req,
        'coll-no-double',
        1,
        makeTokenManager(),
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PdfGenerationError);
      if (error instanceof PdfGenerationError) {
        expect(error.message).toContain('Page render error');
        expect(error.collectionId).toBe('coll-no-double');
      }
    });
  });

  describe('collection already failed', () => {
    it('skips generation and marks component as Failed', async () => {
      const pdfCache = PdfCache.getInstance();
      jest.spyOn(pdfCache, 'isCollectionFailed').mockReturnValue(true);
      const req = makePdfRequest();

      await generatePdf(req, 'coll-already-failed', 1, makeTokenManager());

      expect(UpdateStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PdfStatus.Failed,
          componentId: req.uuid,
          error: 'Collection failed before this component started',
        }),
      );
      expect(mockPage.goto).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    });
  });

  describe('token refresh integration', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('refreshes token before setting headers when expiring', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'refreshed-token' }),
      });
      const tm = makeTokenManager(EXPIRING_TOKEN);

      await generatePdf(makePdfRequest(), 'coll-refresh', 1, tm);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(tm.currentToken).toBe('Bearer refreshed-token');
      const continueMock = await getRequestInterceptorResult(
        'http://localhost:8000/api/something',
      );
      expect(continueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-pdf-auth': 'Bearer refreshed-token',
          }),
        }),
      );
    });

    it('skips auth header on permanent refresh failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      });
      const tm = makeTokenManager(EXPIRING_TOKEN);

      await generatePdf(makePdfRequest(), 'coll-no-refresh', 1, tm);

      expect(tm.currentToken).toBe(EXPIRING_TOKEN);
      const continueMock = await getRequestInterceptorResult(
        'http://localhost:8000/api/something',
      );
      // When auth header is absent, continue() is called without overrides
      // (no extraHeaders means no localhost header injection either)
      expect(continueMock).toHaveBeenCalledWith();
    });

    it('does not refresh when token is still fresh', async () => {
      global.fetch = jest.fn();

      await generatePdf(makePdfRequest(), 'coll-fresh', 1, makeTokenManager());

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('does not refresh when no refresh token is available', async () => {
      global.fetch = jest.fn();
      const tm = new TokenManager(EXPIRING_TOKEN, undefined);

      await generatePdf(makePdfRequest(), 'coll-no-rt', 1, tm);

      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('generates successfully without refresh token', async () => {
      const tm = new TokenManager(FRESH_TOKEN, undefined);

      await generatePdf(makePdfRequest(), 'coll-no-rt-ok', 1, tm);

      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
    });

    it('generates successfully without any auth', async () => {
      const tm = new TokenManager(undefined, undefined);

      await generatePdf(makePdfRequest(), 'coll-no-auth', 1, tm);

      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
      const continueMock = await getRequestInterceptorResult(
        'http://localhost:8000/api/something',
      );
      expect(continueMock).toHaveBeenCalledWith();
    });

    it('propagates uploadPDF error to cluster for retry', async () => {
      const { store } = jest.requireMock('../common/store');
      store.uploadPDF.mockRejectedValueOnce(
        new Error('S3 upload failed after 4 attempts'),
      );
      initCollection('coll-upload-fail');

      await expect(
        generatePdf(
          makePdfRequest(),
          'coll-upload-fail',
          1,
          makeTokenManager(),
        ),
      ).rejects.toThrow('S3 upload failed');
    });

    it('closes the page after upload failure', async () => {
      const { store } = jest.requireMock('../common/store');
      store.uploadPDF.mockRejectedValueOnce(new Error('upload error'));
      initCollection('coll-upload-close');

      await expect(
        generatePdf(
          makePdfRequest(),
          'coll-upload-close',
          1,
          makeTokenManager(),
        ),
      ).rejects.toThrow();

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('updates shared token manager so subsequent tasks see refreshed token', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'new-shared-token' }),
      });
      const tm = makeTokenManager(EXPIRING_TOKEN);

      await generatePdf(makePdfRequest(), 'coll-shared-1', 1, tm);

      expect(tm.currentToken).toBe('Bearer new-shared-token');

      // Isolate the subsequent task's request handler from the first call
      jest.clearAllMocks();

      await generatePdf(makePdfRequest(), 'coll-shared-2', 2, tm);

      const continueMock = await getRequestInterceptorResult(
        'http://localhost:8000/api/something',
      );
      expect(continueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-pdf-auth': 'Bearer new-shared-token',
          }),
        }),
      );
    });

    it('coalesces concurrent refreshes into a single SSO call', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'shared-refreshed' }),
      });
      const tm = makeTokenManager(EXPIRING_TOKEN);

      await Promise.all([
        generatePdf(makePdfRequest(), 'coll-coalesce', 1, tm),
        generatePdf(makePdfRequest(), 'coll-coalesce', 2, tm),
      ]);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(tm.currentToken).toBe('Bearer shared-refreshed');
    });

    it('stops retrying SSO after permanent failure', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('invalid_grant'),
      });
      const tm = makeTokenManager(EXPIRING_TOKEN);

      await generatePdf(makePdfRequest(), 'coll-perm-1', 1, tm);
      await generatePdf(makePdfRequest(), 'coll-perm-2', 2, tm);

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('retries SSO after transient failure', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          text: () => Promise.resolve('Service Unavailable'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'recovered' }),
        });
      const tm = makeTokenManager(EXPIRING_TOKEN);

      await generatePdf(makePdfRequest(), 'coll-trans-1', 1, tm);
      expect(tm.currentToken).toBe(EXPIRING_TOKEN);

      await generatePdf(makePdfRequest(), 'coll-trans-2', 2, tm);
      expect(tm.currentToken).toBe('Bearer recovered');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('response handler', () => {
    function getResponseHandler(): (response: unknown) => Promise<void> {
      const calls = mockPage.on.mock.calls.filter(
        ([event]: [string]) => event === 'response',
      );
      return calls[calls.length - 1][1] as (response: unknown) => Promise<void>;
    }

    it('logs error responses with status >= 400', async () => {
      const { apiLogger } = jest.requireMock('../common/logging');
      await generatePdf(
        makePdfRequest(),
        'coll-resp-err',
        1,
        makeTokenManager(),
      );

      const handler = getResponseHandler();
      await handler({
        status: () => 502,
        url: () => 'https://example.com/api/data',
        text: () => Promise.resolve('Bad Gateway'),
        ok: () => false,
        headers: () => ({}),
      });

      expect(apiLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('502'),
      );
      expect(apiLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Bad Gateway'),
      );
    });

    it('logs <unreadable> when error response body cannot be read', async () => {
      const { apiLogger } = jest.requireMock('../common/logging');
      await generatePdf(
        makePdfRequest(),
        'coll-resp-unread',
        1,
        makeTokenManager(),
      );

      const handler = getResponseHandler();
      await handler({
        status: () => 500,
        url: () => 'https://example.com/api/fail',
        text: () => Promise.reject(new Error('body stream consumed')),
        ok: () => false,
        headers: () => ({}),
      });

      expect(apiLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('<unreadable>'),
      );
    });

    it('caches successful JS/CSS asset responses', async () => {
      await generatePdf(
        makePdfRequest(),
        'coll-resp-cache',
        1,
        makeTokenManager(),
      );

      const handler = getResponseHandler();
      const assetBody = Buffer.from('console.log("cached")');
      await handler({
        status: () => 200,
        url: () => 'https://example.com/apps/my-app/bundle.js?v=1',
        ok: () => true,
        buffer: () => Promise.resolve(assetBody),
        headers: () => ({ 'content-type': 'application/javascript' }),
      });

      // Trigger a second request for the same asset via the request handler
      const requestCalls = mockPage.on.mock.calls.filter(
        ([event]: [string]) => event === 'request',
      );
      const requestHandler = requestCalls[requestCalls.length - 1][1];

      const respondFn = jest.fn();
      const continueFn = jest.fn();
      await requestHandler({
        method: () => 'GET',
        url: () => 'https://example.com/apps/my-app/bundle.js?v=2',
        respond: respondFn,
        continue: continueFn,
      });

      expect(respondFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 200,
          contentType: 'application/javascript',
          body: assetBody,
        }),
      );
      expect(continueFn).not.toHaveBeenCalled();
    });

    it('does not cache non-asset responses', async () => {
      await generatePdf(
        makePdfRequest(),
        'coll-resp-no-cache',
        1,
        makeTokenManager(),
      );

      const handler = getResponseHandler();
      await handler({
        status: () => 200,
        url: () => 'https://example.com/api/data',
        ok: () => true,
        buffer: () => Promise.resolve(Buffer.from('data')),
        headers: () => ({ 'content-type': 'application/json' }),
      });

      // Non-asset URL should not be cached — request should continue normally
      const requestCalls = mockPage.on.mock.calls.filter(
        ([event]: [string]) => event === 'request',
      );
      const requestHandler = requestCalls[requestCalls.length - 1][1];

      const respondFn = jest.fn();
      const continueFn = jest.fn();
      await requestHandler({
        method: () => 'GET',
        url: () => 'https://example.com/api/data',
        respond: respondFn,
        continue: continueFn,
      });

      expect(continueFn).toHaveBeenCalled();
      expect(respondFn).not.toHaveBeenCalled();
    });

    it('does not cache error responses as assets', async () => {
      await generatePdf(
        makePdfRequest(),
        'coll-resp-err-no-cache',
        1,
        makeTokenManager(),
      );

      const handler = getResponseHandler();
      await handler({
        status: () => 404,
        url: () => 'https://example.com/apps/my-app/missing.js',
        ok: () => false,
        text: () => Promise.resolve('Not Found'),
        headers: () => ({}),
      });

      // 404 asset should not be cached — request should continue normally
      const requestCalls = mockPage.on.mock.calls.filter(
        ([event]: [string]) => event === 'request',
      );
      const requestHandler = requestCalls[requestCalls.length - 1][1];

      const respondFn = jest.fn();
      const continueFn = jest.fn();
      await requestHandler({
        method: () => 'GET',
        url: () => 'https://example.com/apps/my-app/missing.js',
        respond: respondFn,
        continue: continueFn,
      });

      expect(continueFn).toHaveBeenCalled();
      expect(respondFn).not.toHaveBeenCalled();
    });
  });

  /**
   * A build, bundling or federation break upstream renders an empty page rather
   * than an error: the app never mounts, so no #crc-pdf-generator-err exists to
   * find, and the component is reported Generated with a header/footer-only PDF.
   * These assert the task refuses to call a contentless page a success, whatever
   * caused it — the backstop that turns a silent regression into a loud one.
   */
  describe('blank render detection', () => {
    const { store } = jest.requireMock('../common/store');

    type FakeElement = {
      innerText: string;
      innerHTML: string;
      childElementCount: number;
    };

    /** A stub element, described by its markup — text is derived, not required. */
    function element(innerHTML: string, innerText = ''): FakeElement {
      return {
        innerHTML,
        innerText,
        childElementCount: (innerHTML.match(/<[a-zA-Z]/g) ?? []).length,
      };
    }

    /** Runs page.evaluate callbacks against a stub DOM instead of stubbing their results. */
    function useFakeDom(
      elements: Record<string, FakeElement>,
      bodyText = '',
    ): void {
      const document = {
        getElementById: (id: string): FakeElement | null =>
          elements[id] ?? null,
        body: {
          innerText: bodyText,
          textContent: bodyText,
          innerHTML: elements.root?.innerHTML ?? '',
        },
        documentElement: { innerText: bodyText },
      };
      mockPage.evaluate.mockImplementation(
        async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
          const globals = globalThis as { document?: unknown };
          const previous = globals.document;
          globals.document = document;
          try {
            return fn(...args);
          } finally {
            globals.document = previous;
          }
        },
      );
    }

    it('fails the component when the error element is present but empty', async () => {
      useFakeDom({ 'crc-pdf-generator-err': element('') });
      initCollection('coll-empty-err');

      await expect(
        generatePdf(makePdfRequest(), 'coll-empty-err', 1, makeTokenManager()),
      ).rejects.toThrow(PdfGenerationError);

      expect(UpdateStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
    });

    it('fails the component when the page rendered no content at all', async () => {
      useFakeDom({ root: element('') });
      initCollection('coll-blank');

      await expect(
        generatePdf(makePdfRequest(), 'coll-blank', 1, makeTokenManager()),
      ).rejects.toThrow(PdfGenerationError);

      expect(UpdateStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
    });

    it('does not upload a PDF produced from a blank page', async () => {
      useFakeDom({ root: element('') });
      initCollection('coll-blank-upload');

      await expect(
        generatePdf(
          makePdfRequest(),
          'coll-blank-upload',
          1,
          makeTokenManager(),
        ),
      ).rejects.toThrow();

      expect(store.uploadPDF).not.toHaveBeenCalled();
    });

    it('closes the page after a blank render', async () => {
      useFakeDom({ root: element('') });
      initCollection('coll-blank-close');

      await expect(
        generatePdf(
          makePdfRequest(),
          'coll-blank-close',
          1,
          makeTokenManager(),
        ),
      ).rejects.toThrow();

      expect(mockPage.close).toHaveBeenCalled();
    });

    it('generates normally when the page rendered content', async () => {
      useFakeDom(
        {
          root: element(
            '<h1>Executive report: Advisor</h1>',
            'Executive report: Advisor',
          ),
        },
        'Executive report: Advisor',
      );
      initCollection('coll-rendered');

      await generatePdf(
        makePdfRequest(),
        'coll-rendered',
        1,
        makeTokenManager(),
      );

      expect(UpdateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
      expect(store.uploadPDF).toHaveBeenCalled();
    });

    it('counts a blank render as blank, not as a generic failure', async () => {
      // The alert that would have caught RHCLOUD-51334 keys off this label, so
      // a blank page must not be filed under the same outcome as a render error.
      register.resetMetrics();
      useFakeDom({ root: element('') });
      initCollection('coll-metric-blank');

      await expect(
        generatePdf(
          makePdfRequest(),
          'coll-metric-blank',
          1,
          makeTokenManager(),
        ),
      ).rejects.toThrow();

      await expect(outcomeCount(ComponentOutcome.Blank)).resolves.toBe(1);
      await expect(outcomeCount(ComponentOutcome.Failed)).resolves.toBe(0);
    });

    it('counts a real render error as failed, not as blank', async () => {
      register.resetMetrics();
      mockPage.evaluate.mockResolvedValue(
        'Request failed with status code 401',
      );
      initCollection('coll-metric-failed');

      await expect(
        generatePdf(
          makePdfRequest(),
          'coll-metric-failed',
          1,
          makeTokenManager(),
        ),
      ).rejects.toThrow();

      await expect(outcomeCount(ComponentOutcome.Failed)).resolves.toBe(1);
      await expect(outcomeCount(ComponentOutcome.Blank)).resolves.toBe(0);
    });

    it('counts a successful render as generated', async () => {
      register.resetMetrics();
      useFakeDom({ root: element('<h1>Report</h1>', 'Report') });
      initCollection('coll-metric-ok');

      await generatePdf(
        makePdfRequest(),
        'coll-metric-ok',
        1,
        makeTokenManager(),
      );

      await expect(outcomeCount(ComponentOutcome.Generated)).resolves.toBe(1);
    });

    it('generates normally for a chart-only report with no text', async () => {
      // Advisor's executive report is largely Victory/SVG. "Rendered" has to mean
      // markup was produced, not that text was produced, or a valid visual report
      // gets rejected as blank.
      useFakeDom({ root: element('<svg><circle r="10"></circle></svg>') });
      initCollection('coll-visual');

      await generatePdf(makePdfRequest(), 'coll-visual', 1, makeTokenManager());

      expect(UpdateStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
      expect(store.uploadPDF).toHaveBeenCalled();
    });
  });
});
