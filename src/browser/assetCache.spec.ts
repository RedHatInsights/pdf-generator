import { ASSET_CACHE_TTL_MS, AssetCache } from './assetCache';

const asset = () => ({
  body: Buffer.from('console.log("asset")'),
  contentType: 'application/javascript',
});

describe('AssetCache', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns what was stored', () => {
    const cache = new AssetCache(1000);
    const stored = asset();
    cache.set('a.js', stored);

    expect(cache.has('a.js')).toBe(true);
    expect(cache.get('a.js')).toBe(stored);
    expect(cache.get('missing.js')).toBeUndefined();
  });

  it('keeps an asset until its time is up', () => {
    const cache = new AssetCache(1000);
    cache.set('a.js', asset());

    jest.advanceTimersByTime(999);
    expect(cache.has('a.js')).toBe(true);

    jest.advanceTimersByTime(1);
    expect(cache.has('a.js')).toBe(false);
    expect(cache.get('a.js')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('does not extend the time when an asset is read', () => {
    const cache = new AssetCache(1000);
    cache.set('a.js', asset());

    jest.advanceTimersByTime(600);
    expect(cache.get('a.js')).toBeDefined();

    jest.advanceTimersByTime(400);
    expect(cache.get('a.js')).toBeUndefined();
  });

  it('starts the time again when an asset is cached again', () => {
    const cache = new AssetCache(1000);
    cache.set('a.js', asset());

    jest.advanceTimersByTime(1000);
    const fresh = asset();
    cache.set('a.js', fresh);

    jest.advanceTimersByTime(999);
    expect(cache.get('a.js')).toBe(fresh);
  });

  it('drops expired assets that are never read again', () => {
    const cache = new AssetCache(1000);
    cache.set('old-release.1.js', asset());
    cache.set('old-release.2.js', asset());

    jest.advanceTimersByTime(1000);
    expect(cache.size).toBe(2);

    cache.set('new-release.js', asset());
    expect(cache.size).toBe(1);
    expect(cache.has('new-release.js')).toBe(true);
  });

  it('keeps assets for five minutes by default', () => {
    const cache = new AssetCache();
    cache.set('a.js', asset());

    jest.advanceTimersByTime(ASSET_CACHE_TTL_MS - 1);
    expect(cache.has('a.js')).toBe(true);

    jest.advanceTimersByTime(1);
    expect(cache.has('a.js')).toBe(false);
  });
});
