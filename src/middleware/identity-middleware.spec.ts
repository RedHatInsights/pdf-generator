import express from 'express';
import cookieParser from 'cookie-parser';
import httpContext from 'express-http-context';
import identityMiddleware from './identity-middleware';
import { sendTestRequest } from '../__test-utils__/createTestApp';
import { logAuthFailure } from '../common/securityLog';
import { apiLogger } from '../common/logging';
import config from '../common/config';

jest.mock('../common/securityLog', () => ({
  logAuthFailure: jest.fn(),
}));

jest.mock('../common/logging', () => ({
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

const mockedLogAuthFailure = logAuthFailure as jest.MockedFunction<
  typeof logAuthFailure
>;
const mockedApiLogger = apiLogger as jest.Mocked<typeof apiLogger>;

function createIdentityTestApp() {
  const app = express();
  app.use(cookieParser());
  app.use(httpContext.middleware);
  app.use(identityMiddleware);
  app.get('/test', (_req, res) => {
    res.json({
      auth: httpContext.get(config.AUTHORIZATION_CONTEXT_KEY),
      identity: httpContext.get(config.IDENTITY_CONTEXT_KEY),
      refreshToken: httpContext.get(config.REFRESH_TOKEN_CONTEXT_KEY),
      accountId: httpContext.get(config.ACCOUNT_ID),
      rhIdentity: httpContext.get(config.IDENTITY_HEADER_KEY),
      jwtCookie: httpContext.get(config.JWT_COOKIE_NAME),
    });
  });
  return app;
}

function encodeIdentity(identity: object): string {
  return Buffer.from(JSON.stringify(identity)).toString('base64');
}

describe('identityMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores Authorization header in httpContext', async () => {
    const app = createIdentityTestApp();

    const response = await sendTestRequest(app, 'GET', '/test', {
      Authorization: 'Bearer test-token',
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.auth).toBe('Bearer test-token');
  });

  it('decodes x-rh-identity and stores identity in httpContext', async () => {
    const app = createIdentityTestApp();
    const identity = {
      identity: {
        user: { user_id: 'user-123' },
        org_id: 'org-456',
      },
    };
    const encoded = encodeIdentity(identity);

    const response = await sendTestRequest(app, 'GET', '/test', {
      'x-rh-identity': encoded,
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.identity).toEqual(identity);
    expect(body.rhIdentity).toBe(encoded);
    expect(body.accountId).toBe('user-123');
  });

  it('stores refresh token header in httpContext', async () => {
    const app = createIdentityTestApp();

    const response = await sendTestRequest(app, 'GET', '/test', {
      'x-rh-refresh-token': 'refresh-token-value',
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.refreshToken).toBe('refresh-token-value');
  });

  it('logs a warning and continues when x-rh-identity is missing', async () => {
    const app = createIdentityTestApp();

    const response = await sendTestRequest(app, 'GET', '/test', {
      Authorization: 'Bearer only-auth',
    });

    expect(response.status).toBe(200);
    expect(mockedLogAuthFailure).toHaveBeenCalledWith(
      'Missing x-rh-identity header',
      '/test',
    );
    const body = JSON.parse(response.body);
    expect(body.identity).toBeUndefined();
    expect(body.auth).toBe('Bearer only-auth');
  });

  it('stores JWT cookie in httpContext', async () => {
    const app = createIdentityTestApp();

    const response = await sendTestRequest(app, 'GET', '/test', {
      Cookie: `${config.JWT_COOKIE_NAME}=jwt-token-value`,
    });

    expect(response.status).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.jwtCookie).toBe('jwt-token-value');
  });

  it('logs and continues when x-rh-identity is malformed base64', async () => {
    const app = createIdentityTestApp();

    const response = await sendTestRequest(app, 'GET', '/test', {
      'x-rh-identity': 'not-valid-base64-json!!!',
    });

    expect(response.status).toBe(200);
    expect(mockedApiLogger.error).toHaveBeenCalled();
    expect(mockedLogAuthFailure).toHaveBeenCalledWith(
      'Failed to decode identity header',
      '/test',
    );
  });
});
