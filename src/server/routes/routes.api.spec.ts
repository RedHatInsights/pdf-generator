/**
 * API integration tests for crc-pdf-generator v2 endpoints.
 *
 * Migrated from IQE test_pdf_generator.py — 12 API tests covering:
 *   - POST /v2/create (generation + concurrency + errors)
 *   - GET  /v2/status/:id (status polling + 404 + bad input)
 *   - GET  /v2/download/:id (download + repeated + concurrent + 404 + bad input)
 *   - Authentication (requests without identity header)
 *   - Full lifecycle (create → status → download)
 *
 * Heavy dependencies (Puppeteer, S3, Kafka) are mocked. PdfCache runs
 * in-memory as in production.
 *
 * RHCLOUD-47548
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { Readable } from 'stream';

// ── Mocks (must be declared before any imports that pull in the modules) ──

const mockGeneratePdf = jest.fn();
jest.mock('../../browser/clusterTask', () => ({
  generatePdf: (...args: unknown[]) => mockGeneratePdf(...args) as void,
}));

jest.mock('../../browser/previewPDF', () => jest.fn());
jest.mock('../render-template', () =>
  jest.fn(() => '<html><body>mock</body></html>'),
);
jest.mock('../cluster', () => ({
  cluster: { idle: jest.fn().mockResolvedValue(undefined) },
}));

const mockDownloadPDF = jest.fn<Promise<Readable | undefined>, [string]>();
const mockUploadPDF = jest.fn().mockResolvedValue(undefined);
jest.mock('../../common/store', () => ({
  store: {
    downloadPDF: (...args: unknown[]) => mockDownloadPDF(...(args as [string])),
    uploadPDF: (...args: unknown[]) => mockUploadPDF(...args) as Promise<void>,
    intialize: jest.fn(),
  },
  StoreType: { S3: 's3' },
}));

jest.mock('../../common/kafka', () => ({
  consumeMessages: jest.fn().mockResolvedValue(undefined),
  produceMessage: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./createInternalProxies', () => ({
  __esModule: true,
  default: jest.fn(() => []),
}));

// ── Imports ──

import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import httpContext from 'express-http-context';
import PdfCache, { PdfStatus, PDFComponent } from '../../common/pdfCache';
import config from '../../common/config';

// Import the router AFTER mocks are set up
import router from './routes';

// Use fake timers to prevent PdfCache setTimeout from keeping the process alive
beforeAll(() => {
  jest.useFakeTimers({ legacyFakeTimers: true });
});

afterAll(() => {
  jest.useRealTimers();
});

// ── Test app factory ──

function createApp({ withIdentity = true } = {}) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use(httpContext.middleware);
  if (withIdentity) {
    // Simulate identity middleware — set a mock identity for authenticated requests
    app.use((req, _res, next) => {
      const rhIdentity = req.header(config.IDENTITY_HEADER_KEY);
      if (rhIdentity) {
        httpContext.set(config.IDENTITY_HEADER_KEY, rhIdentity);
      }
      next();
    });
  }
  app.use('/', router);
  return app;
}

// ── Helpers ──

const API_PREFIX = config?.APIPrefix || '/api/crc-pdf-generator';

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    payload: [
      {
        manifestLocation: '/apps/landing/fed-mods.json',
        scope: 'landing',
        module: './PdfEntry',
        ...overrides,
      },
    ],
  };
}

function fakeIdentityHeader(): string {
  const identity = {
    identity: {
      user: { user_id: '12345', username: 'test-user' },
      account_number: '99999',
      org_id: '11111',
    },
  };
  return Buffer.from(JSON.stringify(identity)).toString('base64');
}

function createPdfStream(content = '%PDF-1.4 mock pdf'): Readable {
  return Readable.from([Buffer.from(content)]);
}

/**
 * Simulate a successful PDF generation cycle:
 * 1. Mark collection as expected length
 * 2. Add generated component(s)
 * 3. Verify collection
 */
async function simulateGeneration(
  collectionId: string,
  numComponents = 1,
): Promise<void> {
  const cache = PdfCache.getInstance();
  cache.setExpectedLength(collectionId, numComponents);
  for (let i = 0; i < numComponents; i++) {
    const component: PDFComponent = {
      status: PdfStatus.Generated,
      filepath: `/tmp/report_${i}.pdf`,
      collectionId,
      componentId: `comp-${i}`,
      numPages: 2,
      order: i + 1,
    };
    cache.addToCollection(collectionId, component);
  }
  // Mock store.downloadPDF for merge
  mockDownloadPDF.mockResolvedValue(createPdfStream());
  await cache.verifyCollection(collectionId);
}

