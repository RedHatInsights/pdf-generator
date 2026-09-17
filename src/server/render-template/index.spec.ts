import fs from 'fs';

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
