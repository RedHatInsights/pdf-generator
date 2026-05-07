import { Readable } from 'stream';

// Mock heavy dependencies before importing routes
jest.mock('../../browser/clusterTask', () => ({
  generatePdf: jest.fn(),
}));

jest.mock('../cluster', () => ({
  cluster: {
    idle: jest.fn().mockResolvedValue(undefined),
    queue: jest.fn(),
  },
}));

jest.mock('../../common/kafka', () => ({
  produceMessage: jest.fn().mockResolvedValue(undefined),
  consumeMessages: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./createInternalProxies', () => ({
  __esModule: true,
  default: () => [],
}));

jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: jest.fn(
    () => (_req: unknown, _res: unknown, next: () => void) => next(),
  ),
}));

jest.mock('../render-template', () => ({
  __esModule: true,
  default: jest.fn(() => '<html>mock</html>'),
}));

jest.mock('../../common/store', () => {
  const mockStore = {
    intialize: jest.fn(),
    uploadPDF: jest.fn().mockResolvedValue(undefined),
    downloadPDF: jest.fn().mockResolvedValue(undefined),
  };
  return {
    store: mockStore,
  };
});

import express from 'express';
import request from 'supertest';
import httpContext from 'express-http-context';
import cookieParser from 'cookie-parser';
import router from './routes';
import identityMiddleware from '../../middleware/identity-middleware';
import config from '../../common/config';
import PdfCache, { PdfStatus, PDFComponent } from '../../common/pdfCache';
import { generatePdf } from '../../browser/clusterTask';
import { store } from '../../common/store';

// eslint-disable-next-line @typescript-eslint/unbound-method
const mockDownloadPDF = jest.mocked(store.downloadPDF);
const mockGeneratePdf = jest.mocked(generatePdf);
const API_PREFIX = config?.APIPrefix || '/api/crc-pdf-generator';
const pdfCache = PdfCache.getInstance();

/**
 * Build a test Express app mirroring production middleware setup.
 * Identity middleware is only applied to /v2/create and /preview routes.
 */
function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(httpContext.middleware);
  app.use(`${API_PREFIX}/v2/create`, identityMiddleware);
  app.use('/preview', identityMiddleware);
  app.use('/', router);
  return app;
}

const app = createTestApp();

/** Base64-encoded x-rh-identity header for test requests. */
const TEST_IDENTITY = Buffer.from(
  JSON.stringify({ identity: { user: { user_id: '12345' } } }),
).toString('base64');

/** Valid payload for POST /v2/create */
const validPayload = {
  payload: {
    manifestLocation: '/apps/test-app/fed-mods.json',
    scope: 'testScope',
    module: './TestModule',
  },
};