async function simulateFailure(
  collectionId: string,
  error: string,
): Promise<void> {
  const cache = PdfCache.getInstance();
  cache.setExpectedLength(collectionId, 1);
  const component: PDFComponent = {
    status: PdfStatus.Failed,
    filepath: '',
    collectionId,
    componentId: 'comp-fail',
    error,
  };
  cache.addToCollection(collectionId, component);
  await cache.verifyCollection(collectionId);
}

// ── Tests ──

describe('PDF Generator API', () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    jest.clearAllMocks();
    // Reset PdfCache singleton data between tests by deleting known keys
    // (the singleton persists, but we clean up after each test)
  });

  // ───────────────────────────────────────────────
  // 1. PDF Generation & Concurrency
  // ───────────────────────────────────────────────

  describe('POST /v2/create', () => {
    it('should accept a valid create request and return 202 with statusID', async () => {
      mockGeneratePdf.mockImplementation(() => Promise.resolve());

      const res = await request(app)
        .post(`${API_PREFIX}/v2/create`)
        .set(config.IDENTITY_HEADER_KEY, fakeIdentityHeader())
        .send(validPayload())
        .expect(202);

      expect(res.body).toHaveProperty('statusID');
      expect(typeof res.body.statusID).toBe('string');
      expect(res.body.statusID.length).toBeGreaterThan(0);
      expect(mockGeneratePdf).toHaveBeenCalledTimes(1);
    });

    it('should handle concurrent create requests', async () => {
      mockGeneratePdf.mockImplementation(() => Promise.resolve());

      const concurrency = 10;
      const requests = Array.from({ length: concurrency }, () =>
        request(app)
          .post(`${API_PREFIX}/v2/create`)
          .set(config.IDENTITY_HEADER_KEY, fakeIdentityHeader())
          .send(validPayload()),
      );

      const responses = await Promise.all(requests);

      const statusIDs = new Set<string>();
      for (const res of responses) {
        expect(res.status).toBe(202);
        expect(res.body).toHaveProperty('statusID');
        statusIDs.add(res.body.statusID);
      }

      // Each request should get a unique statusID
      expect(statusIDs.size).toBe(concurrency);
      expect(mockGeneratePdf).toHaveBeenCalledTimes(concurrency);
    });

    it('should return 500 when PDF generation throws', async () => {
      mockGeneratePdf.mockImplementation(() => {
        throw new Error('Puppeteer cluster crashed');
      });

      const res = await request(app)
        .post(`${API_PREFIX}/v2/create`)
        .set(config.IDENTITY_HEADER_KEY, fakeIdentityHeader())
        .send(validPayload())
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(500);
      expect(res.body.error.statusText).toBe('Internal server error');
    });
  });

  // ───────────────────────────────────────────────
  // 2. Status Endpoint
  // ───────────────────────────────────────────────

  describe('GET /v2/status/:statusID', () => {
    it('should return status for a known collection', async () => {
      const collectionId = 'test-status-known';
      await simulateGeneration(collectionId);

      const res = await request(app)
        .get(`${API_PREFIX}/v2/status/${collectionId}`)
        .expect(200);

      expect(res.body).toHaveProperty('status');
      expect(res.body.status).toHaveProperty('status', PdfStatus.Generated);
      expect(res.body.status).toHaveProperty('components');
      expect(Array.isArray(res.body.status.components)).toBe(true);
    });

    it('should return 404 for a nonexistent status ID', async () => {
      const res = await request(app)
        .get(`${API_PREFIX}/v2/status/nonexistent-uuid-12345`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(404);
    });

    it('should return 500 with error details when generation has failed', async () => {
      const collectionId = 'test-status-failed';
      await simulateFailure(collectionId, 'Template rendering timeout');

      const res = await request(app)
        .get(`${API_PREFIX}/v2/status/${collectionId}`)
        .expect(500);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(500);
      expect(res.body.error.statusText).toBe('PDF generation failed');
      expect(res.body.error.description).toContain(
        'Template rendering timeout',
      );
    });
  });

  // ───────────────────────────────────────────────
  // 3. Download Endpoint
  // ───────────────────────────────────────────────

  describe('GET /v2/download/:ID', () => {
    it('should return a PDF for a valid download ID', async () => {
      const downloadId = 'download-valid-id';
      mockDownloadPDF.mockResolvedValue(createPdfStream());

      const res = await request(app)
        .get(`${API_PREFIX}/v2/download/${downloadId}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(downloadId);
    });

    it('should support repeated downloads of the same ID', async () => {
      const downloadId = 'download-repeated';
      mockDownloadPDF.mockResolvedValue(createPdfStream());

      const first = await request(app)
        .get(`${API_PREFIX}/v2/download/${downloadId}`)
        .expect(200);

      mockDownloadPDF.mockResolvedValue(createPdfStream());

      const second = await request(app)
        .get(`${API_PREFIX}/v2/download/${downloadId}`)
        .expect(200);

      expect(first.headers['content-type']).toContain('application/pdf');
      expect(second.headers['content-type']).toContain('application/pdf');
      expect(mockDownloadPDF).toHaveBeenCalledTimes(2);
    });

    it('should handle concurrent download requests', async () => {
      const downloadId = 'download-concurrent';
      mockDownloadPDF.mockImplementation(() =>
        Promise.resolve(createPdfStream()),
      );

      const concurrency = 5;
      const requests = Array.from({ length: concurrency }, () =>
        request(app).get(`${API_PREFIX}/v2/download/${downloadId}`),
      );

      const responses = await Promise.all(requests);

      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
      }

      expect(mockDownloadPDF).toHaveBeenCalledTimes(concurrency);
    });

    it('should return 404 for a nonexistent download ID', async () => {
      mockDownloadPDF.mockResolvedValue(undefined);

      const res = await request(app)
        .get(`${API_PREFIX}/v2/download/nonexistent-download-id`)
        .expect(404);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(404);
    });

    it('should return 400 when download throws an error', async () => {
      mockDownloadPDF.mockRejectedValue(new Error('S3 connection failed'));

      const res = await request(app)
        .get(`${API_PREFIX}/v2/download/bad-input-id`)
        .expect(400);

      expect(res.body).toHaveProperty('error');
      expect(res.body.error.status).toBe(400);
      expect(res.body.error.description).toContain('S3 connection failed');
    });
  });

  // ───────────────────────────────────────────────
  // 4. Authentication & Integration
  // ───────────────────────────────────────────────

  describe('Authentication', () => {
    it('should accept requests without auth on non-protected endpoints', async () => {
      // v1/hello and healthz are not protected by identity middleware
      const helloRes = await request(app)
        .get(`${API_PREFIX}/v1/hello`)
        .expect(200);

      expect(helloRes.text).toContain('Well this works');

      const healthRes = await request(app).get('/healthz').expect(200);

      expect(healthRes.text).toContain('Build assets available');
    });
  });

  describe('Full lifecycle', () => {
    it('should complete a create → status → download sequence', async () => {
      // Step 1: Create
      let capturedCollectionId: string | undefined;
      mockGeneratePdf.mockImplementation(
        (_details: any, collectionId: string) => {
          capturedCollectionId = collectionId;
          // Simulate async generation completing
          const cache = PdfCache.getInstance();
          const component: PDFComponent = {
            status: PdfStatus.Generated,
            filepath: '/tmp/lifecycle.pdf',
            collectionId,
            componentId: `lifecycle-comp`,
            numPages: 1,
            order: 1,
          };
          cache.addToCollection(collectionId, component);
        },
      );

      const createRes = await request(app)
        .post(`${API_PREFIX}/v2/create`)
        .set(config.IDENTITY_HEADER_KEY, fakeIdentityHeader())
        .send(validPayload())
        .expect(202);

      const statusID = createRes.body.statusID;
      expect(statusID).toBeDefined();
      expect(capturedCollectionId).toBe(statusID);

      // Step 2: Poll status — should show Generated after verifyCollection
      mockDownloadPDF.mockResolvedValue(createPdfStream());
      const statusRes = await request(app)
        .get(`${API_PREFIX}/v2/status/${statusID}`)
        .expect(200);

      expect(statusRes.body.status.status).toBe(PdfStatus.Generated);

      // Step 3: Download
      mockDownloadPDF.mockResolvedValue(createPdfStream('%PDF-lifecycle'));
      const downloadRes = await request(app)
        .get(`${API_PREFIX}/v2/download/${statusID}`)
        .expect(200);

      expect(downloadRes.headers['content-type']).toContain('application/pdf');
    });
  });
});
