import fs from 'fs';
import os from 'os';
import path from 'path';
import webpack, { Configuration as WebpackConfiguration } from 'webpack';

jest.mock('../../common/config', () => ({
  __esModule: true,
  default: {
    endpoints: {},
    IS_PRODUCTION: false,
  },
}));

// We need to import after mocking dependencies
let getHeaderAndFooterTemplates: typeof import('./index').getHeaderAndFooterTemplates;

describe('getHeaderAndFooterTemplates', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../common/config', () => ({
      __esModule: true,
      default: {
        endpoints: {},
        IS_PRODUCTION: false,
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('./index');
    getHeaderAndFooterTemplates = mod.getHeaderAndFooterTemplates;
  });

  it('reads template files on first call', () => {
    const result = getHeaderAndFooterTemplates();

    expect(result).toHaveProperty('headerTemplate');
    expect(result).toHaveProperty('footerTemplate');
    expect(typeof result.headerTemplate).toBe('string');
    expect(typeof result.footerTemplate).toBe('string');
  });

  it('returns cached templates on subsequent calls without re-reading files', () => {
    const readFileSync = jest.spyOn(fs, 'readFileSync');

    const first = getHeaderAndFooterTemplates();
    const callsAfterFirst = readFileSync.mock.calls.length;

    const second = getHeaderAndFooterTemplates();
    const callsAfterSecond = readFileSync.mock.calls.length;

    const third = getHeaderAndFooterTemplates();
    const callsAfterThird = readFileSync.mock.calls.length;

    // fs.readFileSync should only be called during first call (2 times for header and footer)
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(callsAfterSecond).toBe(callsAfterFirst); // No additional calls
    expect(callsAfterThird).toBe(callsAfterFirst); // No additional calls

    // All calls should return the same reference (cached)
    expect(first).toBe(second);
    expect(second).toBe(third);

    readFileSync.mockRestore();
  });

  it('templates contain rendered content', () => {
    const result = getHeaderAndFooterTemplates();

    // Both should have content (rendered React components)
    expect(result.headerTemplate.length).toBeGreaterThan(0);
    expect(result.footerTemplate.length).toBeGreaterThan(0);
  });

  it('substitutes the content placeholder in both templates', () => {
    // Same silent-no-op hazard as renderTemplate: these are String.replace calls
    // against HTML read off disk. Asserting only that the placeholder is gone
    // afterwards would also pass if the template stopped containing it, so pin
    // both ends — the file still offers the marker, and the output consumed it.
    const CONTENT_PLACEHOLDER = '<div id="content"></div>';
    const templateDir = path.resolve(process.cwd(), 'public', 'templates');
    const sources = {
      headerTemplate: fs.readFileSync(
        path.join(templateDir, 'header-template.html'),
        { encoding: 'utf-8' },
      ),
      footerTemplate: fs.readFileSync(
        path.join(templateDir, 'footer-template.html'),
        { encoding: 'utf-8' },
      ),
    };

    const rendered = [
      getHeaderAndFooterTemplates(),
      getHeaderAndFooterTemplates('lightwell'),
    ];

    for (const part of ['headerTemplate', 'footerTemplate'] as const) {
      expect(sources[part]).toContain(CONTENT_PLACEHOLDER);
      for (const templates of rendered) {
        expect(templates[part]).not.toContain(CONTENT_PLACEHOLDER);
        expect(templates[part].length).toBeGreaterThan(sources[part].length);
      }
    }
  });

  it('throws when a template has no content placeholder', () => {
    // Directly pins the failure mode the assertions above only imply: a
    // substitution that no longer matches must raise, not quietly return the
    // template and render an empty header or footer.
    const readFileSync = jest
      .spyOn(fs, 'readFileSync')
      .mockReturnValue('<html><body>no placeholder here</body></html>');

    try {
      expect(() => getHeaderAndFooterTemplates()).toThrow(/not found/);
    } finally {
      readFileSync.mockRestore();
    }
  });

  it('renders the Red Hat logo by default', () => {
    const result = getHeaderAndFooterTemplates();

    expect(result.headerTemplate).toContain('Layer_1');
    expect(result.headerTemplate).not.toContain('Lightwell');
  });

  it('renders Lightwell text-only header when no SVG is provided', () => {
    const result = getHeaderAndFooterTemplates('lightwell');

    expect(result.headerTemplate).toContain('Lightwell');
    expect(result.headerTemplate).not.toContain('Layer_1');
    expect(result.headerTemplate).not.toContain('<svg');
  });

  it('renders Lightwell header with logo SVG when provided', () => {
    const fakeSvg = '<svg viewBox="0 0 100 100"><circle r="10"/></svg>';
    const result = getHeaderAndFooterTemplates('lightwell', fakeSvg);

    expect(result.headerTemplate).toContain('Lightwell');
    expect(result.headerTemplate).toContain(fakeSvg);
    expect(result.headerTemplate).not.toContain('Layer_1');
  });

  it('does not cache Lightwell templates with dynamic SVG', () => {
    const svg1 = '<svg><rect width="10"/></svg>';
    const svg2 = '<svg><rect width="20"/></svg>';

    const result1 = getHeaderAndFooterTemplates('lightwell', svg1);
    const result2 = getHeaderAndFooterTemplates('lightwell', svg2);

    expect(result1.headerTemplate).toContain(svg1);
    expect(result2.headerTemplate).toContain(svg2);
    expect(result1).not.toBe(result2);
  });
});

