import type { ClientRequest } from 'http';

const mockCreateProxyMiddleware = jest.fn((...args: unknown[]) => args);

jest.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: mockCreateProxyMiddleware,
}));

jest.mock('../../common/logging', () => ({
  hpmLogger: {},
}));

jest.mock('https-proxy-agent', () => ({
  HttpsProxyAgent: jest.fn(),
}));

jest.mock('../../common/integrationEndpoints', () => ({
  rewriteInternalProxiedPath: jest.fn(),
}));

const baseConfig = {
  AUTHORIZATION_CONTEXT_KEY: 'x-pdf-auth',
  AUTHORIZATION_HEADER_KEY: 'Authorization',
  scalprum: { apiHost: '', proxyAgent: '' },
  endpoints: {} as Record<string, unknown>,
};

jest.mock('../../common/config', () => baseConfig);

type ProxyOptions = {
  target?: string;
  changeOrigin?: boolean;
  pathFilter?: (path: string) => boolean;
  pathRewrite?: (path: string) => string;
  on?: { proxyReq?: (req: ClientRequest) => void };
};

function getProxyOptions(callIndex = 0): ProxyOptions {
  return mockCreateProxyMiddleware.mock.calls[callIndex][0] as ProxyOptions;
}

function extractProxyReqHandler(callIndex = 0) {
  const handler = getProxyOptions(callIndex).on?.proxyReq;
  if (!handler) {
    throw new Error(
      `No on.proxyReq handler found on createProxyMiddleware call ${callIndex}`,
    );
  }
  return handler;
}

function makeMockReq(overrides: Partial<ClientRequest> = {}) {
  return {
    headersSent: false,
    getHeader: jest.fn(),
    setHeader: jest.fn(),
    removeHeader: jest.fn(),
    ...overrides,
  } as unknown as ClientRequest & {
    getHeader: jest.Mock;
    setHeader: jest.Mock;
    removeHeader: jest.Mock;
  };
}

function loadWithConfig(
  apiHost: string,
  endpoints: Record<string, unknown> = {},
) {
  baseConfig.scalprum.apiHost = apiHost;
  baseConfig.endpoints = endpoints;
  mockCreateProxyMiddleware.mockClear();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('./createInternalProxies');
  return (mod.default ?? mod) as () => unknown[];
}

const ADVISOR_ENDPOINT = {
  hostname: 'advisor-backend.svc',
  port: 8000,
  tlsPort: 0,
};

const COMPLIANCE_ENDPOINT = {
  hostname: 'compliance.svc',
  port: 8000,
  tlsPort: 0,
};

beforeEach(() => {
  mockCreateProxyMiddleware.mockClear();
  baseConfig.scalprum.apiHost = '';
  baseConfig.scalprum.proxyAgent = '';
  baseConfig.endpoints = {};
});

describe('createInternalProxies', () => {
  describe('dev path (API_HOST set)', () => {
    it('creates a single proxy targeting API_HOST', () => {
      const createInternalProxies = loadWithConfig(
        'https://console.stage.redhat.com',
      );

      const proxies = createInternalProxies();

      expect(proxies).toHaveLength(1);
      expect(getProxyOptions()).toMatchObject({
        target: 'https://console.stage.redhat.com',
        changeOrigin: true,
      });
    });

    it('forwards x-pdf-auth as Authorization header', () => {
      const createInternalProxies = loadWithConfig(
        'https://console.stage.redhat.com',
      );
      createInternalProxies();
      const handler = extractProxyReqHandler();
      const req = makeMockReq();
      req.getHeader.mockReturnValue('Bearer dev-token');

      handler(req);

      expect(req.getHeader).toHaveBeenCalledWith('x-pdf-auth');
      expect(req.setHeader).toHaveBeenCalledWith(
        'Authorization',
        'Bearer dev-token',
      );
      expect(req.removeHeader).toHaveBeenCalledWith('x-pdf-auth');
    });
  });

  describe('Clowder path (no API_HOST)', () => {
    it('creates a proxy per endpoint', () => {
      const createInternalProxies = loadWithConfig('', {
        'advisor-backend': ADVISOR_ENDPOINT,
        compliance: COMPLIANCE_ENDPOINT,
      });

      const proxies = createInternalProxies();

      expect(proxies).toHaveLength(2);
      expect(getProxyOptions(0)).toMatchObject({
        target: 'http://advisor-backend.svc:8000',
      });
      expect(getProxyOptions(1)).toMatchObject({
        target: 'http://compliance.svc:8000',
      });
    });

    it('forwards x-pdf-auth as Authorization header', () => {
      const createInternalProxies = loadWithConfig('', {
        'advisor-backend': ADVISOR_ENDPOINT,
      });
      createInternalProxies();
      const handler = extractProxyReqHandler();
      const req = makeMockReq();
      req.getHeader.mockReturnValue('Bearer clowder-token');

      handler(req);

      expect(req.getHeader).toHaveBeenCalledWith('x-pdf-auth');
      expect(req.setHeader).toHaveBeenCalledWith(
        'Authorization',
        'Bearer clowder-token',
      );
      expect(req.removeHeader).toHaveBeenCalledWith('x-pdf-auth');
    });

    it('removes x-pdf-auth even when no auth header present', () => {
      const createInternalProxies = loadWithConfig('', {
        'advisor-backend': ADVISOR_ENDPOINT,
      });
      createInternalProxies();
      const handler = extractProxyReqHandler();
      const req = makeMockReq();
      req.getHeader.mockReturnValue(undefined);

      handler(req);

      expect(req.setHeader).not.toHaveBeenCalled();
      expect(req.removeHeader).toHaveBeenCalledWith('x-pdf-auth');
    });

    it('skips header manipulation when headersSent is true', () => {
      const createInternalProxies = loadWithConfig('', {
        'advisor-backend': ADVISOR_ENDPOINT,
      });
      createInternalProxies();
      const handler = extractProxyReqHandler();
      const req = makeMockReq({ headersSent: true });

      handler(req);

      expect(req.getHeader).not.toHaveBeenCalled();
      expect(req.setHeader).not.toHaveBeenCalled();
      expect(req.removeHeader).not.toHaveBeenCalled();
    });
  });

  describe('auth parity between dev and Clowder paths', () => {
    it('both paths have an on.proxyReq handler', () => {
      const createDev = loadWithConfig('https://console.stage.redhat.com');
      createDev();
      const devOptions = getProxyOptions();

      const createClowder = loadWithConfig('', {
        'advisor-backend': ADVISOR_ENDPOINT,
      });
      createClowder();
      const clowderOptions = getProxyOptions();

      expect(devOptions.on?.proxyReq).toBeDefined();
      expect(clowderOptions.on?.proxyReq).toBeDefined();
    });

    it('both paths produce identical auth header behavior', () => {
      const createDev = loadWithConfig('https://console.stage.redhat.com');
      createDev();
      const devHandler = extractProxyReqHandler();

      const createClowder = loadWithConfig('', {
        'advisor-backend': ADVISOR_ENDPOINT,
      });
      createClowder();
      const clowderHandler = extractProxyReqHandler();

      const devReq = makeMockReq();
      devReq.getHeader.mockReturnValue('Bearer same-token');
      devHandler(devReq);

      const clowderReq = makeMockReq();
      clowderReq.getHeader.mockReturnValue('Bearer same-token');
      clowderHandler(clowderReq);

      expect(devReq.setHeader.mock.calls).toEqual(
        clowderReq.setHeader.mock.calls,
      );
      expect(devReq.removeHeader.mock.calls).toEqual(
        clowderReq.removeHeader.mock.calls,
      );
    });
  });
});
