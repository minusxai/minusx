import { ApiEndpoint, CacheStrategy } from './declarations';

// In-memory cache for responses
type CacheEntry<T> = {
  data: T;
  timestamp: number;
  expiresAt: number;
  promise?: Promise<T>;  // For deduplication
};

const cache = new Map<string, CacheEntry<any>>();

// In-flight requests map for deduplication
const inFlightRequests = new Map<string, Promise<any>>();

// AbortController map for request cancellation
const abortControllers = new Map<string, AbortController>();

/**
 * Generate cache key from URL and request body
 */
function getCacheKey(url: string, options?: RequestInit): string {
  const body = options?.body ? JSON.stringify(options.body) : '';
  return `${options?.method || 'GET'}:${url}:${body}`;
}

/**
 * Check if cached data is still valid
 */
function isCacheValid<T>(entry: CacheEntry<T>, strategy?: CacheStrategy): boolean {
  if (!strategy) return false;

  const now = Date.now();

  // Fresh data
  if (now < entry.expiresAt) return true;

  // Stale but within stale-while-revalidate window
  if (strategy.staleWhileRevalidate) {
    const staleUntil = entry.expiresAt + strategy.staleWhileRevalidate;
    return now < staleUntil;
  }

  return false;
}

/**
 * Extended options for fetchWithCache
 */
export type FetchWithCacheOptions = RequestInit & {
  cacheStrategy?: CacheStrategy;
  skipCache?: boolean;
  responseType?: 'json' | 'blob';  // Support for file downloads
  isFormData?: boolean;  // Support for file uploads
};

/**
 * Wrapped fetch with deduplication and caching
 */
export async function fetchWithCache<TOutput = any>(
  url: string,
  options?: FetchWithCacheOptions
): Promise<TOutput> {
  const cacheStrategy = options?.cacheStrategy;
  const cacheKey = getCacheKey(url, options);

  // Skip cache if requested
  if (options?.skipCache) {
    return performFetch(url, options, cacheKey);
  }

  // Check cache first
  if (cacheStrategy && cacheStrategy.ttl > 0) {
    const cached = cache.get(cacheKey);
    if (cached && isCacheValid(cached, cacheStrategy)) {
      console.log(`[fetchWithCache] Cache HIT: ${url}`);
      return cached.data;
    }
  }

  // Deduplication: Check if request is already in-flight
  if (cacheStrategy?.deduplicate) {
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) {
      console.log(`[fetchWithCache] Deduplicating: ${url}`);
      return inFlight;
    }
  }

  // Perform fetch
  const promise = performFetch<TOutput>(url, options, cacheKey);

  // Store in-flight promise for deduplication
  if (cacheStrategy?.deduplicate) {
    inFlightRequests.set(cacheKey, promise);
    promise.finally(() => inFlightRequests.delete(cacheKey));
  }

  return promise;
}

/**
 * Actual fetch execution
 */
async function performFetch<TOutput>(
  url: string,
  options?: FetchWithCacheOptions,
  cacheKey?: string
): Promise<TOutput> {
  const cacheStrategy = options?.cacheStrategy;

  // Create AbortController for this request
  const controller = new AbortController();
  if (cacheKey) {
    // Cancel any previous request with same key
    const prevController = abortControllers.get(cacheKey);
    if (prevController) {
      prevController.abort();
    }
    abortControllers.set(cacheKey, controller);
  }

  try {
    // Prepare headers - skip Content-Type for FormData (browser sets it with boundary)
    const headers: HeadersInit = options?.isFormData
      ? { ...options?.headers }
      : {
          'Content-Type': 'application/json',
          ...options?.headers,
        };

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    });

    if (!response.ok) {
      // Try to extract error message from response body
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.json();
        // Check for standard API error format
        if (errorData.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        }
      } catch {
        // If JSON parsing fails, fall back to status text
      }
      throw new Error(errorMessage);
    }

    // Parse response based on type
    const data: TOutput = options?.responseType === 'blob'
      ? (await response.blob() as any)
      : await response.json();

    // Store in cache (skip for blob responses as they're typically large files)
    if (cacheStrategy && cacheStrategy.ttl > 0 && cacheKey && options?.responseType !== 'blob') {
      cache.set(cacheKey, {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + cacheStrategy.ttl,
      });
    }

    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`[fetchWithCache] Request aborted: ${url}`);
    }
    throw error;
  } finally {
    if (cacheKey) {
      abortControllers.delete(cacheKey);
    }
  }
}

/**
 * Manually invalidate cache for a URL pattern
 */
export function invalidateCache(urlPattern: string | RegExp): void {
  const keysToDelete: string[] = [];

  for (const [key] of cache) {
    const url = key.split(':')[1];  // Extract URL from "METHOD:URL:BODY"
    if (typeof urlPattern === 'string') {
      if (url.includes(urlPattern)) {
        keysToDelete.push(key);
      }
    } else {
      if (urlPattern.test(url)) {
        keysToDelete.push(key);
      }
    }
  }

  keysToDelete.forEach(key => cache.delete(key));
  console.log(`[fetchWithCache] Invalidated ${keysToDelete.length} cache entries`);
}

/**
 * Clear all cache
 */
export function clearCache(): void {
  cache.clear();
  console.log('[fetchWithCache] Cleared all cache');
}
