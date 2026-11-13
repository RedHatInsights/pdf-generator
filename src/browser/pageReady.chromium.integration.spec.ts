/**
 * Runs the real readiness wait against real Chromium. The mocked specs only
 * prove the generator calls waitForPageReady before printing; this proves it
 * does not return while the report is still loading — the failure mode that
 * would silently print a partial PDF.
 */
import http from 'http';
import { AddressInfo } from 'net';
import puppeteer, { Browser, Page } from 'puppeteer';
import { MAX_SETTLE_MS, trackRequests, waitForPageReady } from './pageReady';

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    warning: jest.fn(),
  },
}));

/** Longer than the DOM quiet window, so a still DOM alone would print early. */
const SLOW_MS = 800;

const MARK_READY = `window.__PDF_READY__ = true; window.dispatchEvent(new Event('pdf-ready'));`;
const ADD_ROWS = `(rows) => rows.forEach((row) => {
  document.querySelector('table').insertRow().insertCell().textContent = row;
})`;

const SHOW_PLACEHOLDER = `document.getElementById('root').innerHTML = '<div data-pdf-loading>Loading...</div>';`;
const SHOW_ROW = `document.getElementById('root').innerHTML = '<table><tr><td>row</td></tr></table>';`;
// A web font that takes SLOW_MS to arrive, requested at the first layout.
const USE_SLOW_FONT = `document.head.insertAdjacentHTML('beforeend',
  '<style>@font-face { font-family: slow; src: url(/slow-font.woff2); } body { font-family: slow; }</style>');`;

const page = (script: string, body = '<table></table>') =>
  `<!doctype html><html><body><div id="root">${body}</div><script>${script}</script></body></html>`;

const PAGES: Record<string, string> = {
  '/still': page(MARK_READY, '<p>done</p>'),
  '/placeholder': page(
    `${MARK_READY}
    setTimeout(() => {
      document.getElementById('root').innerHTML = '<table><tr><td>row</td></tr></table>';
    }, ${SLOW_MS});`,
    '<div data-pdf-loading>Loading...</div>',
  ),
  // Appends a row every 40 ms (inside the quiet window) for 400 ms.
  '/growing': page(
    `${MARK_READY}
    let added = 0;
    const timer = setInterval(() => {
      document.querySelector('table').insertRow().insertCell().textContent = added;
      added += 1;
      if (added === 10) clearInterval(timer);
    }, 40);`,
  ),
  // Turns ready without touching the DOM: only the event announces it.
  '/silent-flag': page(
    `window.__PDF_READY__ = false; setTimeout(() => { ${MARK_READY} }, ${SLOW_MS});`,
    '<p>done</p>',
  ),
  '/never-ready': page('window.__PDF_READY__ = false;', '<p>done</p>'),
  '/stuck-placeholder': page(
    MARK_READY,
    '<div data-pdf-loading>Loading...</div>',
  ),
  '/fetch': page(
    `${MARK_READY} fetch('/rows?slow=headers').then((r) => r.json()).then(${ADD_ROWS});`,
  ),
  '/fetch-slow-body': page(
    `${MARK_READY} fetch('/rows?slow=body').then((r) => r.json()).then(${ADD_ROWS});`,
  ),
  '/xhr': page(
    `${MARK_READY}
    const xhr = new XMLHttpRequest();
    xhr.onload = () => (${ADD_ROWS})(JSON.parse(xhr.responseText));
    xhr.open('GET', '/rows?slow=headers');
    xhr.send();`,
  ),
  // How webpack loads a lazy chunk: a script tag, invisible to XHR/fetch hooks.
  // Added after the load event, as templates do; before it, the pending
  // resource would hold back document.fonts.ready and hide a tracking gap.
  '/lazy-chunk': page(
    `${MARK_READY}
    window.addEventListener('load', () => {
      const chunk = document.createElement('script');
      chunk.src = '/chunk.js';
      document.head.appendChild(chunk);
    });`,
  ),
  '/image': page(
    `${MARK_READY}
    window.addEventListener('load', () => {
      document.getElementById('root').innerHTML = '<img src="/pixel.png">';
    });`,
    '',
  ),
  '/slow-font': page(`${USE_SLOW_FONT} ${MARK_READY}`, '<p>text</p>'),
  // The DOM goes quiet, then a placeholder shows up while the font is still
  // loading and no other request is open.
  '/placeholder-during-fonts': page(
    `${USE_SLOW_FONT} ${MARK_READY}
    setTimeout(() => { ${SHOW_PLACEHOLDER} }, 300);
    setTimeout(() => { ${SHOW_ROW} }, 1500);`,
    '<p>text</p>',
  ),
  // Looks rendered for a moment, then loads for longer than MAX_SETTLE_MS.
  '/placeholder-returns': page(
    `${MARK_READY}
    setTimeout(() => { ${SHOW_PLACEHOLDER} }, 50);
    setTimeout(() => { ${SHOW_ROW} }, ${MAX_SETTLE_MS + 500});`,
    '<p>text</p>',
  ),
  // No client bundle, so no flag: must still wait for its request.
  '/no-flag': page(
    `fetch('/rows?slow=headers').then((r) => r.json()).then(${ADD_ROWS});`,
  ),
};

