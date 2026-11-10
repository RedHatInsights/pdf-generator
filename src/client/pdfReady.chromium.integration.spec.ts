/**
 * Runs the real pdfReady.ts in real Chromium. The mocked generator specs only
 * prove the generator waits for the flag; this proves the flag is not raised
 * while the report is still loading — the failure mode that would silently
 * print a partial PDF.
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import puppeteer, { Browser, Page } from 'puppeteer';

let browser: Browser;
let moduleSource = '';

type ReadyWindow = Window & {
  __PDF_READY__?: boolean;
  pdfReady: typeof import('./pdfReady');
};

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent(
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  await page.addScriptTag({ type: 'module', content: moduleSource });
  await page.waitForFunction(
    () => (window as unknown as ReadyWindow).pdfReady !== undefined,
  );
  return page;
}

const isReady = (page: Page) =>
  page.evaluate(() => (window as unknown as ReadyWindow).__PDF_READY__);

beforeAll(async () => {
  const source = fs.readFileSync(path.join(__dirname, 'pdfReady.ts'), 'utf-8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  });
  moduleSource = `${outputText.replace(/^export /gm, '')}
window.pdfReady = { PDF_LOADING_ATTR, markPdfPending, signalReadyWhenSettled, trackNetworkRequests };`;

  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--no-first-run'],
  });
}, 60000);

afterAll(async () => {
  await browser?.close();
});

describe('signalReadyWhenSettled in real Chromium', () => {
  it('stays not-ready while a loading placeholder is shown', async () => {
    const page = await openPage();
    try {
      await page.evaluate(() => {
        const { pdfReady } = window as unknown as ReadyWindow;
        pdfReady.markPdfPending();
        const root = document.getElementById('root')!;
        root.innerHTML = `<div ${pdfReady.PDF_LOADING_ATTR}>Loading...</div>`;
        void pdfReady.signalReadyWhenSettled(root);
      });

      // Far longer than the quiet window: a DOM that is merely still must not
      // count as settled while the placeholder is up.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(await isReady(page)).toBe(false);

      await page.evaluate(() => {
        document.getElementById('root')!.innerHTML =
          '<table><tr><td>row</td></tr></table>';
      });
      await page.waitForFunction(
        () => (window as unknown as ReadyWindow).__PDF_READY__ === true,
        { timeout: 5000 },
      );
      expect(
        await page.evaluate(() => document.querySelector('td')?.textContent),
      ).toBe('row');
    } finally {
      await page.close();
    }
  }, 30000);

  it('waits for the DOM to stop changing before signalling ready', async () => {
    const page = await openPage();
    try {
      const rowsWhenReady = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const { pdfReady } = window as unknown as ReadyWindow;
            pdfReady.markPdfPending();
            const root = document.getElementById('root')!;
            root.innerHTML = '<table></table>';
            const table = root.querySelector('table')!;
            // Append a row every 40 ms (inside the quiet window) for 400 ms.
            let added = 0;
            const timer = setInterval(() => {
              table.insertRow().insertCell().textContent = `row ${added}`;
              added += 1;
              if (added === 10) clearInterval(timer);
            }, 40);
            void pdfReady
              .signalReadyWhenSettled(root)
              .then(() => resolve(table.rows.length));
          }),
      );
      expect(rowsWhenReady).toBe(10);
    } finally {
      await page.close();
    }
  }, 30000);

  it('signals ready quickly once a rendered page is still', async () => {
    const page = await openPage();
    try {
      const elapsed = await page.evaluate(async () => {
        const { pdfReady } = window as unknown as ReadyWindow;
        pdfReady.markPdfPending();
        const root = document.getElementById('root')!;
        root.innerHTML = '<p>done</p>';
        const started = performance.now();
        await pdfReady.signalReadyWhenSettled(root);
        return performance.now() - started;
      });
      expect(await isReady(page)).toBe(true);
      // The point of the change: well under networkidle2's 500 ms + the old 1 s.
      expect(elapsed).toBeLessThan(500);
    } finally {
      await page.close();
    }
  }, 30000);

  it('stays not-ready while a template data request is in flight', async () => {
    const page = await openPage();
    try {
      await page.evaluate(() => {
        const { pdfReady } = window as unknown as ReadyWindow;
        // Stand-in for a slow API: resolves after 1 s. Installed before
        // tracking so the tracker wraps it, as it wraps the real fetch.
        window.fetch = () =>
          new Promise<Response>((resolve) =>
            setTimeout(() => resolve(new Response('[1,2,3]')), 1000),
          );
        pdfReady.trackNetworkRequests();
        pdfReady.markPdfPending();
        const root = document.getElementById('root')!;
        // The template has mounted (no placeholder) and fetches more data,
        // leaving the DOM still for far longer than the quiet window.
        root.innerHTML = '<table></table>';
        void fetch('/more-rows')
          .then((response) => response.json())
          .then((rows: number[]) => {
            const table = root.querySelector('table')!;
            rows.forEach((row) => {
              table.insertRow().insertCell().textContent = `row ${row}`;
            });
          });
        void pdfReady.signalReadyWhenSettled(root);
      });

      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(await isReady(page)).toBe(false);

      await page.waitForFunction(
        () => (window as unknown as ReadyWindow).__PDF_READY__ === true,
        { timeout: 5000 },
      );
      expect(
        await page.evaluate(() => document.querySelectorAll('td').length),
      ).toBe(3);
    } finally {
      await page.close();
    }
  }, 30000);

  it('stays not-ready while a fetch response body is still downloading', async () => {
    const page = await openPage();
    try {
      await page.evaluate(() => {
        const { pdfReady } = window as unknown as ReadyWindow;
        // Headers arrive at once; the body takes another second. fetch()
        // resolves on headers, so the body read must also count as loading.
        window.fetch = () =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  setTimeout(() => {
                    controller.enqueue(new TextEncoder().encode('[1,2,3]'));
                    controller.close();
                  }, 1000);
                },
              }),
            ),
          );
        pdfReady.trackNetworkRequests();
        pdfReady.markPdfPending();
        const root = document.getElementById('root')!;
        root.innerHTML = '<table></table>';
        void fetch('/more-rows')
          .then((response) => response.json())
          .then((rows: number[]) => {
            const table = root.querySelector('table')!;
            rows.forEach((row) => {
              table.insertRow().insertCell().textContent = `row ${row}`;
            });
          });
        void pdfReady.signalReadyWhenSettled(root);
      });

      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(await isReady(page)).toBe(false);

      await page.waitForFunction(
        () => (window as unknown as ReadyWindow).__PDF_READY__ === true,
        { timeout: 5000 },
      );
      expect(
        await page.evaluate(() => document.querySelectorAll('td').length),
      ).toBe(3);
    } finally {
      await page.close();
    }
  }, 30000);
});
