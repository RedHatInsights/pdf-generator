import WP from 'workerpool';
import { MaxWorkers } from '../browser/helpers';

const createWorker = () => {
  console.log(`New worker created`);
};

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
const pool = WP.pool('./dist/puppeteerWorker.js', {
  maxWorkers: MaxWorkers,
  workerType: 'process',
  onCreateWorker: createWorker,
});

export default pool;
