import {
  isTransientS3Error,
  computeRetryDelay,
  ObjectStore,
} from './objectStore.impl';
import config from '../config';
import { Readable } from 'stream';

describe('objectStore config', () => {
  it('should have tls and bucket configs', () => {
    const objstore = config?.objectStore;
    expect(objstore.buckets.length).toBeGreaterThan(0);
    expect(objstore.tls).toBe(true);
    expect(objstore.buckets[0].accessKey).toBe('access');
    expect(objstore.buckets[0].secretKey).toBe('secret');
    expect(objstore.buckets[0].tls).toBe(true);
  });
});

describe('isTransientS3Error', () => {
  it('returns true for 5xx HTTP status codes', () => {
    expect(isTransientS3Error({ $metadata: { httpStatusCode: 500 } })).toBe(
      true,
    );
    expect(isTransientS3Error({ $metadata: { httpStatusCode: 503 } })).toBe(
      true,
    );
  });

  it('returns false for 4xx HTTP status codes', () => {
    expect(isTransientS3Error({ $metadata: { httpStatusCode: 403 } })).toBe(
      false,
    );
    expect(isTransientS3Error({ $metadata: { httpStatusCode: 400 } })).toBe(
      false,
    );
    expect(isTransientS3Error({ $metadata: { httpStatusCode: 404 } })).toBe(
      false,
    );
  });

  it('returns true for known transient error codes via Code property', () => {
    expect(isTransientS3Error({ Code: 'InternalError' })).toBe(true);
    expect(isTransientS3Error({ Code: 'ServiceUnavailable' })).toBe(true);
    expect(isTransientS3Error({ Code: 'SlowDown' })).toBe(true);
    expect(isTransientS3Error({ Code: 'RequestTimeout' })).toBe(true);
  });

  it('returns true for known transient error codes via name property', () => {
    expect(isTransientS3Error({ name: 'InternalError' })).toBe(true);
    expect(isTransientS3Error({ name: 'InternalFailure' })).toBe(true);
  });

  it('returns true for network-level errors', () => {
    expect(isTransientS3Error({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransientS3Error({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isTransientS3Error({ code: 'EPIPE' })).toBe(true);
    expect(isTransientS3Error({ code: 'ENOTFOUND' })).toBe(true);
  });

  it('returns false for permanent/unknown errors', () => {
    expect(isTransientS3Error({ Code: 'AccessDenied' })).toBe(false);
    expect(isTransientS3Error({ Code: 'NoSuchBucket' })).toBe(false);
    expect(isTransientS3Error({ name: 'InvalidAccessKeyId' })).toBe(false);
  });

  it('returns false for null/undefined/non-object', () => {
    expect(isTransientS3Error(null)).toBe(false);
    expect(isTransientS3Error(undefined)).toBe(false);
    expect(isTransientS3Error('string error')).toBe(false);
    expect(isTransientS3Error(42)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isTransientS3Error({})).toBe(false);
  });
});

describe('computeRetryDelay', () => {
  it('returns increasing delays for successive attempts', () => {
    // Use fixed seed approach: just verify the exponential base increases
    const baseDelay = 1000;
    const delay0 = computeRetryDelay(0, baseDelay);
    const delay1 = computeRetryDelay(1, baseDelay);
    const delay2 = computeRetryDelay(2, baseDelay);

    // Minimum delay at each attempt (without jitter) is baseDelay * 2^attempt
    expect(delay0).toBeGreaterThanOrEqual(baseDelay);
    expect(delay1).toBeGreaterThanOrEqual(baseDelay * 2);
    expect(delay2).toBeGreaterThanOrEqual(baseDelay * 4);
  });

  it('includes jitter (delay varies within expected range)', () => {
    const baseDelay = 1000;
    const attempt = 1;
    const exponentialPart = baseDelay * Math.pow(2, attempt); // 2000

    const delay = computeRetryDelay(attempt, baseDelay);
    // Jitter adds 0 to baseDelay (1000), so range is [2000, 3000)
    expect(delay).toBeGreaterThanOrEqual(exponentialPart);
    expect(delay).toBeLessThan(exponentialPart + baseDelay);
  });

  it('handles zero base delay', () => {
    const delay = computeRetryDelay(0, 0);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});

describe('ObjectStore.downloadPDF', () => {
  let objectStore: ObjectStore;
  let mockSend: jest.Mock;

  beforeEach(() => {
    objectStore = new ObjectStore();
    mockSend = jest.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (objectStore as any).s3 = { send: mockSend };
  });

  it('throws when bucket does not exist', async () => {
    mockSend.mockResolvedValueOnce(undefined);
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn<ObjectStore, any>(objectStore, 'checkBucketExists')
      .mockResolvedValue(false);

    await expect(objectStore.downloadPDF('test-id')).rejects.toThrow(
      /No such bucket/,
    );
  });

  it('rethrows S3 errors', async () => {
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn<ObjectStore, any>(objectStore, 'checkBucketExists')
      .mockResolvedValue(true);
    mockSend.mockRejectedValue(new Error('S3 GetObject failed'));

    await expect(objectStore.downloadPDF('test-id')).rejects.toThrow(
      'S3 GetObject failed',
    );
  });

  it('returns undefined when response has no Body', async () => {
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn<ObjectStore, any>(objectStore, 'checkBucketExists')
      .mockResolvedValue(true);
    mockSend.mockResolvedValue({ Body: undefined });

    const result = await objectStore.downloadPDF('test-id');
    expect(result).toBeUndefined();
  });

  it('returns Readable when response has Body', async () => {
    const mockBody = new Readable({ read() {} });
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn<ObjectStore, any>(objectStore, 'checkBucketExists')
      .mockResolvedValue(true);
    mockSend.mockResolvedValue({ Body: mockBody });

    const result = await objectStore.downloadPDF('test-id');
    expect(result).toBe(mockBody);
  });
});
