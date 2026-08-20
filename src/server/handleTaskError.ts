import { PdfGenerationError } from './errors';
import { apiLogger } from '../common/logging';
import PdfCache, { PdfStatus } from '../common/pdfCache';
import { UpdateStatus } from './utils';

export async function handleTaskError(
  err: Error,
  data: unknown,
): Promise<void> {
  apiLogger.error('Puppeteer cluster task error:', err, 'data:', data);

  let collectionId: string | undefined;
  let componentId: string | undefined;
  let order: number | undefined;

  if (data && typeof data === 'object' && 'collectionId' in data) {
    collectionId = (data as { collectionId: string }).collectionId;
    componentId = (data as { componentId?: string }).componentId;
    order = (data as { order?: number }).order;
  } else if (err instanceof PdfGenerationError) {
    collectionId = err.collectionId;
    componentId = err.componentId;
  }

  if (!collectionId) return;

  const message = err instanceof Error ? err.message : String(err);
  apiLogger.error(
    `Collection ${collectionId} failed after retries: ${message}`,
  );

  if (componentId) {
    await UpdateStatus({
      collectionId,
      status: PdfStatus.Failed,
      filepath: '',
      componentId,
      order,
      error: message,
    });
  } else {
    PdfCache.getInstance().invalidateCollection(collectionId, message);
  }
}
