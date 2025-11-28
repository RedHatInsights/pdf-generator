import { apiLogger } from './logging';
import { ensureDirSync } from 'fs-extra';
import PDFMerger from 'pdf-merger-js';
import { store } from '../common/store';
import os from 'os';
import fs from 'fs';
import { arrayBuffer as ArrayBuffer } from 'node:stream/consumers';
import { PDFDocument, PDFPage, Color, ColorTypes } from 'pdf-lib';

export enum PdfStatus {
  Generating = 'Generating',
  Generated = 'Generated',
  Failed = 'Failed',
  NotFound = 'NotFound',
}

// 8 hour timeout on cache entries
const EIGHT_HOURS = 8 * 60 * 60 * 1000;
export const ENTRY_TIMEOUT = process.env.ENTRY_TIMEOUT
  ? parseInt(process.env.ENTRY_TIMEOUT, 10)
  : EIGHT_HOURS;

// Return the highest unit with english suffix
// 3000 => 3 seconds
const formatTimeToEnglish = (milliseconds: number): string => {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);

  // Determine the largest unit
  let largestUnit = '';
  if (hours > 0) {
    largestUnit = 'hours';
  } else if (minutes > 0) {
    largestUnit = 'minutes';
  } else if (seconds > 0) {
    largestUnit = 'seconds';
  }

  // Return the largest unit with its value
  return `${Math.abs(
    largestUnit === 'hours'
      ? hours
      : largestUnit === 'minutes'
        ? minutes
        : seconds,
  )} ${largestUnit}`;
};

export type PdfEntry = {
  status: string;
  filepath: string;
};

export type PdfCollection = {
  [id: string]: PDFComponentGroup;
};
export type PDFComponentGroup = {
  components: PDFComponent[];
  expectedLength: number;
  status: PdfStatus;
  error?: string;
};
export type PDFComponent = {
  status: PdfStatus;
  filepath: string;
  collectionId: string;
  componentId: string;
  error?: string;
  numPages?: number;
  order?: number;
};

const addPageNumbers = async (pdfBuffer: Uint8Array): Promise<Uint8Array> => {
  // Load the PDF
  const pdfDoc = await PDFDocument.load(pdfBuffer);

  // Get the number of pages
  const pageCount = pdfDoc.getPageCount();
  for (let i = 0; i < pageCount; i++) {
    const page: PDFPage = pdfDoc.getPage(i);
    const width = page.getWidth();
    // Calculate position for page number
    const xPosition = width / 2 - 10; // Position at the middle
    const yPosition = 10; // Position from bottom edge (bottom is 0)

    // Add text for page number
    const black: Color = { red: 0, blue: 0, green: 0, type: ColorTypes.RGB };
    const fontSize = 8;

    page.drawText(`Page ${i + 1}`, {
      x: xPosition,
      y: yPosition,
      size: fontSize,
      color: black,
    });
  }

  // Save the modified PDF and return as a Uint8Array
  return await pdfDoc.save();
};

class PdfCache {
  private static instance: PdfCache;
  private data: PdfCollection;

  private constructor() {
    this.data = {};
  }

  public static getInstance(): PdfCache {
    if (!PdfCache.instance) {
      PdfCache.instance = new PdfCache();
    }
    return PdfCache.instance;
  }

  public addToCollection(collectionId: string, status: PDFComponent): void {
    if (!collectionId) {
      apiLogger.debug('no collectionId found');
      return;
    }
    const currentEntry = this.data[collectionId];
    if (!currentEntry) {
      this.data[collectionId] = {
        components: [],
        status: PdfStatus.Generating,
        expectedLength: 0,
      };
      // Only add cache cleaner once. The entire collection will only last
      // ENTRY_TIMEOUT hours
      this.cleanExpiredCollection(collectionId);
    }
    // replace
    this.data[collectionId].components = this.data[
      collectionId
    ].components.filter(
      ({ componentId }) => componentId !== status.componentId,
    );
    this.data[collectionId].components.push(status);
  }

  public getCollection(id: string): PDFComponentGroup {
    return this.data[id];
  }

  public deleteCollection(id: string) {
    delete this.data[id];
  }

  public getComponents(collectionId: string) {
    if (this.data[collectionId]) {
      return this.data[collectionId].components;
    }
    return [];
  }

  // Sort the components by their internal `order` and
  // return the sorted components in ascending order
  private sortComponents(components: PDFComponent[]): PDFComponent[] {
    // No point in sorting a slice of length 1
    if (components.length < 2) {
      return components;
    }
    return components.slice().sort((a, b) => {
      const orderA = a.order || Number.MAX_VALUE;
      const orderB = b.order || Number.MAX_VALUE;

      return orderA - orderB;
    });
  }

