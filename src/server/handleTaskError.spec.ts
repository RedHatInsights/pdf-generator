import PdfCache, { PdfStatus } from '../common/pdfCache';
import { PdfGenerationError } from './errors';
import { handleTaskError } from './handleTaskError';
import { register } from 'prom-client';
import { ComponentOutcome, componentResultTotal } from '../common/metrics';

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('./utils', () => ({
  UpdateStatus: jest.fn(),
}));

const { UpdateStatus } = jest.requireMock('./utils');

async function outcomeCount(outcome: ComponentOutcome): Promise<number> {
  const metric = await componentResultTotal.get();
  return metric.values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
}

describe('handleTaskError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    register.resetMetrics();
  });

  it('does not mark a component as Failed when the task will be retried', async () => {
    await handleTaskError(
      new Error('transient task failure'),
      {
        collectionId: 'coll-retry',
        componentId: 'comp-retry',
        order: 1,
      },
      true,
    );

    expect(UpdateStatus).not.toHaveBeenCalled();
    await expect(outcomeCount(ComponentOutcome.Failed)).resolves.toBe(0);
  });

  it('extracts collectionId and componentId from data and calls UpdateStatus(Failed)', async () => {
    await handleTaskError(new Error('task failed'), {
      collectionId: 'coll-data',
      componentId: 'comp-data',
      order: 2,
    });

    expect(UpdateStatus).toHaveBeenCalledWith({
      collectionId: 'coll-data',
      status: PdfStatus.Failed,
      filepath: '',
      componentId: 'comp-data',
      order: 2,
      error: 'task failed',
    });
    await expect(outcomeCount(ComponentOutcome.Failed)).resolves.toBe(1);
  });

  it('records a classified blank outcome only after retries are exhausted', async () => {
    await handleTaskError(
      new PdfGenerationError(
        'coll-blank',
        'comp-blank',
        'blank render',
        ComponentOutcome.Blank,
      ),
      {
        collectionId: 'coll-blank',
        componentId: 'comp-blank',
        order: 1,
      },
    );

    await expect(outcomeCount(ComponentOutcome.Blank)).resolves.toBe(1);
    await expect(outcomeCount(ComponentOutcome.Failed)).resolves.toBe(0);
  });

  it('falls back to PdfGenerationError when data is undefined', async () => {
    await handleTaskError(
      new PdfGenerationError('coll-err', 'comp-err', 'generation failed'),
      undefined,
    );

    expect(UpdateStatus).toHaveBeenCalledWith({
      collectionId: 'coll-err',
      status: PdfStatus.Failed,
      filepath: '',
      componentId: 'comp-err',
      order: undefined,
      error: 'generation failed',
    });
  });

  it('returns early when data is undefined and error is a plain Error', async () => {
    await handleTaskError(new Error('plain failure'), undefined);

    expect(UpdateStatus).not.toHaveBeenCalled();
  });

  it('invalidates collection when componentId is missing from data', async () => {
    const pdfCache = PdfCache.getInstance();
    const spy = jest.spyOn(pdfCache, 'invalidateCollection');

    await handleTaskError(new Error('no component id'), {
      collectionId: 'coll-no-comp',
    });

    expect(spy).toHaveBeenCalledWith('coll-no-comp', 'no component id');
    expect(UpdateStatus).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
