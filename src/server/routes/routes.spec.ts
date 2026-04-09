import PdfCache, { PdfStatus, PDFComponent } from '../../common/pdfCache';

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