  private updateCollectionState(
    collectionId: string,
    status: PdfStatus,
    error?: string,
  ): void {
    if (!this.data[collectionId]) {
      throw new Error('Collection not found');
    }

    this.data[collectionId].components = this.data[collectionId].components.map(
      (component) => {
        return {
          ...component,
          status,
        };
      },
    );
    this.data[collectionId].status = status;
    this.data[collectionId].error = error;
  }

  public setExpectedLength(collectionId: string, length: number): void {
    if (!collectionId) {
      apiLogger.debug('no collectionId found');
      return;
    }
    const currentEntry = this.data[collectionId];
    if (!currentEntry) {
      this.data[collectionId] = {
        components: [],
        status: PdfStatus.Generating,
        expectedLength: length,
      };
      // Only add cache cleaner once. The entire collection will only last
      // ENTRY_TIMEOUT hours
      this.cleanExpiredCollection(collectionId);
    }
    this.data[collectionId].expectedLength = length;
  }

  public invalidateCollection(collectionId: string, error: string): void {
    this.updateCollectionState(collectionId, PdfStatus.Failed, error);
  }

  public async verifyCollection(collectionId: string): Promise<void> {
    if (!this.data[collectionId]) {
      return;
    }
    // There is no need to rerun the validation is the collection
    // has registered itself as generated already. Doing so will
    // trigger an extra merge when the status endpoint is hit.
    if (this.data[collectionId].status === PdfStatus.Generated) {
      apiLogger.debug(
        `Collection ${collectionId} already registered as generated`,
      );
      return;
    }

    const components = this.data[collectionId].components;
    for (const component of components) {
      if (component.status === PdfStatus.Failed) {
        this.invalidateCollection(collectionId, component.error || '');
        return;
      }
    }

    if (!this.data[collectionId].expectedLength) {
      this.data[collectionId].expectedLength = 0;
      return;
    }

    if (this.allComponentsGenerated(collectionId, components)) {
      // Everything is generated and looks good, kick off an async job
      // to store them in a single PDF
      await this.mergePDFsFromCompleteCollection(collectionId);
      this.updateCollectionState(collectionId, PdfStatus.Generated);
    }
  }

  private allComponentsGenerated(
    collectionId: string,
    components: PDFComponent[],
  ) {
    if (
      components.every(
        (component) => component.status === PdfStatus.Generated,
      ) &&
      this.data[collectionId].expectedLength === components.length
    ) {
      return true;
    }
    return false;
  }

  public cleanExpiredCollection(uuid: string) {
    apiLogger.debug(
      `Timeout for ${uuid} has been set to ${formatTimeToEnglish(
        ENTRY_TIMEOUT,
      )}`,
    );
    setTimeout(() => {
      // This should potentially also call the objectStore to remove the PDF(s)
      apiLogger.debug(`Removing expired collection ${uuid}`);
      this.deleteCollection(uuid);
    }, ENTRY_TIMEOUT);
  }

  // After all slices of a PDF have been marked as "Generated", we can
  // merge them all before download time since this can take a while.
  // Merging and downloading at the same time can cause timeouts with
  // larger payloads
  public mergePDFsFromCompleteCollection = async (collectionId: string) => {
    const collection = this.data[collectionId];
    if (!collection) {
      apiLogger.debug(`No collection found for ${collectionId}`);
      return;
    }
    // Sort the pages for the correct finalized PDF order
    const sortedSlices = this.sortComponents(collection.components);
    apiLogger.debug(`Merging slices for collection ${collectionId}`);
    const tmpdir = `/tmp/${collectionId}-components/*`;
    ensureDirSync(tmpdir);
    try {
      const merger = new PDFMerger();
      // Since we can merge the PDFs without saving them to disk, we
      // can sequentially grab all the s3 stored PDFs as a UINT8 array
      // and merge them in memory much faster than writing to disk
      for (const component of sortedSlices) {
        const pdfReadable = await store.downloadPDF(component.componentId);
        if (!pdfReadable) {
          throw new Error(
            `Failed to download PDF for ${component.componentId}`,
          );
        }
        const pdfBuffer = await ArrayBuffer(pdfReadable);
        await merger.add(pdfBuffer);
      }
      const buffer = await merger.saveAsBuffer();
      const completed = await addPageNumbers(new Uint8Array(buffer));
      const path = `${os.tmpdir()}/${collectionId}`;
      fs.writeFileSync(path, completed);
      apiLogger.debug(`${path} written to disk`);
      await store.uploadPDF(collectionId, path);
      apiLogger.debug(`${collectionId} written to s3`);
    } catch (error) {
      apiLogger.debug(`Error merging files: ${error}`);
    }
  };
}

export default PdfCache;