describe('PDF Generator API', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: true });
  });

  afterEach(() => {
    // Clear PdfCache timeouts and mocks between tests
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── POST /v2/create ───────────────────────────────────────────────

  describe('POST /v2/create', () => {
    it('should return 202 with a statusID for a valid request', async () => {
      const res = await request(app)
        .post(`${API_PREFIX}/v2/create`)
        .set('x-rh-identity', TEST_IDENTITY)
        .send(validPayload)
        .expect(202);

      expect(res.body).toHaveProperty('statusID');
      expect(typeof res.body.statusID).toBe('string');
      expect(res.body.statusID).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(mockGeneratePdf).toHaveBeenCalledTimes(1);

      // Clean up
      pdfCache.deleteCollection(res.body.statusID);
    });

    it('should handle 10 concurrent requests with unique IDs', async () => {
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post(`${API_PREFIX}/v2/create`)
          .set('x-rh-identity', TEST_IDENTITY)
          .send(validPayload),
      );

      const responses = await Promise.all(requests);
      const statusIDs: string[] = responses.map(
        (r) => r.body.statusID as string,
      );

      // All should return 202
      responses.forEach((r) => expect(r.status).toBe(202));

      // All IDs should be unique
      const uniqueIDs = new Set(statusIDs);
      expect(uniqueIDs.size).toBe(10);

      // Clean up
      statusIDs.forEach((id: string) => pdfCache.deleteCollection(id));
    });

    it('should return 500 when generatePdf throws', async () => {
      mockGeneratePdf.mockImplementationOnce(() => {
        throw new Error('Puppeteer crash');
      });

      const res = await request(app)
        .post(`${API_PREFIX}/v2/create`)
        .set('x-rh-identity', TEST_IDENTITY)
        .send(validPayload)
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(500);
      expect(res.body.error.statusText).toBe('Internal server error');
    });
  });

  // ── GET /v2/status/:statusID ──────────────────────────────────────

  describe('GET /v2/status/:statusID', () => {
    it('should return 200 with status for a known collection', async () => {
      const collectionId = 'test-status-known';
      const component: PDFComponent = {
        status: PdfStatus.Generating,
        filepath: '',
        collectionId,
        componentId: 'comp-1',
      };
      pdfCache.setExpectedLength(collectionId, 1);
      pdfCache.addToCollection(collectionId, component);

      const res = await request(app)
        .get(`${API_PREFIX}/v2/status/${collectionId}`)
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(res.body.status.status).toBe(PdfStatus.Generating);

      pdfCache.deleteCollection(collectionId);
    });

    it('should return 404 for a nonexistent status ID', async () => {
      const res = await request(app)
        .get(`${API_PREFIX}/v2/status/nonexistent-id-12345`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(404);
    });

    it('should return 500 when collection has failed', async () => {
      const collectionId = 'test-status-failed';
      const failedComponent: PDFComponent = {
        status: PdfStatus.Failed,
        filepath: '',
        collectionId,
        componentId: 'comp-fail',
        error: 'Template rendering failed',
      };
      pdfCache.setExpectedLength(collectionId, 1);
      pdfCache.addToCollection(collectionId, failedComponent);
      await pdfCache.verifyCollection(collectionId);

      const res = await request(app)
        .get(`${API_PREFIX}/v2/status/${collectionId}`)
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(500);
      expect(res.body.error.statusText).toBe('PDF generation failed');
      expect(res.body.error.description).toContain('Template rendering failed');

      pdfCache.deleteCollection(collectionId);
    });
  });

  // ── GET /v2/download/:ID ──────────────────────────────────────────

  describe('GET /v2/download/:ID', () => {
    it('should return PDF content for a valid download', async () => {
      const pdfContent = Buffer.from('%PDF-1.4 mock content');
      mockDownloadPDF.mockResolvedValueOnce(Readable.from(pdfContent));

      const res = await request(app)
        .get(`${API_PREFIX}/v2/download/valid-pdf-id`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('valid-pdf-id.pdf');
      expect(mockDownloadPDF).toHaveBeenCalledWith('valid-pdf-id');
    });

    it('should allow repeated downloads of the same PDF', async () => {
      const pdfContent = Buffer.from('%PDF-1.4 repeated');

      for (let i = 0; i < 3; i++) {
        mockDownloadPDF.mockResolvedValueOnce(Readable.from(pdfContent));
      }

      for (let i = 0; i < 3; i++) {
        const res = await request(app)
          .get(`${API_PREFIX}/v2/download/repeat-pdf-id`)
          .expect(200);
        expect(res.headers['content-type']).toContain('application/pdf');
      }

      expect(mockDownloadPDF).toHaveBeenCalledTimes(3);
    });

    it('should handle 5 concurrent downloads', async () => {
      const pdfContent = Buffer.from('%PDF-1.4 concurrent');
      mockDownloadPDF.mockImplementation(() =>
        Promise.resolve(Readable.from(pdfContent)),
      );

      const requests = Array.from({ length: 5 }, () =>
        request(app).get(`${API_PREFIX}/v2/download/concurrent-pdf-id`),
      );

      const responses = await Promise.all(requests);
      responses.forEach((r) => {
        expect(r.status).toBe(200);
        expect(r.headers['content-type']).toContain('application/pdf');
      });

      expect(mockDownloadPDF).toHaveBeenCalledTimes(5);
    });

    it('should return 404 for a nonexistent download ID', async () => {
      mockDownloadPDF.mockResolvedValueOnce(undefined);

      const res = await request(app)
        .get(`${API_PREFIX}/v2/download/nonexistent-pdf-id`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(404);
      expect(res.body.error.description).toContain('nonexistent-pdf-id');
    });

    it('should return 400 when store throws an error', async () => {
      mockDownloadPDF.mockRejectedValueOnce(new Error('S3 connection failed'));

      const res = await request(app)
        .get(`${API_PREFIX}/v2/download/error-pdf-id`)
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(400);
      expect(res.body.error.description).toContain('S3 connection failed');
    });
  });

  // ── Authentication ────────────────────────────────────────────────

  describe('Authentication', () => {
    it('should allow access to non-protected endpoints without auth', async () => {
      // /v1/hello does not require identity
      const helloRes = await request(app)
        .get(`${API_PREFIX}/v1/hello`)
        .expect(200);
      expect(helloRes.text).toContain('Well this works!');

      // /healthz does not require identity
      const healthRes = await request(app).get('/healthz').expect(200);
      expect(healthRes.text).toContain('Build assets available');

      // /v2/status does not require identity
      const statusRes = await request(app).get(
        `${API_PREFIX}/v2/status/some-id`,
      );
      // 404 (not found) is expected — but not 401/403
      expect([200, 404]).toContain(statusRes.status);

      // /v2/download does not require identity
      mockDownloadPDF.mockResolvedValueOnce(undefined);
      const dlRes = await request(app).get(`${API_PREFIX}/v2/download/some-id`);
      expect([200, 404]).toContain(dlRes.status);
    });
  });

  // ── Full lifecycle ────────────────────────────────────────────────

  describe('Full lifecycle', () => {
    it('should complete create → status → download sequence', async () => {
      // 1. Create
      const createRes = await request(app)
        .post(`${API_PREFIX}/v2/create`)
        .set('x-rh-identity', TEST_IDENTITY)
        .send(validPayload)
        .expect(202);

      const collectionId = createRes.body.statusID;
      expect(collectionId).toBeDefined();

      // 2. Poll status — should be Generating
      const statusRes1 = await request(app)
        .get(`${API_PREFIX}/v2/status/${collectionId}`)
        .expect(200);
      expect(statusRes1.body.status.status).toBe(PdfStatus.Generating);

      // 3. Simulate PDF generation completing
      const generatedComponent: PDFComponent = {
        status: PdfStatus.Generated,
        filepath: `/tmp/${collectionId}`,
        collectionId,
        componentId: `${collectionId}-comp-1`,
        numPages: 2,
      };
      // Replace the Generating component with a Generated one
      pdfCache.addToCollection(collectionId, generatedComponent);
      // Mock store.downloadPDF for the merge step inside verifyCollection
      mockDownloadPDF.mockResolvedValue(
        Readable.from(Buffer.from('%PDF-1.4 mock')),
      );

      // 4. Poll status again — should transition to Generated after verify
      const statusRes2 = await request(app)
        .get(`${API_PREFIX}/v2/status/${collectionId}`)
        .expect(200);
      // After verifyCollection, with all components Generated, status should be Generated
      expect([PdfStatus.Generating, PdfStatus.Generated]).toContain(
        statusRes2.body.status.status,
      );

      // 5. Download
      mockDownloadPDF.mockResolvedValueOnce(
        Readable.from(Buffer.from('%PDF-1.4 final')),
      );
      const downloadRes = await request(app)
        .get(`${API_PREFIX}/v2/download/${collectionId}`)
        .expect(200);
      expect(downloadRes.headers['content-type']).toContain('application/pdf');

      pdfCache.deleteCollection(collectionId);
    });
  });

  // ── Deprecated v1 endpoint ────────────────────────────────────────

  describe('POST /v1/generate (deprecated)', () => {
    it('should return 400 with deprecation message', async () => {
      const res = await request(app)
        .post(`${API_PREFIX}/v1/generate`)
        .send(validPayload)
        .expect(400);

      expect(res.text).toContain('deprecated');
    });
  });
});
