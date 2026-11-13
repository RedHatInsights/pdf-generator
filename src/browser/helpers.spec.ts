const mockGlobSync = jest.fn<string[], [string]>();

jest.mock('glob', () => ({ glob: { sync: (p: string) => mockGlobSync(p) } }));

function loadHelpers({
  isProduction,
  chromiumPath,
}: {
  isProduction: boolean;
  chromiumPath?: string;
}): typeof import('./helpers') {
  jest.resetModules();
  jest.doMock('../common/config', () => ({
    __esModule: true,
    default: { IS_PRODUCTION: isProduction, CHROMIUM_PATH: chromiumPath },
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./helpers') as typeof import('./helpers');
}

describe('CHROMIUM_PATH', () => {
  beforeEach(() => {
    mockGlobSync.mockReset();
    mockGlobSync.mockReturnValue([]);
  });

  it('falls back to the bundled browser outside production', () => {
    expect(loadHelpers({ isProduction: false }).CHROMIUM_PATH).toBeUndefined();
  });

  it('locates chrome-headless-shell in the production image', () => {
    const shell = '/found/chrome-headless-shell-linux64/chrome-headless-shell';
    mockGlobSync.mockReturnValue([shell]);

    expect(loadHelpers({ isProduction: true }).CHROMIUM_PATH).toBe(shell);
    // The Dockerfile installs chrome-headless-shell, not full Chrome.
    expect(mockGlobSync).toHaveBeenCalledWith(
      expect.stringMatching(
        /\/\.cache\/puppeteer\/chrome-headless-shell\/\*\/chrome-headless-shell-linux64\/chrome-headless-shell$/,
      ),
    );
  });

  it('throws in production when no browser can be found', () => {
    expect(() => loadHelpers({ isProduction: true })).toThrow(
      /unable to locate chromium/,
    );
  });

  it('prefers an explicit CHROMIUM_PATH over the image layout', () => {
    mockGlobSync.mockReturnValue([
      '/found/chrome-headless-shell-linux64/chrome-headless-shell',
    ]);

    expect(
      loadHelpers({ isProduction: true, chromiumPath: '/explicit/chrome' })
        .CHROMIUM_PATH,
    ).toBe('/explicit/chrome');
  });

  it('lets a production build run where the image layout does not exist', () => {
    // The whole point: without this the glob throws and the process dies at
    // import, so a production build cannot be started off the production image.
    expect(() =>
      loadHelpers({ isProduction: true, chromiumPath: '/explicit/chrome' }),
    ).not.toThrow();
  });
});

describe('print layout', () => {
  const helpers = loadHelpers({ isProduction: false });

  it('gives the page A4 minus the margins', () => {
    expect(
      helpers.printableArea(false, {
        top: '80px',
        bottom: '54px',
        left: '28px',
        right: '28px',
      }),
    ).toEqual({ width: 738, height: 989 });
  });

  it('treats missing side margins as zero', () => {
    expect(
      helpers.printableArea(false, { top: '54px', bottom: '54px' }),
    ).toEqual({ width: 794, height: 1015 });
  });

  it('swaps the paper for landscape', () => {
    expect(
      helpers.printableArea(true, { top: '54px', bottom: '54px' }),
    ).toEqual({ width: 1123, height: 686 });
  });

  it('is on unless the template sends a literal false', () => {
    expect(helpers.usesPrintLayout(undefined)).toBe(true);
    expect(helpers.usesPrintLayout({})).toBe(true);
    expect(helpers.usesPrintLayout({ printLayout: true })).toBe(true);
    expect(helpers.usesPrintLayout({ printLayout: 'false' })).toBe(true);
    expect(helpers.usesPrintLayout({ printLayout: false })).toBe(false);
  });
});