describe('renderTemplate', () => {
  const payload = {
    manifestLocation: '/apps/advisor/fed-mods.json',
    scope: 'advisor',
    module: './BuildExecReport',
  };

  let tmpRoot: string;
  let cwdSpy: jest.SpyInstance<string, []>;
  // Built once with the real client webpack config — see buildProductionIndexHtml.
  let emittedIndexHtml: string;

  /**
   * Runs the project's own production client build (real webpack config, real
   * HtmlWebpackPlugin, trivial entry) and returns the index.html it emits.
   *
   * renderTemplate consumes this file by string substitution, so the build is
   * part of that contract: a webpack or minifier upgrade that rewrites the
   * emitted markup silently breaks state injection, and every generated PDF
   * comes out blank. Building here keeps that contract under test.
   */
  async function buildProductionIndexHtml(): Promise<string> {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    let clientConfig: WebpackConfiguration;
    try {
      // webpack.config.js reads NODE_ENV at require time.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const configs = require('../../../config/webpack.config') as [
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

    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'client-build-'));
    const entry = path.join(buildDir, 'stub.js');
    fs.writeFileSync(entry, 'export default 1;\n');

    const compiler = webpack({
      ...clientConfig,
      entry: { client: entry },
      output: { ...clientConfig.output, path: path.join(buildDir, 'out') },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        compiler.run((err, stats) => {
          if (err) {
            reject(err);
            return;
          }
          if (stats?.hasErrors()) {
            reject(new Error(stats.toString({ all: false, errors: true })));
            return;
          }
          compiler.close(() => resolve());
        });
      });
      return fs.readFileSync(path.join(buildDir, 'out', 'index.html'), {
        encoding: 'utf-8',
      });
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true });
    }
  }

  function render(indexHtml: string): string {
    fs.mkdirSync(path.join(tmpRoot, 'dist', 'public'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpRoot, 'dist', 'public', 'index.html'),
      indexHtml,
    );
    jest.resetModules();
    jest.doMock('../../common/config', () => ({
      __esModule: true,
      default: {
        endpoints: {},
        IS_PRODUCTION: true,
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const renderTemplate = require('./index').default as (
      p: typeof payload,
    ) => string;
    return renderTemplate(payload);
  }

  beforeAll(async () => {
    emittedIndexHtml = await buildProductionIndexHtml();
  }, 120000);

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'render-template-'));
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('injects initial state when the placeholder attribute is quoted', () => {
    const html = render(
      '<!doctype html><html><body><script id="initial-state"></script><div id="root"></div></body></html>',
    );

    expect(html).toContain('window.__initialState__');
    expect(html).toContain('advisor');
  });

  it('injects initial state when webpack has stripped the attribute quotes', () => {
    const html = render(
      '<!doctype html><html><body><script id=initial-state></script><div id=root></div></body></html>',
    );

    expect(html).toContain('window.__initialState__');
    expect(html).toContain('advisor');
  });

  it('throws when the initial-state placeholder cannot be found', () => {
    // Returning the untouched template leaves window.__initialState__ undefined,
    // the client bootstrap dies before React mounts, and the page renders blank
    // with no error element for Puppeteer to detect — so the collection is
    // reported Generated. Fail loudly instead.
    expect(() =>
      render('<!doctype html><html><body><div id="root"></div></body></html>'),
    ).toThrow(/initial-state/);
  });

  it('injects initial state into the index.html the production build emits', () => {
    const html = render(emittedIndexHtml);

    expect(html).toContain('window.__initialState__');
    expect(html).toContain('advisor');
  });

  it('injects initial state into the source client template', () => {
    // Guards the other end of the contract: an edit to src/client/index.html
    // that drops or renames the placeholder must fail here, not in production.
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', '..', 'client', 'index.html'),
      { encoding: 'utf-8' },
    );

    expect(render(source)).toContain('window.__initialState__');
  });
});
