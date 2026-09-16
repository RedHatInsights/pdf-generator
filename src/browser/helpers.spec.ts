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

  it('locates the browser in the production image', () => {
    mockGlobSync.mockReturnValue(['/found/chrome-linux64/chrome']);

    expect(loadHelpers({ isProduction: true }).CHROMIUM_PATH).toBe(
      '/found/chrome-linux64/chrome',
    );
  });

  it('throws in production when no browser can be found', () => {
    expect(() => loadHelpers({ isProduction: true })).toThrow(
      /unable to locate chromium/,
    );
  });

  it('prefers an explicit CHROMIUM_PATH over the image layout', () => {
    mockGlobSync.mockReturnValue(['/found/chrome-linux64/chrome']);

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
