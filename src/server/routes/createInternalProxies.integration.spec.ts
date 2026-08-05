import { createFakeUpstream } from '../../__test-utils__/createFakeUpstream';
import {
  createTestApp,
  sendTestRequest,
} from '../../__test-utils__/createTestApp';

jest.mock('http-proxy-middleware', () =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  jest.requireActual('../../__test-utils__/httpProxyMiddlewareCompat'),
);

jest.mock('../../common/logging', () => ({
  hpmLogger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
  },
  apiLogger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    warning: jest.fn(),
  },
}));

jest.mock('../../common/securityLog', () => ({
  logAuthFailure: jest.fn(),
}));

const mockConfig = {
  scalprum: {
    apiHost: '',
    proxyAgent: undefined,
  },
  AUTHORIZATION_CONTEXT_KEY: 'x-pdf-auth',
  AUTHORIZATION_HEADER_KEY: 'Authorization',
  IDENTITY_CONTEXT_KEY: 'identity',
  IDENTITY_HEADER_KEY: 'x-rh-identity',
  REFRESH_TOKEN_HEADER_KEY: 'x-rh-refresh-token',
  REFRESH_TOKEN_CONTEXT_KEY: 'x-pdf-refresh-token',
  JWT_COOKIE_NAME: 'cs_jwt',
  ACCOUNT_ID: 'account_id',
  endpoints: {},
  IS_PRODUCTION: false,
};

async function loadProxiedApp(apiHost: string) {
  jest.resetModules();
  mockConfig.scalprum.apiHost = apiHost;

  jest.doMock('../../common/config', () => ({
    __esModule: true,
    default: mockConfig,
  }));

  const createInternalProxies = (
    await import('../routes/createInternalProxies')
  ).default;
  const proxies = createInternalProxies();
  return createTestApp(...proxies);
}

describe('createInternalProxies integration', () => {
  let upstream: ReturnType<typeof createFakeUpstream>;

  afterEach(async () => {
    jest.resetModules();
    jest.dontMock('../../common/config');
    if (upstream) {
      await upstream.stop();
    }
  });

  it('forwards x-pdf-auth to Authorization and strips x-pdf-auth', async () => {
    upstream = createFakeUpstream();
    const port = await upstream.start();
    const app = await loadProxiedApp(`http://127.0.0.1:${port}`);

    await sendTestRequest(app, 'GET', '/internal/compliance/api/foo', {
      'x-pdf-auth': 'Bearer token123',
    });

    const request = upstream.lastRequest();
    expect(request).toBeDefined();
    expect(request?.headers.authorization).toBe('Bearer token123');
    expect(request?.headers['x-pdf-auth']).toBeUndefined();
  });

  it('does not set Authorization when x-pdf-auth is absent', async () => {
    upstream = createFakeUpstream();
    const port = await upstream.start();
    const app = await loadProxiedApp(`http://127.0.0.1:${port}`);

    await sendTestRequest(app, 'GET', '/internal/compliance/api/foo');

    const request = upstream.lastRequest();
    expect(request).toBeDefined();
    expect(request?.headers.authorization).toBeUndefined();
    expect(request?.headers['x-pdf-auth']).toBeUndefined();
  });

  it('matches /internal/* and rewrites the service prefix for dev API_HOST', async () => {
    upstream = createFakeUpstream();
    const port = await upstream.start();
    const app = await loadProxiedApp(`http://127.0.0.1:${port}`);

    await sendTestRequest(app, 'GET', '/internal/compliance/api/v1/reports');

    const request = upstream.lastRequest();
    expect(request).toBeDefined();
    expect(request?.url).toBe('/api/v1/reports');
  });
});
