import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

export interface PollState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** True when showing old data because the latest refresh failed. */
  stale: boolean;
  reload: () => void;
}

/**
 * Last good response per key, kept for the session. Coming back to a screen shows the
 * previous numbers immediately (then refreshes) instead of flashing a skeleton — and lets
 * focus restoration find the row the wearer left from. "Stale-while-revalidate" pattern.
 */
const memory = new Map<string, unknown>();

/**
 * `key` names the request (e.g. `stock:005930`): it is both the cache key and the
 * dependency — a new key restarts polling.
 * Fetch now, then every `intervalMs` — but only while the page is visible.
 * Glasses have a small battery and a ~500 Kbps link, so a hidden app must go quiet.
 * Each run aborts the previous one, so a slow response can never overwrite a newer one.
 */
export function usePoll<T>(key: string, load: (signal: AbortSignal) => Promise<T>, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(() => (memory.get(key) as T | undefined) ?? null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const ctrl = useRef<AbortController | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const keyRef = useRef(key);
  keyRef.current = key;

  const run = useCallback(async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    try {
      const next = await loadRef.current(c.signal);
      if (c.signal.aborted) return;
      memory.set(keyRef.current, next);
      setData(next);
      setError(null);
    } catch (e) {
      if (c.signal.aborted || (e as Error).name === 'AbortError') return;
      setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', '잠시 후 다시 시도해 주세요'));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setData((memory.get(keyRef.current) as T | undefined) ?? null);
    setLoading(true);
    setError(null);
    let timer: number | undefined;
    const start = () => {
      void run();
      if (intervalMs > 0) timer = window.setInterval(() => void run(), intervalMs);
    };
    const stop = () => {
      window.clearInterval(timer);
      ctrl.current?.abort();
    };
    const onVis = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [key, intervalMs, run]);

  return { data, error, loading, stale: data !== null && error !== null, reload: () => void run() };
}
