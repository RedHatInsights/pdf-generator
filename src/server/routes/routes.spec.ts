import express from 'express';
import PdfCache, { PdfStatus, PDFComponent } from '../../common/pdfCache';

const mockCreateProxyMiddleware = jest.fn((_options?: unknown) =>
  jest.fn((_req: unknown, _res: unknown, next: (error?: unknown) => void) =>
    next(),
  ),
);

const mockConfig = {
  webPort: 8000,
  APIPrefix: '/api/crc-pdf-generator',
  OPTIONS_HEADER_NAME: 'x-pdf-gen-options',
  IDENTITY_HEADER_KEY: 'x-rh-identity',
  IDENTITY_CONTEXT_KEY: 'identity',
  AUTHORIZATION_CONTEXT_KEY: 'x-pdf-auth',
  AUTHORIZATION_HEADER_KEY: 'Authorization',
  REFRESH_TOKEN_CONTEXT_KEY: 'x-pdf-refresh-token',
  JWT_COOKIE_NAME: 'cs_jwt',
  scalprum: {
    apiHost: 'blank' as string,
    assetsHost: 'blank' as string,
  },
  IS_PRODUCTION: false,
};

jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: (options: unknown) =>
    mockCreateProxyMiddleware(options),
}));

jest.mock('./createInternalProxies', () => ({
  __esModule: true,
  default: jest.fn(() => []),
}));

jest.mock('../../common/config', () => ({
  __esModule: true,
  default: mockConfig,
}));

jest.mock('../cluster', () => ({
  cluster: {
    idle: jest.fn().mockResolvedValue(undefined),
    queue: jest.fn(),
  },
}));

jest.mock('../../browser/clusterTask', () => ({
  generatePdf: jest.fn(),
}));

jest.mock('../../browser/previewPDF', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('../render-template', () => ({
  __esModule: true,
  default: jest.fn(() => '<html></html>'),
}));

jest.mock('../../browser/tokenRefresh', () => ({
  TokenManager: jest.fn().mockImplementation(() => ({
    getToken: jest.fn(),
  })),
}));

jest.mock('../../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
  },
  hpmLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
  },
  formatLogError: (value: unknown) =>
    value instanceof Error ? value.message : String(value),
}));

jest.mock('../../common/securityLog', () => ({
  logSecurityEvent: jest.fn(),
  getPrincipalFromContext: jest.fn(() => ({ type: 'anonymous' })),
}));

jest.mock('../../common/store', () => ({
  store: {
    downloadPDF: jest.fn(),
    uploadPDF: jest.fn(),
  },
}));

describe('Status endpoint error propagation', () => {
  const pdfCache = PdfCache.getInstance();

  describe('GET /v2/status/:statusID', () => {
    it('should return 500 with error details when collection has failed', async () => {
      const collectionId = 'test-failed-collection';
      const failedComponent: PDFComponent = {
        status: PdfStatus.Failed,
        filepath: '',
        collectionId,
        componentId: 'test-component-1',
        error: 'Template rendering failed: missing module',
      };

      pdfCache.setExpectedLength(collectionId, 1);
      pdfCache.addToCollection(collectionId, failedComponent);
      await pdfCache.verifyCollection(collectionId);

      const collection = pdfCache.getCollection(collectionId);
      expect(collection.status).toBe(PdfStatus.Failed);
      expect(collection.error).toBe(
        'Template rendering failed: missing module',
      );
    });

    it('should return the error from a failed component when collection error is not set', async () => {
      const collectionId = 'test-component-error';
      const failedComponent: PDFComponent = {
        status: PdfStatus.Failed,
        filepath: '',
        collectionId,
        componentId: 'comp-1',
        error: 'Puppeteer timeout after 60s',
      };

      pdfCache.setExpectedLength(collectionId, 1);
      pdfCache.addToCollection(collectionId, failedComponent);
      await pdfCache.verifyCollection(collectionId);

      const collection = pdfCache.getCollection(collectionId);
      expect(collection.status).toBe(PdfStatus.Failed);
      // The error should be propagated from the component
      const componentError = collection.components.find((c) => c.error)?.error;
      expect(componentError).toBe('Puppeteer timeout after 60s');
    });

    it('should return 200 when collection is still generating', () => {
      const collectionId = 'test-generating';
      const generatingComponent: PDFComponent = {
        status: PdfStatus.Generating,
        filepath: '',
        collectionId,
        componentId: 'comp-gen-1',
      };

      pdfCache.setExpectedLength(collectionId, 1);
      pdfCache.addToCollection(collectionId, generatingComponent);

      const collection = pdfCache.getCollection(collectionId);
      expect(collection.status).toBe(PdfStatus.Generating);
      // Status should not be Failed
      expect(collection.status).not.toBe(PdfStatus.Failed);
    });

    it('should invalidate entire collection when one component fails', async () => {
      const collectionId = 'test-partial-failure';
      const okComponent: PDFComponent = {
        status: PdfStatus.Generated,
        filepath: '/tmp/ok.pdf',
        collectionId,
        componentId: 'comp-ok',
        numPages: 3,
      };
      const failedComponent: PDFComponent = {
        status: PdfStatus.Failed,
        filepath: '',
        collectionId,
        componentId: 'comp-fail',
        error: 'Network error fetching data',
      };

      pdfCache.setExpectedLength(collectionId, 2);
      pdfCache.addToCollection(collectionId, okComponent);
      pdfCache.addToCollection(collectionId, failedComponent);
      await pdfCache.verifyCollection(collectionId);

      const collection = pdfCache.getCollection(collectionId);
      // Entire collection should be marked as Failed
      expect(collection.status).toBe(PdfStatus.Failed);
      expect(collection.error).toBe('Network error fetching data');
    });
  });
});

