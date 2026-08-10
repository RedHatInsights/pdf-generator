import { refreshAccessToken, TokenManager } from './tokenRefresh';

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
    warn: jest.fn(),
  },
}));

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

  it('returns permanent error on 400 (invalid_grant)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });

    const result = await refreshAccessToken('bad-refresh-token');
    expect(result).toEqual({ error: 'permanent' });
  });

  it('returns transient error on 503', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    });

    const result = await refreshAccessToken('some-token');
    expect(result).toEqual({ error: 'transient' });
  });

  it('returns transient error on network failure', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await refreshAccessToken('some-token');
    expect(result).toEqual({ error: 'transient' });
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

describe('TokenManager', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns current token when not expiring', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = `Bearer ${makeJwt({ exp })}`;
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe(token);
  });

  it('refreshes when token is expiring', async () => {
    const exp = Math.floor(Date.now() / 1000) + 10;
    const token = `Bearer ${makeJwt({ exp })}`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'new-token' }),
    });
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe('Bearer new-token');
    expect(tm.currentToken).toBe('Bearer new-token');
  });

  it('coalesces concurrent getValidToken calls into single refresh', async () => {
    const exp = Math.floor(Date.now() / 1000) + 10;
    const token = `Bearer ${makeJwt({ exp })}`;
    let fetchCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      fetchCount++;
      await new Promise((r) => setTimeout(r, 10));
      return {
        ok: true,
        json: () => Promise.resolve({ access_token: 'coalesced-token' }),
      };
    });
    const tm = new TokenManager(token, 'refresh-token');

    const [r1, r2, r3] = await Promise.all([
      tm.getValidToken(),
      tm.getValidToken(),
      tm.getValidToken(),
    ]);

    expect(fetchCount).toBe(1);
    expect(r1).toBe('Bearer coalesced-token');
    expect(r2).toBe('Bearer coalesced-token');
    expect(r3).toBe('Bearer coalesced-token');
  });

  it('returns undefined when refresh fails permanently', async () => {
    const exp = Math.floor(Date.now() / 1000) + 10;
    const token = `Bearer ${makeJwt({ exp })}`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBeUndefined();
  });

  it('returns expiring token and warns on transient failure (503)', async () => {
    const { apiLogger } = jest.requireMock('../common/logging');
    const exp = Math.floor(Date.now() / 1000) + 10;
    const token = `Bearer ${makeJwt({ exp })}`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('service unavailable'),
    });
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe(token);
    expect(apiLogger.warn).toHaveBeenCalledWith(
      '[token-refresh] Transient failure, proceeding with expiring token',
    );
  });

  it('returns token as-is when no refresh token', async () => {
    const tm = new TokenManager('Bearer some-token', undefined);

    const result = await tm.getValidToken();
    expect(result).toBe('Bearer some-token');
  });

  it('returns undefined when no auth at all', async () => {
    const tm = new TokenManager(undefined, undefined);

    const result = await tm.getValidToken();
    expect(result).toBeUndefined();
  });

  it('stops retrying after permanent failure (400)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 10;
    const token = `Bearer ${makeJwt({ exp })}`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });
    const tm = new TokenManager(token, 'refresh-token');

    await tm.getValidToken();
    await tm.getValidToken();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(tm.currentToken).toBe(token);
  });

  it('parses token expiry once at construction', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = `Bearer ${makeJwt({ exp })}`;
    global.fetch = jest.fn();
    const tm = new TokenManager(token, 'refresh-token');

    // Multiple checks should not re-parse
    await tm.getValidToken();
    await tm.getValidToken();
    await tm.getValidToken();

    // Should never need refresh because token is not expiring
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('updates cached expiry after token refresh', async () => {
    const oldExp = Math.floor(Date.now() / 1000) + 10;
    const oldToken = `Bearer ${makeJwt({ exp: oldExp })}`;
    const newExp = Math.floor(Date.now() / 1000) + 600;
    const newToken = makeJwt({ exp: newExp });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: newToken }),
    });

    const tm = new TokenManager(oldToken, 'refresh-token');
    const firstCall = await tm.getValidToken();

    // After refresh, should not need another refresh
    const secondCall = await tm.getValidToken();

    // Should only fetch once (during first call)
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(firstCall).toContain(newToken);
    expect(secondCall).toContain(newToken);
  });

  it('handles malformed tokens gracefully', async () => {
    const tm = new TokenManager('Bearer malformed', 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe('Bearer malformed');
  });

  it('refreshes an already-expired token', async () => {
    const exp = Math.floor(Date.now() / 1000) - 100;
    const token = `Bearer ${makeJwt({ exp })}`;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'fresh-token' }),
    });
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe('Bearer fresh-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not refresh token without exp claim', async () => {
    const token = `Bearer ${makeJwt({ sub: 'user', iss: 'test' })}`;
    global.fetch = jest.fn();
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe(token);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not refresh token with non-numeric exp claim', async () => {
    const token = `Bearer ${makeJwt({ exp: 'not-a-number' })}`;
    global.fetch = jest.fn();
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe(token);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not refresh token with null exp claim', async () => {
    const token = `Bearer ${makeJwt({ exp: null })}`;
    global.fetch = jest.fn();
    const tm = new TokenManager(token, 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe(token);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('treats empty auth header as no-auth (skips refresh)', async () => {
    global.fetch = jest.fn();
    const tm = new TokenManager('', 'refresh-token');

    const result = await tm.getValidToken();
    expect(result).toBe('');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
