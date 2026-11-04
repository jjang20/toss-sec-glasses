// Client for our own BFF (server/). The glasses NEVER call Toss directly:
// the Toss client_secret can't live in a web bundle, and Toss requires an allow-listed IP.

import type {
  BoardType,
  Health,
  HomeData,
  MarketCountry,
  NewsItem,
  OrderDraft,
  OrderPreview,
  OrderResult,
  Portfolio,
  StockDetail,
} from './types.ts';

const TOKEN_KEY = 'tsg.deviceToken';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Pairing: open the app once as `https://your-host/#pair=<DEVICE_TOKEN>`.
 * The token is moved to localStorage and erased from the URL bar, so it doesn't linger in
 * history or get shared by accident. URL fragments (#…) are never sent to servers.
 */
export function capturePairingToken(): void {
  const m = /[#&]pair=([A-Za-z0-9_\-.~]+)/.exec(location.hash);
  if (!m) return;
  try {
    localStorage.setItem(TOKEN_KEY, m[1]!);
  } catch {
    /* storage unavailable — requests will 401 and the pairing screen explains */
  }
  history.replaceState(null, '', location.pathname + location.search);
}

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function call<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const t = token();
  if (t) headers.authorization = `Bearer ${t}`;
  if (init.body) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'offline', '연결이 끊겼어요');
  }
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { code: string; message: string } };
  if (!res.ok || json.error) {
    throw new ApiError(res.status, json.error?.code ?? `http-${res.status}`, json.error?.message ?? '잠시 후 다시 시도해 주세요');
  }
  return json.data as T;
}

export const api = {
  health: (s?: AbortSignal) => call<Health>('/health', {}, s),
  home: (s?: AbortSignal) => call<HomeData>('/home', {}, s),
  board: (type: BoardType, market: MarketCountry, s?: AbortSignal) =>
    call<import('./types.ts').Quote[]>(`/board?type=${type}&market=${market}`, {}, s),
  stock: (symbol: string, s?: AbortSignal) => call<StockDetail>(`/stocks/${encodeURIComponent(symbol)}`, {}, s),
  search: (q: string, s?: AbortSignal) =>
    call<{ symbol: string; name: string }[]>(`/search?q=${encodeURIComponent(q)}`, {}, s),
  news: (q?: string, s?: AbortSignal) => call<NewsItem[]>(`/news${q ? `?q=${encodeURIComponent(q)}` : ''}`, {}, s),
  portfolio: (s?: AbortSignal) => call<Portfolio | null>('/portfolio', {}, s),
  previewOrder: (draft: OrderDraft) => call<OrderPreview>('/orders/preview', { method: 'POST', body: JSON.stringify(draft) }),
  placeOrder: (ticket: string) => call<OrderResult>('/orders', { method: 'POST', body: JSON.stringify({ ticket }) }),
};
