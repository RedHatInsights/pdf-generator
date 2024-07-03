import { apiLogger } from './logging';

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
  expectedLength?: number;
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
    const components = this.data[collectionId].components;
    if (
      !this.data[collectionId].expectedLength ||
      this.data[collectionId].expectedLength !== components.length
    ) {
      return;
    }
    if (
      components.every((component) => component.status === PdfStatus.Generated)
    ) {
      this.updateCollectionState(collectionId, PdfStatus.Generated);
    }
  }

  public isComplete(id: string): boolean {
    if (this.data[id].status === PdfStatus.Generated) {
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
}

export default PdfCache;
