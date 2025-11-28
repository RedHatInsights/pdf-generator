import config from '../config';

describe('stage config', () => {
  it('should have tls and bucket configs', () => {
    const objstore = config?.objectStore;
    expect(objstore.buckets.length).toBeGreaterThan(0);
    expect(objstore.tls).toBe(true);
    expect(objstore.buckets[0].accessKey).toBe('access');
    expect(objstore.buckets[0].secretKey).toBe('secret');
    expect(objstore.buckets[0].tls).toBe(true);
  });
});