describe('addProxy', () => {
  const puppeteerQuery =
    'manifestLocation=http%3A%2F%2Fexample.com%2Fmanifest.json&scope=test&module=./App';

  beforeEach(() => {
    mockCreateProxyMiddleware.mockClear();
    mockConfig.scalprum.apiHost = 'blank';
    mockConfig.scalprum.assetsHost = 'blank';
    mockConfig.IS_PRODUCTION = false;
  });

  // Regression guard for RHCLOUD-50438: API_HOST is unset in stage/prod, and
  // apiHost only feeds the dev-only api proxy. A blank apiHost must NOT stop the
  // assets proxy (which serves the federated modules needed to render the PDF).
  it('still creates the assets proxy when apiHost is blank but assetsHost is set', async () => {
    await jest.isolateModulesAsync(async () => {
      mockConfig.scalprum.apiHost = 'blank';
      mockConfig.scalprum.assetsHost = 'https://console.redhat.com';
      mockConfig.IS_PRODUCTION = false;
      const { sendTestRequest } =
        await import('../../__test-utils__/createTestApp');
      const router = (await import('./routes')).default;
      const app = express();
      app.use(router);

      await sendTestRequest(app, 'GET', `/puppeteer?${puppeteerQuery}`, {
        Host: 'evil.example.com',
      });

      // Assets proxy is created; the api proxy is skipped because apiHost is blank.
      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);
      expect(mockCreateProxyMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'https://console.redhat.com' }),
      );
    });
  });

  it('creates only the assets proxy in production (api proxy is dev-only)', async () => {
    await jest.isolateModulesAsync(async () => {
      mockConfig.scalprum.apiHost = 'https://console.redhat.com';
      mockConfig.scalprum.assetsHost = 'https://console.redhat.com';
      mockConfig.IS_PRODUCTION = true;
      const { sendTestRequest } =
        await import('../../__test-utils__/createTestApp');
      const router = (await import('./routes')).default;
      const app = express();
      app.use(router);

      await sendTestRequest(app, 'GET', `/puppeteer?${puppeteerQuery}`, {
        Host: 'pdf.example.com',
      });

      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);
    });
  });

  it('still creates the assets proxy in production when apiHost is blank', async () => {
    await jest.isolateModulesAsync(async () => {
      mockConfig.scalprum.apiHost = 'blank';
      mockConfig.scalprum.assetsHost = 'https://console.redhat.com';
      mockConfig.IS_PRODUCTION = true;
      const { sendTestRequest } =
        await import('../../__test-utils__/createTestApp');
      const router = (await import('./routes')).default;
      const app = express();
      app.use(router);

      await sendTestRequest(app, 'GET', `/puppeteer?${puppeteerQuery}`, {
        Host: 'pdf.example.com',
      });

      expect(mockCreateProxyMiddleware).toHaveBeenCalledTimes(1);
      expect(mockCreateProxyMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({ target: 'https://console.redhat.com' }),
      );
    });
  });

  it('does not create proxies when assetsHost is blank', async () => {
    await jest.isolateModulesAsync(async () => {
      mockConfig.scalprum.apiHost = 'https://console.redhat.com';
      mockConfig.scalprum.assetsHost = 'blank';
      const { sendTestRequest } =
        await import('../../__test-utils__/createTestApp');
      const router = (await import('./routes')).default;
      const app = express();
      app.use(router);

      await sendTestRequest(app, 'GET', `/puppeteer?${puppeteerQuery}`, {
        Host: 'evil.example.com',
      });

      expect(mockConfig.scalprum.assetsHost).toBe('blank');
      expect(mockCreateProxyMiddleware).not.toHaveBeenCalled();
    });
  });

  it('only registers asset and api proxies once', async () => {
    await jest.isolateModulesAsync(async () => {
      mockConfig.scalprum.apiHost = 'https://console.redhat.com';
      mockConfig.scalprum.assetsHost = 'https://console.redhat.com';
      const { sendTestRequest } =
        await import('../../__test-utils__/createTestApp');
      const router = (await import('./routes')).default;
      const app = express();
      app.use(router);

      await sendTestRequest(app, 'GET', `/puppeteer?${puppeteerQuery}`, {
        Host: 'pdf.example.com',
      });
      const callsAfterFirst = mockCreateProxyMiddleware.mock.calls.length;
      expect(callsAfterFirst).toBe(2);

      await sendTestRequest(app, 'GET', `/puppeteer?${puppeteerQuery}`, {
        Host: 'pdf.example.com',
      });
      expect(mockCreateProxyMiddleware.mock.calls.length).toBe(callsAfterFirst);
    });
  });
});
