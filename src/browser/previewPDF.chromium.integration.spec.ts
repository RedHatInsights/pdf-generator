/**
 * End-to-end smoke test for PDF printing: real Chromium, real previewPdf(),
 * real pdf-lib. No S3, Kafka, Scalprum or network egress.
 *
 * The mocked specs verify decisions; this one verifies that visible page
 * content actually reaches the printed PDF. Stage shipped header/footer-only
 * PDFs for two weeks while every mocked test stayed green, so the assertions
 * below deliberately do not stop at "it is a PDF with a page" — a blank page
 * satisfies both.
 */
import fs from 'fs';
import http from 'http';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import webpack, { Configuration as WebpackConfiguration } from 'webpack';
import puppeteer, { Browser, Page } from 'puppeteer';
import { PDFDocument } from 'pdf-lib';
import previewPdf from './previewPDF';
import renderTemplate from '../server/render-template';

let mockBrowser: Browser;

// src/server/cluster.ts launches Chromium with a top-level await, which ts-jest
// cannot compile (TS1378) — hence every spec in this repo stubs it. Stub only
// the queueing wrapper and hand previewPdf a page from a real browser, so the
// code under test, the rendering and the printing all stay real.
jest.mock('../server/cluster', () => ({
  cluster: {
    execute: async (task: (arg: { page: Page }) => Promise<unknown>) => {
      const page = await mockBrowser.newPage();
      return task({ page });
    },
  },
}));

// Characters chosen to be absent from the header (date) and footer (page
// numbers), so their presence in the font's ToUnicode map can only come from
// the body we printed.
const SENTINEL = 'QZJXKVW';

const PAGES: Record<string, string> = {
  '/blank': '<!doctype html><html><body></body></html>',
  '/content': `<!doctype html><html><body><h1>${SENTINEL}</h1><p>${SENTINEL} must be printed.</p></body></html>`,
};

const PAYLOAD = {
  manifestLocation: '/apps/nonexistent/fed-mods.json',
  scope: 'advisor',
  module: './BuildExecReport',
};

let server: http.Server;
let origin: string;
/** Temp dir holding a real production client build, laid out as dist/public. */
let buildRoot = '';

/**
 * Runs the project's real production client build into a temp dist/public.
 *
 * The bundle is what interprets the state renderTemplate injects, so the test
 * needs the genuine article rather than a stub entry.
 */
async function buildProductionClient(): Promise<string> {
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  jest.resetModules();
  let clientConfig: WebpackConfiguration;
  try {
    // webpack.config.js reads NODE_ENV at require time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const configs = require('../../config/webpack.config') as [
      WebpackConfiguration,
      WebpackConfiguration,
    ];
    clientConfig = configs[1];
  } finally {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-dist-'));
  const outDir = path.join(root, 'dist', 'public');
  const compiler = webpack({
    ...clientConfig,
    output: { ...clientConfig.output, path: outDir },
  });

  await new Promise<void>((resolve, reject) => {
    compiler.run((error, stats) => {
      if (error) {
        reject(error);
        return;
      }
      if (stats?.hasErrors()) {
        reject(new Error(stats.toString({ all: false, errors: true })));
        return;
      }
      compiler.close(() => resolve());
    });
  });

  return root;
}

/** renderTemplate reads dist/public/index.html relative to cwd. */
function renderPuppeteerPage(): string {
  const cwd = jest.spyOn(process, 'cwd').mockReturnValue(buildRoot);
  try {
    return renderTemplate(PAYLOAD);
  } finally {
    cwd.mockRestore();
  }
}

/** Decodes a UTF-16BE hex string as written in a CMap destination, e.g. "0041". */
function decodeHex(hex: string): string {
  let text = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) {
    text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  }
  return text;
}

/** Yields every flate-compressed stream in the PDF, decompressed. */
function* inflatedStreams(pdf: Buffer): Generator<string> {
  let cursor = 0;
  for (;;) {
    const start = pdf.indexOf('stream', cursor);
    if (start === -1) {
      return;
    }
    let from = start + 'stream'.length;
    if (pdf[from] === 0x0d) from += 1;
    if (pdf[from] === 0x0a) from += 1;
    const end = pdf.indexOf('endstream', from);
    if (end === -1) {
      return;
    }
    try {
      yield zlib.inflateSync(pdf.subarray(from, end)).toString('latin1');
    } catch {
      // not a flate stream (raw content, image data) — nothing to read here
    }
    cursor = end + 'endstream'.length;
  }
}

/**
 * Collects every character the PDF's embedded fonts map back to Unicode.
 *
 * Chrome writes a ToUnicode CMap per subset font listing only the glyphs it
 * actually painted, so this proves the text reached the page without pulling in
 * a PDF text extractor. Mappings arrive as either individual `bfchar` entries or
 * `bfrange` runs, and both forms have to be read — glyph ids that happen to be
 * consecutive are emitted as ranges.
 */
