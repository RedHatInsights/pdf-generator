import PdfCache, { PdfStatus } from '../common/pdfCache';
import { generatePdf } from './clusterTask';
import { AuthState, PdfRequestBody } from '../common/types';

const mockPage = {
  setViewport: jest.fn(),
  on: jest.fn(),
  evaluate: jest.fn().mockResolvedValue(undefined),
  goto: jest
    .fn()
    .mockResolvedValue({ status: () => 200, statusText: () => 'OK' }),
  waitForNetworkIdle: jest.fn(),
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
  getHeaderAndFooterTemplates: () => ({
    headerTemplate: '<div></div>',
    footerTemplate: '<div></div>',
  }),
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

jest.mock('./tokenRefresh', () => ({
  isTokenExpiringSoon: jest.fn().mockReturnValue(false),
  refreshAccessToken: jest.fn(),
}));

const { UpdateStatus } = jest.requireMock('../server/utils');
const { isTokenExpiringSoon, refreshAccessToken } =
  jest.requireMock('./tokenRefresh');

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

function makeAuthState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    authHeader: 'Bearer some-token',
    refreshToken: 'Bearer some-refresh-token',
    ...overrides,
  };
}

function initCollection(collectionId: string) {
  const pdfCache = PdfCache.getInstance();
  pdfCache.setExpectedLength(collectionId, 1);
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
      await generatePdf(req, 'coll-1', 1, makeAuthState());

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
      await generatePdf(makePdfRequest(), 'coll-1', 1, makeAuthState());
      expect(mockPage.close).toHaveBeenCalled();
    });

    it('sets auth header from authState', async () => {
      const authState = makeAuthState({ authHeader: 'Bearer my-token' });
      await generatePdf(makePdfRequest(), 'coll-1', 1, authState);

      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.objectContaining({
          'x-pdf-auth': 'Bearer my-token',
        }),
      );
    });
  });

  describe('page render error', () => {
    it('updates status to Failed when DOM error element exists', async () => {
      mockPage.evaluate.mockResolvedValue(
        'Request failed with status code 401',
      );
      const req = makePdfRequest();
      initCollection('coll-err');

      await expect(
        generatePdf(req, 'coll-err', 1, makeAuthState()),
      ).rejects.toThrow('Page render error');

      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: PdfStatus.Failed,
          componentId: req.uuid,
          collectionId: 'coll-err',
          error: expect.stringContaining('Page render error'),
        }),
      );
    });

    it('throws error without invalidating collection (retry handled by cluster)', async () => {
      mockPage.evaluate.mockResolvedValue('Some error');
      initCollection('coll-inv');
      const pdfCache = PdfCache.getInstance();
      const spy = jest.spyOn(pdfCache, 'invalidateCollection');

      await expect(
        generatePdf(makePdfRequest(), 'coll-inv', 1, makeAuthState()),
      ).rejects.toThrow('Page render error');

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('closes the page after render error', async () => {
      mockPage.evaluate.mockResolvedValue('Error');
      initCollection('coll-close-err');
      await expect(
        generatePdf(makePdfRequest(), 'coll-close-err', 1, makeAuthState()),
      ).rejects.toThrow();
      expect(mockPage.close).toHaveBeenCalled();
    });
  });

  describe('page load failure', () => {
    it('updates status to Failed on 500 response', async () => {
      mockPage.goto.mockResolvedValue({
        status: () => 500,
        statusText: () => 'Internal Server Error',
      });
      const req = makePdfRequest();
      initCollection('coll-500');

      await expect(
        generatePdf(req, 'coll-500', 1, makeAuthState()),
      ).rejects.toThrow('Puppeteer error');

      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: PdfStatus.Failed,
          componentId: req.uuid,
          error: expect.stringContaining('Puppeteer error'),
        }),
      );
    });

    it('updates status to Failed on null response', async () => {
      mockPage.goto.mockResolvedValue(null);
      const req = makePdfRequest();
      initCollection('coll-null');

      await expect(
        generatePdf(req, 'coll-null', 1, makeAuthState()),
      ).rejects.toThrow('Puppeteer error');

      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: PdfStatus.Failed,
        }),
      );
    });
  });

  describe('timeout failure', () => {
    it('updates status to Failed on page.goto timeout', async () => {
      mockPage.goto.mockRejectedValue(
        new Error('TimeoutError: Navigation timeout of 120000ms exceeded'),
      );
      const req = makePdfRequest();
      initCollection('coll-timeout');

      await expect(
        generatePdf(req, 'coll-timeout', 1, makeAuthState()),
      ).rejects.toThrow('timeout');

      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: PdfStatus.Failed,
          error: expect.stringContaining('timeout'),
        }),
      );
    });
  });

  describe('collection already failed', () => {
    it('skips generation and marks component as Failed', async () => {
      const pdfCache = PdfCache.getInstance();
      jest.spyOn(pdfCache, 'isCollectionFailed').mockReturnValue(true);
      const req = makePdfRequest();

      await generatePdf(req, 'coll-already-failed', 1, makeAuthState());

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
    it('refreshes token before setting headers when expiring (proactive)', async () => {
      isTokenExpiringSoon.mockReturnValue(true);
      refreshAccessToken.mockResolvedValue({
        accessToken: 'Bearer refreshed-token',
      });
      const authState = makeAuthState();

      await generatePdf(makePdfRequest(), 'coll-refresh', 1, authState);

      expect(refreshAccessToken).toHaveBeenCalledWith(
        'Bearer some-refresh-token',
      );
      expect(authState.authHeader).toBe('Bearer refreshed-token');
      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.objectContaining({
          'x-pdf-auth': 'Bearer refreshed-token',
        }),
      );
    });

    it('refreshes token after 401 response detected (reactive)', async () => {
      type Response = {
        status: () => number;
        url: () => string;
        ok: () => boolean;
      };

      type ResponseHandler = (response: Response) => Promise<void>;

      isTokenExpiringSoon.mockReturnValue(false);
      refreshAccessToken.mockResolvedValue({
        accessToken: 'Bearer refreshed-after-401',
      });
      const authState = makeAuthState({ authHeader: 'Bearer original-token' });

      // Capture ALL response handlers (there are 2: 401 tracker + asset cache)
      const responseHandlers: ResponseHandler[] = [];
      mockPage.on.mockImplementation(
        (event: string, handler: ResponseHandler) => {
          if (event === 'response') {
            responseHandlers.push(handler);
          }
        },
      );

      mockPage.goto.mockImplementation(async () => {
        // Trigger 401 via first response handler (401 tracker)
        if (responseHandlers[0]) {
          await responseHandlers[0]({
            status: () => 401,
            url: () => 'http://api/endpoint',
            ok: () => false,
          });
        }
        return { status: () => 200, statusText: () => 'OK' };
      });

      await generatePdf(makePdfRequest(), 'coll-reactive', 1, authState);

      expect(refreshAccessToken).toHaveBeenCalledWith(
        'Bearer some-refresh-token',
      );
      expect(authState.authHeader).toBe('Bearer refreshed-after-401');
      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.objectContaining({
          'x-pdf-auth': 'Bearer refreshed-after-401',
        }),
      );
    });

    it('keeps original token when refresh fails', async () => {
      isTokenExpiringSoon.mockReturnValue(true);
      refreshAccessToken.mockResolvedValue(null);
      const authState = makeAuthState({ authHeader: 'Bearer original' });

      await generatePdf(makePdfRequest(), 'coll-no-refresh', 1, authState);

      expect(authState.authHeader).toBe('Bearer original');
      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.objectContaining({
          'x-pdf-auth': 'Bearer original',
        }),
      );
    });

    it('does not refresh when token is still fresh', async () => {
      isTokenExpiringSoon.mockReturnValue(false);

      await generatePdf(makePdfRequest(), 'coll-fresh', 1, makeAuthState());

      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it('does not refresh when no refresh token is available', async () => {
      isTokenExpiringSoon.mockReturnValue(true);
      const authState = makeAuthState({ refreshToken: undefined });

      await generatePdf(makePdfRequest(), 'coll-no-rt', 1, authState);

      expect(refreshAccessToken).not.toHaveBeenCalled();
    });

    it('generates successfully without refresh token', async () => {
      isTokenExpiringSoon.mockReturnValue(false);
      const authState = makeAuthState({ refreshToken: undefined });

      await generatePdf(makePdfRequest(), 'coll-no-rt-ok', 1, authState);

      expect(refreshAccessToken).not.toHaveBeenCalled();
      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
    });

    it('generates successfully without any auth', async () => {
      isTokenExpiringSoon.mockReturnValue(false);
      const authState: AuthState = {};

      await generatePdf(makePdfRequest(), 'coll-no-auth', 1, authState);

      expect(refreshAccessToken).not.toHaveBeenCalled();
      expect(UpdateStatus).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: PdfStatus.Generated }),
      );
      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.not.objectContaining({ 'x-pdf-auth': expect.anything() }),
      );
    });

    it('updates shared authState so subsequent tasks see refreshed token', async () => {
      const authState = makeAuthState();
      isTokenExpiringSoon.mockReturnValueOnce(true).mockReturnValue(false);
      refreshAccessToken.mockResolvedValue({
        accessToken: 'Bearer new-shared-token',
      });

      await generatePdf(makePdfRequest(), 'coll-shared-1', 1, authState);

      expect(authState.authHeader).toBe('Bearer new-shared-token');

      await generatePdf(makePdfRequest(), 'coll-shared-2', 2, authState);

      expect(mockPage.setExtraHTTPHeaders).toHaveBeenLastCalledWith(
        expect.objectContaining({
          'x-pdf-auth': 'Bearer new-shared-token',
        }),
      );
    });
  });
});
