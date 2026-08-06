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
    // Re-import to get fresh module state
    jest.resetModules();
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
});
