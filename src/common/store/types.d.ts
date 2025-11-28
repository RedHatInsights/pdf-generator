import { Readable } from 'stream';

/**
 * Defines the contract for a PDF storage service.
 * Any class implementing this interface must provide
 * methods for uploading and downloading PDF files.
 */
export interface PDFStorageService {
  /**
   * Uploads a PDF file to the configured storage.
   *
   * @param id The unique identifier for the PDF file.
   * @param path The local file path to the PDF to be uploaded.
   * @returns A Promise that resolves when the upload is complete.
   */
  uploadPDF(id: string, path: string): Promise<void>;

  /**
   * Fetches a PDF file from storage.
   *
   * @param id The unique identifier for the PDF file.
   * @returns A Promise that resolves with a Response stream of the PDF file.
   */
  downloadPDF(id: string): Promise<Readable | undefined>;
}
