import { getDevMockToken } from './devMockToken';

describe('getDevMockToken', () => {
  const originalMockToken = process.env.MOCK_TOKEN;

  afterEach(() => {
    if (originalMockToken === undefined) {
      delete process.env.MOCK_TOKEN;
    } else {
      process.env.MOCK_TOKEN = originalMockToken;
    }
  });

  it('returns undefined in production even when MOCK_TOKEN is set', () => {
    expect(getDevMockToken(true, 'Bearer secret')).toBeUndefined();
  });

  it('returns MOCK_TOKEN outside production', () => {
    expect(getDevMockToken(false, 'Bearer secret')).toBe('Bearer secret');
  });

  it('returns undefined outside production when MOCK_TOKEN is unset', () => {
    expect(getDevMockToken(false, undefined)).toBeUndefined();
  });

  it('reads process.env.MOCK_TOKEN by default', () => {
    process.env.MOCK_TOKEN = 'Bearer from-env';
    expect(getDevMockToken(false)).toBe('Bearer from-env');
    expect(getDevMockToken(true)).toBeUndefined();
  });
});
