import type { Handler } from 'express';
import { createFakeUpstream } from '../__test-utils__/createFakeUpstream';
import { sendTestRequest } from '../__test-utils__/createTestApp';

jest.mock('../common/logging', () => ({
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
  formatLogError: (value: unknown) =>
    value instanceof Error ? value.message : String(value),
}));

jest.mock('../common/securityLog', () => ({
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

async function loadIdentityProxyApp(apiHost: string) {
  mockConfig.scalprum.apiHost = apiHost;

  jest.doMock('../common/config', () => ({
    __esModule: true,
    default: mockConfig,
  }));

  const express = (await import('express')).default;
  const cookieParser = (await import('cookie-parser')).default;
  const context = (await import('express-http-context')).default;
  const identityMiddleware = (await import('./identity-middleware')).default;
  const createInternalProxies = (
    await import('../server/routes/createInternalProxies')
  ).default;

  const setAuthHeaderFromContext: Handler = (req, _res, next) => {
    const authHeader = context.get(mockConfig.AUTHORIZATION_CONTEXT_KEY);
    if (authHeader) {
      req.headers[mockConfig.AUTHORIZATION_CONTEXT_KEY] = authHeader;
    }
    next();
  };

  const app = express();
  app.use(cookieParser());
  app.use(context.middleware);
  app.use(identityMiddleware);
  app.use(setAuthHeaderFromContext);
  createInternalProxies().forEach((proxy) => app.use(proxy));
  app.use((_req, res) => {
    res.status(404).send('Not Found');
  });
  return app;
}

describe('identity middleware proxy chain integration', () => {
  let upstream: ReturnType<typeof createFakeUpstream>;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(async () => {
    jest.dontMock('../common/config');
    if (upstream) {
      await upstream.stop();
    }
  });

  it('forwards Authorization from identity middleware through the proxy chain', async () => {
    upstream = createFakeUpstream();
    const port = await upstream.start();
    const app = await loadIdentityProxyApp(`http://127.0.0.1:${port}`);

    await sendTestRequest(app, 'GET', '/internal/compliance/api/foo', {
      Authorization: 'Bearer X',
    });

    const request = upstream.lastRequest();
    expect(request).toBeDefined();
    expect(request?.headers.authorization).toBe('Bearer X');
    expect(request?.headers['x-pdf-auth']).toBeUndefined();
  });
});
