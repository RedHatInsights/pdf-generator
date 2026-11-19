export type CachedAsset = { body: Buffer; contentType: string };

export const ASSET_CACHE_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Federated JS and CSS served to headless pages. Capped by total body size,
 * evicting the least recently used assets, so files from old frontend
 * releases do not stay in memory until the pod restarts.
 */
export class AssetCache {
  private readonly assets = new Map<string, CachedAsset>();
  private bytes = 0;

  constructor(private readonly maxBytes: number = ASSET_CACHE_MAX_BYTES) {}

  get size(): number {
    return this.assets.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }

  has(key: string): boolean {
    return this.assets.has(key);
  }

  get(key: string): CachedAsset | undefined {
    const asset = this.assets.get(key);
    if (asset) {
      // Re-insert to mark it most recently used (a Map keeps insertion order).
      this.assets.delete(key);
      this.assets.set(key, asset);
    }
    return asset;
  }

  set(key: string, asset: CachedAsset): void {
    this.remove(key);
    if (asset.body.length > this.maxBytes) {
      return;
    }
    this.assets.set(key, asset);
    this.bytes += asset.body.length;
    for (const oldest of this.assets.keys()) {
      if (this.bytes <= this.maxBytes) {
        break;
      }
      this.remove(oldest);
    }
  }

  private remove(key: string): void {
    const asset = this.assets.get(key);
    if (asset) {
      this.assets.delete(key);
      this.bytes -= asset.body.length;
    }
  }
}
