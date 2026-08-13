export class PDFNotImplementedError extends Error {
  code: number;
  constructor() {
    super('PDF layout is not implemented for this report yet');
    this.code = 404;
    this.name = 'PDFNotImplementedError';
  }
}

export class PDFNotFoundError extends Error {
  code: number;
  constructor(pdfFileName: string) {
    super(`${pdfFileName} does not exist on the server.`);
    this.code = 500;
    this.name = 'PDFNotFoundError';
  }
}

export class SendingFailedError extends Error {
  code: number;
  constructor(pdfFileName: string, error: Error | string) {
    super(`Sending of ${pdfFileName} failed: ${error}`);
    this.code = 500;
    this.name = 'SendingFailedError';
  }
}

export class PDFRequestError extends Error {
  code: number;
  constructor(error: Error | string) {
    super(`Error fetching data: ${error}`);
    this.code = 500;
    this.name = 'PDFRequestError';
  }
}

export class PdfGenerationError extends Error {
  collectionId: string;
  componentId: string;

  constructor(collectionId: string, componentId: string, message: string) {
    super(message);
    this.collectionId = collectionId;
    this.componentId = componentId;
    this.name = 'PdfGenerationError';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor); // Capture the stack trace
    } else {
      this.stack = new Error(message).stack; // Fallback for non-V8 environments
    }
  }
}
