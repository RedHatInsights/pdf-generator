import { Cluster } from 'puppeteer-cluster';
// Match the timeout on the gateway
const BROWSER_TIMEOUT = 60_000;
import { apiLogger } from '../common/logging';

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
    puppeteerOptions: {
      timeout: BROWSER_TIMEOUT,
      browser: 'firefox',
      executablePath: '/usr/bin/firefox',
    },
  });
  return cluster;
};

export const cluster = await GetPupCluster();
