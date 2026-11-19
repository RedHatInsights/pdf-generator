export type CachedAsset = { body: Buffer; contentType: string };

export const ASSET_CACHE_TTL_MS = 300_000;

/**
 * Federated JS and CSS served to headless pages, kept for a fixed time. A new
 * frontend release is picked up once the old files expire, and files that are
 * no longer requested do not stay in memory.
 */
export class AssetCache {
  private readonly assets = new Map<
    string,
    { asset: CachedAsset; expiresAt: number }
  >();

  constructor(private readonly ttlMs: number = ASSET_CACHE_TTL_MS) {}

  get size(): number {
    return this.assets.size;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  get(key: string): CachedAsset | undefined {
    const entry = this.assets.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.assets.delete(key);
      return undefined;
    }
    return entry.asset;
  }

  set(key: string, asset: CachedAsset): void {
    const now = Date.now();
    // An expired asset that is never requested again is only removed here.
    for (const [cachedKey, entry] of this.assets) {
      if (entry.expiresAt <= now) {
        this.assets.delete(cachedKey);
      }
    }
    this.assets.set(key, { asset, expiresAt: now + this.ttlMs });
  }
}
