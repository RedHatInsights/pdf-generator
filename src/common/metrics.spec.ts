import { register } from 'prom-client';
import {
  ComponentOutcome,
  componentResultTotal,
  pdfBytes,
  pdfPages,
  recordComponentOutcome,
  recordGeneratedPdf,
} from './metrics';

async function counterFor(outcome: ComponentOutcome): Promise<number> {
  const metric = await componentResultTotal.get();
  return metric.values.find((v) => v.labels.outcome === outcome)?.value ?? 0;
}

async function histogramSum(histogram: typeof pdfPages): Promise<number> {
  const metric = await histogram.get();
  return metric.values.find((v) => v.metricName?.endsWith('_sum'))?.value ?? 0;
}

describe('metrics', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('is exported on the default registry express-prom-bundle serves', async () => {
    recordComponentOutcome(ComponentOutcome.Generated);
    const exposed = await register.metrics();

    expect(exposed).toContain('crc_pdf_generator_component_result_total');
    expect(exposed).toContain('crc_pdf_generator_pdf_pages');
    expect(exposed).toContain('crc_pdf_generator_pdf_bytes');
  });

  it('counts each outcome separately', async () => {
    recordComponentOutcome(ComponentOutcome.Blank);
    recordComponentOutcome(ComponentOutcome.Blank);
    recordComponentOutcome(ComponentOutcome.Failed);

    await expect(counterFor(ComponentOutcome.Blank)).resolves.toBe(2);
    await expect(counterFor(ComponentOutcome.Failed)).resolves.toBe(1);
    await expect(counterFor(ComponentOutcome.Generated)).resolves.toBe(0);
  });

  it('records pages and bytes alongside a generated outcome', async () => {
    recordGeneratedPdf(12, 402_133);

    await expect(counterFor(ComponentOutcome.Generated)).resolves.toBe(1);
    await expect(histogramSum(pdfPages)).resolves.toBe(12);
    await expect(histogramSum(pdfBytes)).resolves.toBe(402_133);
  });

  it('separates a blank report from a real one by size', async () => {
    // The whole point of the byte histogram: on stage every blank PDF was
    // 14296 bytes while real reports ran to hundreds of KB. The alert keys off
    // that gap, so the buckets have to straddle it.
    recordGeneratedPdf(1, 14_296);
    const blankBuckets = (await pdfBytes.get()).values.filter(
      (v) => v.metricName?.endsWith('_bucket') && v.value === 1,
    );
    const smallest = blankBuckets
      .map((v) => Number(v.labels.le))
      .sort((a, b) => a - b)[0];

    expect(smallest).toBe(16_384);
  });

  it('survives a module registry reset without re-registering', () => {
    jest.resetModules();

    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./metrics');
    }).not.toThrow();
  });
});
