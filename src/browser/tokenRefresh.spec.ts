import { isTokenExpiringSoon, refreshAccessToken } from './tokenRefresh';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

jest.mock('../common/config', () => ({
  __esModule: true,
  default: {
    SSO_URL: 'https://sso.example.com/auth/',
    SSO_CLIENT_ID: 'cloud-services',
  },
}));

jest.mock('../common/logging', () => ({
  apiLogger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

describe('isTokenExpiringSoon', () => {
  it('returns true when token expires within 60 seconds', () => {
    const exp = Math.floor(Date.now() / 1000) + 30;
    expect(isTokenExpiringSoon(makeJwt({ exp }))).toBe(true);
  });

  it('returns true when token is already expired', () => {
    const exp = Math.floor(Date.now() / 1000) - 100;
    expect(isTokenExpiringSoon(makeJwt({ exp }))).toBe(true);
  });

  it('returns false when token has plenty of time left', () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    expect(isTokenExpiringSoon(makeJwt({ exp }))).toBe(false);
  });

  it('returns false for malformed token', () => {
    expect(isTokenExpiringSoon('not-a-jwt')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTokenExpiringSoon('')).toBe(false);
  });

  it('returns false when payload has no exp claim', () => {
    expect(isTokenExpiringSoon(makeJwt({ sub: 'user' }))).toBe(false);
  });
});

describe('refreshAccessToken', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns new access token on successful refresh', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-token-123' }),
    });

    const result = await refreshAccessToken('old-refresh-token');

    expect(result).toEqual({ accessToken: 'Bearer new-token-123' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://sso.example.com/auth/realms/redhat-external/protocol/openid-connect/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
  });

  it('strips Bearer prefix from refresh token', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-token' }),
    });

    await refreshAccessToken('Bearer my-refresh-token');

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = call[1].body;
    expect(body).toContain('refresh_token=my-refresh-token');
    expect(body).not.toContain('Bearer');
  });

  it('sends correct client_id and grant_type', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'tok' }),
    });

    await refreshAccessToken('rt');

    const call = (global.fetch as jest.Mock).mock.calls[0];
    const body = call[1].body;
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('client_id=cloud-services');
  });

  it('returns null when SSO returns an error', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });

    const result = await refreshAccessToken('bad-refresh-token');
    expect(result).toBeNull();
  });

  it('returns null on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await refreshAccessToken('some-token');
    expect(result).toBeNull();
  });

  it('returns null when SSO_URL is not configured', async () => {
    const mockFetch = jest.fn();
    global.fetch = mockFetch;

    const configModule = jest.requireMock('../common/config');
    const origUrl = configModule.default.SSO_URL;
    configModule.default.SSO_URL = '';

    const result = await refreshAccessToken('some-token');
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();

    configModule.default.SSO_URL = origUrl;
  });
});
