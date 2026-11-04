// Tiny TTL cache + in-flight de-duplication.
// Why: several glasses screens poll the same data, and the Toss API has per-group rate
// limits. Ten requests for KOSPI within two seconds should cost Toss exactly one call.

interface Entry<T> {
  value?: T;
  expiresAt: number;
  inflight?: Promise<T>;
}

export class TtlCache {
  private readonly store = new Map<string, Entry<unknown>>();

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key) as Entry<T> | undefined;
    if (hit?.value !== undefined && hit.expiresAt > now) return hit.value;
    if (hit?.inflight) return hit.inflight;

    const inflight = load().then(
      (value) => {
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      },
      (err: unknown) => {
        this.store.delete(key);
        throw err;
      },
    );
    this.store.set(key, { ...hit, expiresAt: hit?.expiresAt ?? 0, inflight });
    return inflight;
  }
}
