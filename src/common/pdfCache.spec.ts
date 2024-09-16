import PdfCache, { PDFComponent, PdfStatus } from './pdfCache';

describe('Pdf Cache updates', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });
  const pdfCache = PdfCache.getInstance();
  const cache: PDFComponent = {
    status: PdfStatus.Failed,
    filepath: '',
    collectionId: '7855a523-fc64-4e51-910a-b1ff3918b440',
    componentId: 'fb99bc16-4cdc-4200-afbf-479d904ee987',
    numPages: 0,
    error: 'oops',
  };
  const baseId = '7855a523-fc64-4e51-910a-b1ff3918b440';
  pdfCache.addToCollection(baseId, cache);

  it('should return a valid collection', () => {
    pdfCache.verifyCollection(baseId);
    const coll = pdfCache.getCollection(baseId);
    expect(coll.components.length).toBe(1);
    expect(coll.components[0].componentId).toBe(
      'fb99bc16-4cdc-4200-afbf-479d904ee987'
    );
  });

  it('should validate a generated collection with all expected components', () => {
    const mockMergePDFsFromCompleteCollection = jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn<PdfCache, any>(pdfCache, 'mergePDFsFromCompleteCollection')
      .mockImplementation(jest.fn());
    const comp: PDFComponent = {
      status: PdfStatus.Generated,
      filepath: 'blah',
      collectionId: '9855a523-fc64-4e51-910a-b1ff3918b440',
      componentId: 'fb99bc16-4cdc-4200-afbf-479d904ee987',
      numPages: 5,
    };
    const another: PDFComponent = {
      status: PdfStatus.Generated,
      filepath: 'blah',
      collectionId: '9855a523-fc64-4e51-910a-b1ff3918b440',
      componentId: 'aaaaaaa-4cdc-4200-afbf-479d904ee987',
      numPages: 5,
    };
    const compId = comp.collectionId;
    pdfCache.addToCollection(compId, comp);
    pdfCache.setExpectedLength(compId, 2);
    pdfCache.verifyCollection(compId);
    const collection = pdfCache.getCollection(compId);
    expect(collection.expectedLength).toBe(2);
    expect(collection.components.length).toBe(1);
    expect(collection.status).toBe(PdfStatus.Generating);
    pdfCache.addToCollection(compId, another);
    pdfCache.verifyCollection(compId);
    expect(collection.expectedLength).toBe(2);
    expect(collection.components.length).toBe(2);
    // Since the "Generated" status is dependant on uploading a PDF
    // we will cover it in integration testing and assert that
    // the merge method is called
    expect(mockMergePDFsFromCompleteCollection).toHaveBeenCalled();
    expect(mockMergePDFsFromCompleteCollection).toHaveBeenCalledWith(compId);
  });

  it('should invalidate a failed collection', () => {
    pdfCache.verifyCollection(baseId);
    const coll = pdfCache.getCollection(baseId);
    expect(coll.components.length).toBe(1);
    expect(coll.status).toBe('Failed');
    expect(coll.error).toBe('oops');
  });

  it('should reset a collection with no expectedLength', () => {
    const noExp: PDFComponent = {
      status: PdfStatus.Generating,
      filepath: 'blah',
      collectionId: '1055a523-fc64-4e51-910a-b1ff3918b440',
      componentId: 'fb99bc16-4cdc-4200-afbf-479d904ee987',
      numPages: 5,
    };
    const noeExpId = noExp.collectionId;
    pdfCache.addToCollection(noeExpId, noExp);
    pdfCache.verifyCollection(noeExpId);
    const noLen = pdfCache.getCollection(noeExpId);
    expect(noLen.expectedLength).toBe(0);
    expect(noLen.components.length).toBe(1);
    expect(noLen.status).toBe(PdfStatus.Generating);
  });

  it('should set the length properly when a collection has not been added directly', () => {
    const notAdded: PDFComponent = {
      status: PdfStatus.Generated,
      filepath: 'blah',
      collectionId: '2255a523-fc64-6e51-910a-b1ff3918b440',
      componentId: '11aaaaa-4cdc-4200-afbf-479d904ee987',
      numPages: 5,
    };
    const compId = notAdded.collectionId;
    pdfCache.setExpectedLength(compId, 2);
    const added = pdfCache.getCollection(compId);
    expect(added.components.length).toBe(0);
    expect(added.status).toBe('Generating');
    expect(added.expectedLength).toBe(2);
    pdfCache.verifyCollection(compId);
    expect(added.status).toBe('Generating');
  });
});
