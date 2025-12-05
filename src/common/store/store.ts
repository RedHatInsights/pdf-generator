import { PDFStorageService } from './types';
import { ObjectStore } from './objectStore.impl';

export enum StoreType {
  S3 = 's3',
}

class StoreProxy implements PDFStorageService {
  private store: PDFStorageService | undefined;

  constructor() {
    this.store = undefined;
  }

  public intialize(type: StoreType) {
    if (type === StoreType.S3) {
      this.store = new ObjectStore();
    }
  }

  public async uploadPDF(id: string, path: string) {
    if (!this.store) {
      throw new Error('Store not initialized');
    }
    return this.store.uploadPDF(id, path);
  }

  public async downloadPDF(id: string) {
    if (!this.store) {
      throw new Error('Store not initialized');
    }
    return this.store.downloadPDF(id);
  }
}

export const store = new StoreProxy();
