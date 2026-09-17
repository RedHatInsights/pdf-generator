import { Counter, Histogram, Registry, register } from 'prom-client';

/**
 * Application metrics describing what the service actually produced.
 *
 * Until RHCLOUD-51334 only default process/nodejs metrics were exported, so
 * nothing in the platform could tell a healthy report from a blank one: every
 * PDF for a week was header-and-footer only and every one was reported
 * Generated. These describe the output, not the request.
 *
 * express-prom-bundle serves prom-client's default registry, so registering
 * here is enough for the metrics to appear on /metrics.
 */

export enum ComponentOutcome {
  /** A PDF with rendered content was produced. */
  Generated = 'generated',
  /** The page produced no content — the RHCLOUD-51334 failure. */
  Blank = 'blank',
  /** Any other failure: render error, bad page status, upload failure. */
  Failed = 'failed',
}

/**
 * Reuses an already-registered metric rather than throwing.
 *
 * Jest resets module registries between suites while prom-client's default
 * registry is process-wide, so a plain constructor call raises "A metric with
 * the name ... has already been registered".
 */
function register_<T>(name: string, create: () => T, registry: Registry): T {
  const existing = registry.getSingleMetric(name);
  return existing ? (existing as T) : create();
}

export const componentResultTotal = register_(
  'crc_pdf_generator_component_result_total',
  () =>
    new Counter({
      name: 'crc_pdf_generator_component_result_total',
      help: 'PDF components by outcome. A rising "blank" is the failure mode that went unnoticed for a week in RHCLOUD-51334.',
      labelNames: ['outcome'] as const,
    }),
  register,
);

export const pdfPages = register_(
  'crc_pdf_generator_pdf_pages',
  () =>
    new Histogram({
      name: 'crc_pdf_generator_pdf_pages',
      help: 'Page count of each generated PDF.',
      buckets: [1, 2, 5, 10, 25, 50, 100, 250],
    }),
  register,
);

export const pdfBytes = register_(
  'crc_pdf_generator_pdf_bytes',
  () =>
    new Histogram({
      name: 'crc_pdf_generator_pdf_bytes',
      help: 'Size of each generated PDF. A blank report is ~14KB; a real one is hundreds of KB to several MB, which is the signal the absence alert watches.',
      buckets: [
        16_384, 32_768, 65_536, 131_072, 524_288, 1_048_576, 5_242_880,
        20_971_520,
      ],
    }),
  register,
);

export function recordComponentOutcome(outcome: ComponentOutcome): void {
  componentResultTotal.inc({ outcome });
}

export function recordGeneratedPdf(pages: number, bytes: number): void {
  recordComponentOutcome(ComponentOutcome.Generated);
  pdfPages.observe(pages);
  pdfBytes.observe(bytes);
}
