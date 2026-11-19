import { AssetCache } from './assetCache';

const asset = (bytes: number) => ({
  body: Buffer.alloc(bytes),
  contentType: 'application/javascript',
});

describe('AssetCache', () => {
  it('returns what was stored', () => {
    const cache = new AssetCache(100);
    const stored = asset(10);
    cache.set('a.js', stored);

    expect(cache.has('a.js')).toBe(true);
    expect(cache.get('a.js')).toBe(stored);
    expect(cache.get('missing.js')).toBeUndefined();
  });

  it('evicts the oldest assets once over the size limit', () => {
    const cache = new AssetCache(100);
    cache.set('a.js', asset(40));
    cache.set('b.js', asset(40));
    cache.set('c.js', asset(40));

    expect(cache.has('a.js')).toBe(false);
    expect(cache.has('b.js')).toBe(true);
    expect(cache.has('c.js')).toBe(true);
    expect(cache.totalBytes).toBe(80);
  });

  it('keeps an asset that was read recently', () => {
    const cache = new AssetCache(100);
    cache.set('a.js', asset(40));
    cache.set('b.js', asset(40));
    cache.get('a.js');
    cache.set('c.js', asset(40));

    expect(cache.has('a.js')).toBe(true);
    expect(cache.has('b.js')).toBe(false);
    expect(cache.has('c.js')).toBe(true);
  });

  it('evicts as many assets as a large one needs', () => {
    const cache = new AssetCache(100);
    cache.set('a.js', asset(30));
    cache.set('b.js', asset(30));
    cache.set('c.js', asset(30));
    cache.set('big.js', asset(90));

    expect(cache.size).toBe(1);
    expect(cache.has('big.js')).toBe(true);
    expect(cache.totalBytes).toBe(90);
  });

  it('does not cache an asset larger than the limit', () => {
    const cache = new AssetCache(100);
    cache.set('a.js', asset(40));
    cache.set('huge.js', asset(101));

    expect(cache.has('huge.js')).toBe(false);
    expect(cache.has('a.js')).toBe(true);
    expect(cache.totalBytes).toBe(40);
  });

  it('replaces an asset stored twice without counting it twice', () => {
    const cache = new AssetCache(100);
    cache.set('a.js', asset(40));
    cache.set('a.js', asset(60));

    expect(cache.size).toBe(1);
    expect(cache.totalBytes).toBe(60);
  });

  it('stays within the limit however many assets it is given', () => {
    const cache = new AssetCache(1000);
    for (let i = 0; i < 500; i++) {
      cache.set(`chunk.${i}.js`, asset(64));
    }

    expect(cache.totalBytes).toBeLessThanOrEqual(1000);
    expect(cache.size).toBe(15);
    expect(cache.has('chunk.499.js')).toBe(true);
    expect(cache.has('chunk.0.js')).toBe(false);
  });
});
