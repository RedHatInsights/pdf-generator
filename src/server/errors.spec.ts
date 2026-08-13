import {
  PDFNotImplementedError,
  PDFNotFoundError,
  SendingFailedError,
  PDFRequestError,
  PdfGenerationError,
} from './errors';

describe('Error classes', () => {
  it.each([
    {
      name: 'PDFNotImplementedError',
      error: new PDFNotImplementedError(),
      code: 404,
      messagePattern: /not implemented/i,
    },
    {
      name: 'PDFNotFoundError',
      error: new PDFNotFoundError('report.pdf'),
      code: 500,
      messagePattern: /report\.pdf.*does not exist/,
    },
    {
      name: 'SendingFailedError',
      error: new SendingFailedError('report.pdf', 'timeout'),
      code: 500,
      messagePattern: /report\.pdf.*failed.*timeout/,
    },
    {
      name: 'PDFRequestError',
      error: new PDFRequestError('connection refused'),
      code: 500,
      messagePattern: /connection refused/,
    },
  ])('$name extends Error', ({ name, error, code, messagePattern }) => {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.code).toBe(code);
    expect(error.message).toMatch(messagePattern);
    expect(error.stack).toBeDefined();
  });

  it('PdfGenerationError includes collectionId and componentId', () => {
    const error = new PdfGenerationError('col-1', 'comp-1', 'render failed');
    expect(error).toBeInstanceOf(Error);
    expect(error.collectionId).toBe('col-1');
    expect(error.componentId).toBe('comp-1');
    expect(error.message).toBe('render failed');
  });

  it('error.message is accessible for logging (not swallowed by JSON.stringify)', () => {
    const error = new PDFNotFoundError('test.pdf');
    expect(error.message).toContain('test.pdf');
    expect(error instanceof Error ? error.message : String(error)).toContain(
      'test.pdf',
    );
  });
});
