jest.mock('../cluster', () => ({
  cluster: {
    queue: jest.fn(),
    idle: jest.fn(),
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
  default: jest.fn(),
}));

jest.mock('./createInternalProxies', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(),
}));

jest.mock('express-http-context', () => ({
  get: jest.fn(),
}));

jest.mock('../../common/kafka', () => ({
  produceMessage: jest.fn(),
  KafkaClient: jest.fn(),
}));

jest.mock('../../common/store', () => ({
  store: {
    getObject: jest.fn(),
    uploadPDF: jest.fn(),
  },
}));

jest.mock('../../common/config', () => ({
  __esModule: true,
  default: {
    webPort: 8000,
    APIPrefix: '/api/crc-pdf-generator',
    JWT_COOKIE_NAME: 'cs_jwt',
    AUTHORIZATION_CONTEXT_KEY: 'x-pdf-auth',
    REFRESH_TOKEN_CONTEXT_KEY: 'x-pdf-refresh-token',
    IDENTITY_HEADER_KEY: 'x-rh-identity',
    OPTIONS_HEADER_NAME: 'x-pdf-gen-options',
    kafka: { brokers: [] },
    scalprum: { apiHost: 'blank', assetsHost: 'blank' },
  },
}));

import PdfCache, { PdfStatus, PDFComponent } from '../../common/pdfCache';
import { getPdfRequestBody } from './routes';
import { GeneratePayload } from '../../common/types';

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

describe('getPdfRequestBody', () => {
  it('includes renderReadiness in the puppeteer URL when provided', () => {
    const payload: GeneratePayload = {
      manifestLocation: '/apps/landing/fed-mods.json',
      scope: 'landing',
      module: './PdfEntry',
      renderReadiness: 'explicit-v1',
    };

    const body = getPdfRequestBody(payload);
    const url = new URL(body.url);

    expect(url.searchParams.get('renderReadiness')).toBe('explicit-v1');
    expect(body.renderReadiness).toBe('explicit-v1');
  });

  it('omits renderReadiness from the puppeteer URL when not provided', () => {
    const payload: GeneratePayload = {
      manifestLocation: '/apps/landing/fed-mods.json',
      scope: 'landing',
      module: './PdfEntry',
    };

    const body = getPdfRequestBody(payload);
    const url = new URL(body.url);

    expect(url.searchParams.has('renderReadiness')).toBe(false);
  });
});
