import { Cluster } from 'puppeteer-cluster';
import config from '../common/config';
const BROWSER_TIMEOUT = 120_000;
import { CHROMIUM_PATH } from '../browser/helpers';
import { apiLogger } from '../common/logging';
import PdfCache, { PdfStatus } from '../common/pdfCache';
import { UpdateStatus } from './utils';

export const GetPupCluster = async () => {
  const CONCURRENCY_DEFAULT = 2;
  const concurrency =
    Number(process.env.MAX_CONCURRENCY) || CONCURRENCY_DEFAULT;
  apiLogger.debug(`Starting cluster with ${concurrency} workers`);
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: concurrency,
    // If a queued task fails, how many times will it retry before returning an error
    retryLimit: 2,
    timeout: BROWSER_TIMEOUT,
    puppeteerOptions: {
      timeout: BROWSER_TIMEOUT,
      ...(config?.IS_PRODUCTION
        ? {
            // we have a different dir structure than puppeteer expects. We have to point it to the correct chromium executable
            executablePath: CHROMIUM_PATH,
          }
        : {}),
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--no-zygote',
        '--no-first-run',
        '--disable-dev-shm-usage',
        '--mute-audio',
        "--proxy-server='direct://'",
        '--proxy-bypass-list=*',
      ],
    },
  });

  // Add error handlers to prevent unhandled rejections from cluster tasks
  cluster.on('taskerror', async (err: Error, data: unknown) => {
    apiLogger.error('Puppeteer cluster task error:', err, 'data:', data);

    // After all retries exhausted, record component failure and invalidate collection
    if (data && typeof data === 'object' && 'collectionId' in data) {
      const collectionId = (data as { collectionId: string }).collectionId;
      const componentId = (data as { componentId?: string }).componentId;
      const order = (data as { order?: number }).order;
      const message = err instanceof Error ? err.message : String(err);
      apiLogger.error(
        `Collection ${collectionId} failed after retries: ${message}`,
      );

      // Record component as Failed if componentId available
      if (componentId) {
        await UpdateStatus({
          collectionId,
          status: PdfStatus.Failed,
          filepath: '',
          componentId,
          order,
          error: message,
        });
        // UpdateStatus → verifyCollection → invalidateCollection (happens here)
      } else {
        // No componentId - directly invalidate collection
        PdfCache.getInstance().invalidateCollection(collectionId, message);
      }
    }
  });

  return cluster;
};

export const cluster = await GetPupCluster();
