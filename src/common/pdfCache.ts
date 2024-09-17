import { apiLogger } from './logging';
import { ensureDirSync } from 'fs-extra';
import PDFMerger from 'pdf-merger-js';
import { downloadPDF, uploadPDF } from '../common/objectStore';
import os from 'os';
import fs from 'fs';

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
      : seconds
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
      ({ componentId }) => componentId !== status.componentId
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

  public getTotalPagesForCollection(collectionId: string) {
    let pageCount = 0;
    const components = this.getComponents(collectionId);
    if (components?.length > 1) {
      components.forEach((n) => {
        pageCount += n.numPages || 0;
      });
    }
    return pageCount;
  }

  private updateCollectionState(
    collectionId: string,
    status: PdfStatus,
    error?: string
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
      }
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

  public verifyCollection(collectionId: string): void {
    if (!this.data[collectionId]) {
      return;
    }
    // There is no need to rerun the validation is the collection
    // has registered itself as generated already. Doing so will
    // trigger an extra merge when the status endpoint is hit.
    if (this.data[collectionId].status === PdfStatus.Generated) {
      apiLogger.debug(
        `Collection ${collectionId} already registered as generated`
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
      this.updateCollectionState(collectionId, PdfStatus.Generated);
      // Everything is generated and looks good, kick off an async job
      // to store them in a single PDF. Do this in the background
      // instead of at download time
      this.mergePDFsFromCompleteCollection(collectionId);
    }
  }

  private allComponentsGenerated(
    collectionId: string,
    components: PDFComponent[]
  ) {
    if (
      components.every(
        (component) => component.status === PdfStatus.Generated
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
        ENTRY_TIMEOUT
      )}`
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
  private mergePDFsFromCompleteCollection = async (collectionId: string) => {
    const collection = this.data[collectionId];
    if (!collection) {
      apiLogger.debug(`No collection found for ${collectionId}`);
      return;
    }
    if (collection.status !== PdfStatus.Generated) {
      apiLogger.debug(
        `Cannot merge an unfinished PDF collection ${collectionId}`
      );
      return;
    }
    apiLogger.debug(`Merging slices for collection ${collectionId}`);
    const tmpdir = `/tmp/${collectionId}-components/*`;
    ensureDirSync(tmpdir);
    try {
      const merger = new PDFMerger();
      // Since we can merge the PDFs without saving them to disk, we
      // can sequentially grab all the s3 stored PDFs as a UINT8 array
      // and merge them in memory much faster than writing to disk
      for (const component of collection.components) {
        const response = await downloadPDF(component.componentId);
        const stream = await response?.Body?.transformToByteArray();
        // TODO: It might be better to throw an error if stream is null,
        // but the error passes down more accurately this way
        await merger.add(stream!);
      }
      const buffer = await merger.saveAsBuffer();
      const path = `${os.tmpdir()}/${collectionId}`;
      fs.writeFileSync(path, buffer);
      apiLogger.debug(`${path} written to disk`);
      await uploadPDF(collectionId, path);
      apiLogger.debug(`${collectionId} written to s3`);
    } catch (error) {
      apiLogger.debug(`Error merging files: ${error}`);
    }
  };
}

export default PdfCache;