function paintedCharacters(pdf: Buffer): Set<string> {
  const characters = new Set<string>();

  for (const stream of inflatedStreams(pdf)) {
    for (const [, entries] of stream.matchAll(
      /beginbfchar([\s\S]*?)endbfchar/g,
    )) {
      for (const [, , destination] of entries.matchAll(
        /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
      )) {
        for (const character of decodeHex(destination)) {
          characters.add(character);
        }
      }
    }

    for (const [, entries] of stream.matchAll(
      /beginbfrange([\s\S]*?)endbfrange/g,
    )) {
      // <lo> <hi> <destination> — a run mapped onto consecutive code points.
      for (const [, low, high, destination] of entries.matchAll(
        /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g,
      )) {
        const span = parseInt(high, 16) - parseInt(low, 16);
        const first = decodeHex(destination);
        const base = first.codePointAt(first.length - 1) ?? 0;
        for (let offset = 0; offset <= span; offset += 1) {
          characters.add(String.fromCodePoint(base + offset));
        }
      }
      // <lo> <hi> [<d1> <d2> ...] — a run mapped onto an explicit list.
      for (const [, list] of entries.matchAll(
        /<[0-9a-fA-F]+>\s*<[0-9a-fA-F]+>\s*\[([^\]]*)\]/g,
      )) {
        for (const [, destination] of list.matchAll(/<([0-9a-fA-F]+)>/g)) {
          for (const character of decodeHex(destination)) {
            characters.add(character);
          }
        }
      }
    }
  }

  return characters;
}

beforeAll(async () => {
  // Same flags as src/server/cluster.ts, so the printing path matches production.
  mockBrowser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--no-zygote',
      '--no-first-run',
      '--disable-dev-shm-usage',
      '--mute-audio',
    ],
  });

  buildRoot = await buildProductionClient();

  server = http.createServer((req, res) => {
    const url = req.url ?? '';

    if (url === '/puppeteer') {
      res
        .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(renderPuppeteerPage());
      return;
    }

    if (url.startsWith('/public/')) {
      const asset = path.join(buildRoot, 'dist', url);
      if (fs.existsSync(asset)) {
        res
          .writeHead(200, {
            'Content-Type': asset.endsWith('.css')
              ? 'text/css'
              : 'application/javascript',
          })
          .end(fs.readFileSync(asset));
        return;
      }
    }

    const body = PAGES[url];
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res
      .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // 127.0.0.1 rather than localhost: an IPv6-first resolver sends the browser
  // to ::1 while the server is only bound to the IPv4 loopback.
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 180000);

afterAll(async () => {
  await mockBrowser.close();
  fs.rmSync(buildRoot, { recursive: true, force: true });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('previewPdf against real Chromium', () => {
  it('prints page content into the PDF', async () => {
    const blank = await previewPdf(`${origin}/blank`);
    const content = await previewPdf(`${origin}/content`);

    expect(content.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(content)).getPageCount()).toBeGreaterThan(0);

    // A header/footer-only PDF passes everything above, so compare against one.
    expect(content.byteLength).toBeGreaterThan(blank.byteLength);

    const painted = paintedCharacters(content);
    const paintedOnBlank = paintedCharacters(blank);
    for (const character of SENTINEL) {
      expect(painted.has(character)).toBe(true);
      expect(paintedOnBlank.has(character)).toBe(false);
    }
  }, 180000);

  /**
   * The end-to-end form of the incident: real production client bundle, real
   * renderTemplate, real browser. Asserts the state survives the whole path
   * rather than just appearing in renderTemplate's output string — a malformed
   * injection (bad escaping, say) reads fine as text and still leaves the page
   * dead, which is indistinguishable from the original failure downstream.
   */
  it('exposes the injected state to the client bundle and mounts the app', async () => {
    const page = await mockBrowser.newPage();
    try {
      await page.goto(`${origin}/puppeteer`, { waitUntil: 'networkidle2' });

      const state = await page.evaluate(
        () =>
          (window as unknown as { __initialState__?: { scope?: string } })
            .__initialState__,
      );
      expect(state?.scope).toBe(PAYLOAD.scope);

      // manifestLocation 404s on purpose, so the app must surface that failure in
      // the element Puppeteer looks for. Asserting only that #root is non-empty
      // would be satisfied by the transient "Loading..." state.
      await page.waitForSelector('#crc-pdf-generator-err', { timeout: 30000 });
      const reported = await page.evaluate(
        () =>
          document.getElementById('crc-pdf-generator-err')?.innerText?.trim() ??
          '',
      );
      expect(reported).not.toBe('');
    } finally {
      await page.close();
    }
  }, 180000);
});
