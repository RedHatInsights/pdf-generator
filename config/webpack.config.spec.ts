/**
 * Regression tests for the source-map exposure fixes (RHCLOUD-49239).
 *
 * These assert the webpack build configuration directly, since the primary
 * remediation for public source-map exposure lives in the build config, not in
 * runtime code:
 *   - 8ab9dfa: server no longer forces `eval-source-map` in production (which
 *     embedded inline source maps in server.js).
 *   - c9db5c6: client emits no `.map` files in production (`devtool: false`) and
 *     stale browser maps are cleaned between builds.
 *
 * webpack.config.js reads process.env.NODE_ENV at require time, so each case
 * resets the module registry and re-requires with the desired NODE_ENV.
 */

type WebpackConfig = {
  devtool?: string | false;
  plugins: Array<{
    constructor: { name: string };
    cleanOnceBeforeBuildPatterns?: string[];
  }>;
};

function loadConfig(nodeEnv: string | undefined): {
  server: WebpackConfig;
  client: WebpackConfig;
} {
  const original = process.env.NODE_ENV;
  jest.resetModules();
  if (nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = nodeEnv;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const [server, client] = require('./webpack.config') as WebpackConfig[];
    return { server, client };
  } finally {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  }
}

function cleanPatterns(config: WebpackConfig): string[] | undefined {
  return config.plugins.find(
    (p) => p.constructor.name === 'CleanWebpackPlugin',
  )?.cleanOnceBeforeBuildPatterns;
}

describe('webpack source-map exposure (RHCLOUD-49239)', () => {
  describe('production build', () => {
    it('does not embed eval-source-map in the server bundle', () => {
      const { server } = loadConfig('production');
      // eval-source-map inlines full sources into server.js. Must never ship.
      expect(server.devtool).not.toBe('eval-source-map');
      expect(server.devtool).toBe('hidden-source-map');
    });

    it('emits no browser source maps for the client bundle', () => {
      const { client } = loadConfig('production');
      // devtool:false => no *.js.map under /public, so no guessable map URLs.
      expect(client.devtool).toBe(false);
    });

    it('cleans stale browser source maps between builds', () => {
      const { server } = loadConfig('production');
      // public/** is preserved, but leftover *.map under public must be dropped.
      expect(cleanPatterns(server)).toEqual(
        expect.arrayContaining(['public/**/*.map']),
      );
    });
  });

  describe('development build', () => {
    it('keeps eval-source-map for the server bundle', () => {
      const { server } = loadConfig('development');
      expect(server.devtool).toBe('eval-source-map');
    });

    it('keeps source maps for the client bundle', () => {
      const { client } = loadConfig('development');
      expect(client.devtool).toBe('source-map');
    });
  });
});
