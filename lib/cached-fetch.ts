const cache = new Map<string, { data: unknown; at: number }>();
const pending = new Map<string, Promise<unknown>>();

const DEFAULT_TTL = 10_000;

export async function cachedFetch<T>(url: string, ttl: number = DEFAULT_TTL): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) {
    return hit.data as T;
  }
  const inflight = pending.get(url);
  if (inflight) return inflight as Promise<T>;
  const promise = fetch(url)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
    .then((data) => {
      cache.set(url, { data, at: Date.now() });
      pending.delete(url);
      return data;
    })
    .catch((e) => {
      pending.delete(url);
      throw e;
    });
  pending.set(url, promise);
  return promise as Promise<T>;
}

export function invalidateCache(url?: string) {
  if (url) cache.delete(url);
  else cache.clear();
}