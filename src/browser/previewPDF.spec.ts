const mockPage = {
  setViewport: jest.fn(),
  on: jest.fn(),
  goto: jest.fn().mockResolvedValue({ ok: () => true, statusText: () => 'OK' }),
  waitForNetworkIdle: jest.fn(),
  setExtraHTTPHeaders: jest.fn(),
  setCookie: jest.fn(),
  pdf: jest.fn().mockResolvedValue(new Uint8Array(Buffer.from('%PDF-mock'))),
  close: jest.fn(),
};

const mockExecute = jest.fn(
  (taskFn: ({ page }: { page: unknown }) => Promise<unknown>) =>
    taskFn({ page: mockPage }),
);

jest.mock('../server/cluster', () => ({
  cluster: {
    execute: mockExecute,
  },
}));

jest.mock('../common/config', () => ({
  __esModule: true,
  default: {
    IS_PRODUCTION: false,
    webPort: 8000,
  },
}));

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('./helpers', () => ({
  pageWidth: 1024,
  pageHeight: 768,
  setWindowProperty: jest.fn(),
}));

jest.mock('../server/render-template', () => ({
  getHeaderAndFooterTemplates: () => ({
    headerTemplate: '<div>header</div>',
    footerTemplate: '<div>footer</div>',
  }),
}));

jest.mock('../common/constants', () => ({
  BROWSER_TIMEOUT: 120_000,
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { default: previewPdf } = require('./previewPDF');

const { setWindowProperty } = jest.requireMock('./helpers');

describe('previewPdf', () => {
  const TEST_URL = 'http://localhost:8000/puppeteer?scope=test';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPage.goto.mockResolvedValue({
      ok: () => true,
      statusText: () => 'OK',
    });
    mockPage.pdf.mockResolvedValue(new Uint8Array(Buffer.from('%PDF-mock')));
  });

  describe('cluster integration', () => {
    it('uses shared cluster.execute instead of launching a standalone browser', async () => {
      await previewPdf(TEST_URL);

      expect(mockExecute).toHaveBeenCalledTimes(1);
      expect(mockExecute).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('page setup ordering', () => {
    it('calls setWindowProperty BEFORE page.goto', async () => {
      const callOrder: string[] = [];
      setWindowProperty.mockImplementation(() => {
        callOrder.push('setWindowProperty');
        return Promise.resolve();
      });
      mockPage.goto.mockImplementation(() => {
        callOrder.push('goto');
        return Promise.resolve({
          ok: () => true,
          statusText: () => 'OK',
        });
      });

      await previewPdf(TEST_URL);

      const swpIndex = callOrder.indexOf('setWindowProperty');
      const gotoIndex = callOrder.indexOf('goto');
      expect(swpIndex).toBeGreaterThanOrEqual(0);
      expect(gotoIndex).toBeGreaterThanOrEqual(0);
      expect(swpIndex).toBeLessThan(gotoIndex);
    });
  });

  describe('status check ordering', () => {
    it('checks page status BEFORE network idle and PDF', async () => {
      const callOrder: string[] = [];
      mockPage.goto.mockImplementation(() => {
        callOrder.push('goto');
        return Promise.resolve({
          ok: () => false,
          statusText: () => 'Internal Server Error',
        });
      });
      mockPage.waitForNetworkIdle.mockImplementation(() => {
        callOrder.push('waitForNetworkIdle');
        return Promise.resolve();
      });
      mockPage.pdf.mockImplementation(() => {
        callOrder.push('pdf');
        return Promise.resolve(new Uint8Array());
      });

      await expect(previewPdf(TEST_URL)).rejects.toThrow(
        /Puppeteer error while loading the react app/,
      );

      expect(callOrder).toContain('goto');
      expect(callOrder).not.toContain('waitForNetworkIdle');
      expect(callOrder).not.toContain('pdf');
    });
  });

  describe('network idle', () => {
    it('waits for network idle after successful navigation', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.waitForNetworkIdle).toHaveBeenCalledWith({
        idleTime: 1000,
        timeout: 120_000,
      });
    });
  });

  describe('successful preview', () => {
    it('returns PDF buffer directly', async () => {
      const pdfBytes = new Uint8Array(Buffer.from('%PDF-mock'));
      mockPage.pdf.mockResolvedValue(pdfBytes);

      const result = await previewPdf(TEST_URL);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from(pdfBytes));
    });

    it('sets viewport dimensions', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.setViewport).toHaveBeenCalledWith({
        width: 1024,
        height: 768,
      });
    });

    it('generates A4 PDF with headers and footers', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          format: 'a4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<div>header</div>',
          footerTemplate: '<div>footer</div>',
          margin: { top: '54px', bottom: '54px' },
          timeout: 120_000,
        }),
      );
    });

    it('navigates with networkidle2 and timeout', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.goto).toHaveBeenCalledWith(TEST_URL, {
        waitUntil: 'networkidle2',
        timeout: 120_000,
      });
    });
  });

  describe('request setup', () => {
    // NOTE: the auth cookie/header setup below is reworked by
    // RHCLOUD-49239 (credential exposure / auth bypass); these assertions
    // are intentionally kept structural and will need updating alongside it.
    it('sets the cs_jwt cookie before navigation', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.setCookie).toHaveBeenCalledWith({
        name: 'cs_jwt',
        value: 'bar',
        domain: 'localhost',
      });
    });

    it('applies extra HTTP headers before navigation', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledTimes(1);
      expect(mockPage.setExtraHTTPHeaders).toHaveBeenCalledWith(
        expect.any(Object),
      );
    });
  });

  describe('page lifecycle', () => {
    it('closes page after successful generation', async () => {
      await previewPdf(TEST_URL);

      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it('closes page after failed navigation', async () => {
      mockPage.goto.mockResolvedValue({
        ok: () => false,
        statusText: () => 'Not Found',
      });

      await expect(previewPdf(TEST_URL)).rejects.toThrow();

      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it('closes page after pdf generation fails', async () => {
      mockPage.pdf.mockRejectedValue(new Error('render timeout'));

      await expect(previewPdf(TEST_URL)).rejects.toThrow('render timeout');

      expect(mockPage.close).toHaveBeenCalledTimes(1);
    });

    it('still returns the buffer when page.close throws', async () => {
      mockPage.close.mockRejectedValue(new Error('page already closed'));

      const result = await previewPdf(TEST_URL);

      expect(Buffer.isBuffer(result)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('throws on non-ok page response', async () => {
      mockPage.goto.mockResolvedValue({
        ok: () => false,
        statusText: () => 'Not Found',
      });

      await expect(previewPdf(TEST_URL)).rejects.toThrow(
        'Puppeteer error while loading the react app: Not Found',
      );
    });

    it('throws on null page response', async () => {
      mockPage.goto.mockResolvedValue(null);

      await expect(previewPdf(TEST_URL)).rejects.toThrow(
        /Puppeteer error while loading the react app/,
      );
    });

    it('propagates errors thrown by page.pdf', async () => {
      mockPage.pdf.mockRejectedValue(new Error('render timeout'));

      await expect(previewPdf(TEST_URL)).rejects.toThrow('render timeout');
    });
  });
});
