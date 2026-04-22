import { ICacheModule } from '../types';

interface CacheEntry<T> {
  value: T;
  expiresAt: number | null;
}

/**
 * Open source Cache Module — in-memory Map with optional TTL.
 * Process-scoped: shared across all requests, cleared on restart.
 */
export class InMemoryCacheModule implements ICacheModule {
  private store = new Map<string, CacheEntry<unknown>>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
