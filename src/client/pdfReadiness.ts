/**
 * Explicit PDF readiness contract helpers (opt-in via renderReadiness: 'explicit-v1').
 */

export function markReadinessContract(
  root: Element | null,
  renderReadiness?: string,
): void {
  if (renderReadiness === 'explicit-v1' && root) {
    root.setAttribute('data-pdf-readiness-contract', 'v1');
    root.setAttribute('data-pdf-ready', 'false');
  }
}

export async function waitForFonts(timeoutMs = 10000): Promise<void> {
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Font loading timeout')), timeoutMs),
    ),
  ]).catch((err) => {
    console.warn('[crc-pdf-generator] Font wait failed, proceeding:', err);
  });
}

export async function waitForImages(container: Element): Promise<void> {
  const images = Array.from(container.querySelectorAll('img'));
  const pending = images.filter((img) => !img.complete);
  await Promise.all(
    pending.map((img) =>
      new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
      }).then(async () => {
        if (typeof img.decode === 'function') {
          await img.decode().catch(() => {});
        }
      }),
    ),
  );
}

export function waitForTwoRAFs(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

export async function runReadinessGates(container: Element): Promise<void> {
  await waitForFonts();
  // Test instrumentation: stamp after fonts so harnesses can assert gate ordering
  (globalThis as { __fontTimestamp?: number }).__fontTimestamp = Date.now();
  await waitForImages(container);
  await waitForTwoRAFs();
}

export type PdfReadyGate = {
  promise: Promise<void>;
  resolve: () => void;
};

export function createPdfReadyGate(): PdfReadyGate {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return {
    promise,
    resolve: () => {
      (globalThis as { __callbackTimestamp?: number }).__callbackTimestamp =
        Date.now();
      resolve();
    },
  };
}

export function markPdfReady(container: Element): void {
  (globalThis as { __readyTimestamp?: number }).__readyTimestamp = Date.now();
  container.setAttribute('data-pdf-ready', 'true');
}