const CHUNK = `(${ADD_ROWS})(['a', 'b', 'c']);`;
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

let browser: Browser;
let server: http.Server;
let origin: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const later = (send: () => void) => setTimeout(send, SLOW_MS);
    if (url.pathname in PAGES) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGES[url.pathname]);
    } else if (url.pathname === '/rows') {
      const sendHeaders = () =>
        res.writeHead(200, { 'Content-Type': 'application/json' });
      if (url.searchParams.get('slow') === 'body') {
        sendHeaders();
        res.flushHeaders();
        later(() => res.end('["a","b","c"]'));
      } else {
        later(() => {
          sendHeaders();
          res.end('["a","b","c"]');
        });
      }
    } else if (url.pathname === '/chunk.js') {
      later(() => {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(CHUNK);
      });
    } else if (url.pathname === '/slow-font.woff2') {
      later(() => {
        res.writeHead(404);
        res.end();
      });
    } else if (url.pathname === '/pixel.png') {
      later(() => {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(PIXEL);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-gpu', '--no-zygote', '--no-first-run'],
  });
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
});

/** Opens `path` the way the generator does and waits for it to be ready. */
async function openReady<T>(
  path: string,
  inspect: (page: Page, elapsedMs: number) => Promise<T>,
  {
    timeout,
    prepare,
  }: { timeout?: number; prepare?: (page: Page) => Promise<void> } = {},
): Promise<T> {
  const tab = await browser.newPage();
  try {
    await prepare?.(tab);
    const requests = trackRequests(tab);
    await tab.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' });
    const started = Date.now();
    await waitForPageReady(tab, requests, timeout);
    return await inspect(tab, Date.now() - started);
  } finally {
    await tab.close();
  }
}

const placeholderAndRow = (tab: Page) =>
  tab.evaluate(() => ({
    placeholder: document.querySelector('[data-pdf-loading]') !== null,
    cell: document.querySelector('td')?.textContent,
  }));

const cellCount = (tab: Page) =>
  tab.evaluate(() => document.querySelectorAll('td').length);

describe('waitForPageReady in real Chromium', () => {
  it('is ready quickly once a rendered page is still', async () => {
    const elapsed = await openReady('/still', async (_tab, ms) => ms);

    // The point of the change: well under networkidle2's 500 ms + the old 1 s.
    expect(elapsed).toBeLessThan(500);
  });

  it.each([
    ['is shown from the start', '/placeholder'],
    ['appears while fonts are loading', '/placeholder-during-fonts'],
    ['comes back for longer than the settle cap', '/placeholder-returns'],
  ])('waits while a loading placeholder %s', async (_name, path) => {
    expect(await openReady(path, placeholderAndRow)).toEqual({
      placeholder: false,
      cell: 'row',
    });
  });

  it('waits for the DOM to stop changing', async () => {
    expect(await openReady('/growing', cellCount)).toBe(10);
  });

  it('waits for a ready flag that turns true without a DOM change', async () => {
    const state = await openReady('/silent-flag', async (tab, elapsed) => ({
      ready: await tab.evaluate(() => window.__PDF_READY__),
      elapsed,
    }));

    expect(state.ready).toBe(true);
    expect(state.elapsed).toBeGreaterThanOrEqual(SLOW_MS - 200);
  });

  it.each([
    ['a fetch waiting for its response', '/fetch'],
    ['a fetch whose body is still downloading', '/fetch-slow-body'],
    ['an XHR', '/xhr'],
    ['a lazy script chunk', '/lazy-chunk'],
    ['a page without the ready flag', '/no-flag'],
  ])('waits for %s', async (_name, path) => {
    expect(await openReady(path, cellCount)).toBe(3);
  });

  it('waits for images', async () => {
    const loaded = await openReady('/image', (tab) =>
      tab.evaluate(() => {
        const img = document.querySelector('img');
        return img !== null && img.complete && img.naturalWidth > 0;
      }),
    );

    expect(loaded).toBe(true);
  });

  it('waits for fonts', async () => {
    const state = await openReady('/slow-font', async (tab, elapsed) => ({
      fonts: await tab.evaluate(() => document.fonts.status),
      elapsed,
    }));

    expect(state.fonts).toBe('loaded');
    expect(state.elapsed).toBeGreaterThanOrEqual(SLOW_MS - 200);
  });

  // clusterTask.ts answers cached assets itself through request interception.
  it('sees intercepted requests finish', async () => {
    const cells = await openReady('/lazy-chunk', cellCount, {
      prepare: async (tab) => {
        await tab.setRequestInterception(true);
        tab.on('request', (request) => {
          if (request.url().endsWith('/chunk.js')) {
            void request.respond({
              status: 200,
              contentType: 'application/javascript',
              body: CHUNK,
            });
          } else {
            void request.continue();
          }
        });
      },
    });

    expect(cells).toBe(3);
  });

  it.each([
    ['never reports ready', '/never-ready', /the page to report ready/],
    ['keeps a placeholder up', '/stuck-placeholder', /loading placeholder/],
  ])('fails, saying why, when the page %s', async (_name, path, reason) => {
    await expect(
      openReady(path, () => Promise.resolve(), { timeout: 500 }),
    ).rejects.toThrow(reason);
  });
});
