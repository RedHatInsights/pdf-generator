import { formatLogError, formatLogReason } from './logging';

describe('formatLogError', () => {
  it('includes stack for Error values', () => {
    const err = new Error('boom');
    const formatted = formatLogError(err);
    expect(formatted).toContain('boom');
    expect(formatted).toContain('Error: boom');
  });

  it('returns strings as-is', () => {
    expect(formatLogError('plain failure')).toBe('plain failure');
  });

  it('stringifies plain objects', () => {
    expect(formatLogError({ code: 42, msg: 'x' })).toBe(
      '{"code":42,"msg":"x"}',
    );
  });

  it('handles null and undefined', () => {
    expect(formatLogError(null)).toBe('null');
    expect(formatLogError(undefined)).toBe('undefined');
  });
});

describe('formatLogReason', () => {
  it('returns the message only for Error values (no stack)', () => {
    const err = new Error('boom');
    const formatted = formatLogReason(err);
    expect(formatted).toBe('boom');
    expect(formatted).not.toContain('\n');
    expect(formatted).not.toContain(' at ');
  });

  it('delegates to formatLogError for non-Error values', () => {
    expect(formatLogReason('plain failure')).toBe('plain failure');
    expect(formatLogReason({ code: 42 })).toBe('{"code":42}');
    expect(formatLogReason(null)).toBe('null');
    expect(formatLogReason(undefined)).toBe('undefined');
  });
});
