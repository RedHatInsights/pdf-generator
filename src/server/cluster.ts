import { Cluster } from 'puppeteer-cluster';
import config from '../common/config';
// Match the timeout on the gateway
const BROWSER_TIMEOUT = 60_000;
import { CHROMIUM_PATH } from '../browser/helpers';

export const GetPupCluster = async () => {
  const CONCURRENCY_DEFAULT = 2;
  const cluster = await Cluster.launch({
    concurrency: Cluster.CONCURRENCY_CONTEXT,
    maxConcurrency: Number(process.env.MAX_CONCURRENCY) || CONCURRENCY_DEFAULT,
    // If a queued task fails, how many times will it retry before returning an error
    retryLimit: 2,
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
  return cluster;
};

export const cluster = await GetPupCluster();
