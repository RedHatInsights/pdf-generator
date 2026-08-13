import { validatePayload } from './utils';

const valid = {
  manifestLocation: 'https://console.redhat.com/apps/foo/fed-mods.json',
  module: './App',
  scope: 'fooApp',
};

describe('validatePayload', () => {
  it('returns null for valid payload', () => {
    expect(validatePayload(valid)).toBeNull();
  });

  describe('manifestLocation', () => {
    it('accepts relative JSON paths', () => {
      expect(
        validatePayload({
          ...valid,
          manifestLocation: '/apps/foo/fed-mods.json',
        }),
      ).toBeNull();
    });

    it('accepts stage console origin', () => {
      expect(
        validatePayload({
          ...valid,
          manifestLocation:
            'https://console.stage.redhat.com/apps/foo/fed-mods.json',
        }),
      ).toBeNull();
    });

    it('rejects disallowed https origins', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: 'https://attacker.com/evil.json',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects subdomain attacks on allowed origins', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: 'https://evil.console.redhat.com/foo.json',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects http:// URLs', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: 'http://example.com/fed-mods.json',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects javascript: URIs', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: 'javascript:alert(1)',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects data: URIs', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: 'data:text/html,<h1>x</h1>',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects empty string', () => {
      const err = validatePayload({ ...valid, manifestLocation: '' });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects non-.json relative path', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: '/apps/foo/notjson',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects protocol-relative URLs', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: '//attacker.com/evil.json',
      });
      expect(err?.field).toBe('manifestLocation');
    });

    it('rejects backslash after leading slash', () => {
      const err = validatePayload({
        ...valid,
        manifestLocation: '/\\attacker.com/evil.json',
      });
      expect(err?.field).toBe('manifestLocation');
    });
  });

  describe('module', () => {
    it('accepts ./SubPath/Module', () => {
      expect(
        validatePayload({ ...valid, module: './SubPath/Module' }),
      ).toBeNull();
    });

    it('rejects bare name without ./', () => {
      const err = validatePayload({ ...valid, module: 'App' });
      expect(err?.field).toBe('module');
    });

    it('rejects path traversal', () => {
      const err = validatePayload({ ...valid, module: '../../../etc/passwd' });
      expect(err?.field).toBe('module');
    });

    it('rejects path traversal with ./ prefix', () => {
      const err = validatePayload({ ...valid, module: './../../etc/passwd' });
      expect(err?.field).toBe('module');
    });

    it('rejects empty string', () => {
      const err = validatePayload({ ...valid, module: '' });
      expect(err?.field).toBe('module');
    });
  });

  describe('scope', () => {
    it('accepts scoped package names', () => {
      expect(validatePayload({ ...valid, scope: '@org/scope' })).toBeNull();
    });

    it('rejects strings with spaces', () => {
      const err = validatePayload({ ...valid, scope: 'bad scope' });
      expect(err?.field).toBe('scope');
    });

    it('rejects empty string', () => {
      const err = validatePayload({ ...valid, scope: '' });
      expect(err?.field).toBe('scope');
    });
  });
});

describe('validatePayload rejects malformed payloads', () => {
  it('rejects null', () => {
    const err = validatePayload(null);
    expect(err?.field).toBe('payload');
  });

  it('rejects undefined', () => {
    const err = validatePayload(undefined);
    expect(err?.field).toBe('payload');
  });

  it('rejects a scalar', () => {
    const err = validatePayload(42);
    expect(err?.field).toBe('payload');
  });

  it('rejects non-string manifestLocation', () => {
    const err = validatePayload({
      manifestLocation: 123,
      module: './App',
      scope: 'x',
    });
    expect(err?.field).toBe('manifestLocation');
  });
});

describe('validatePayload covers /preview inputs', () => {
  it('rejects attacker manifestLocation', () => {
    const err = validatePayload({
      manifestLocation: 'https://attacker.com/evil.json',
      module: './App',
      scope: 'fooApp',
    });
    expect(err?.field).toBe('manifestLocation');
  });
});
