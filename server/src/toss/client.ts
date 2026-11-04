// Thin HTTP client for the Toss Securities Open API (https://openapi.tossinvest.com).
// Responsibilities:
//  1. OAuth2 client-credentials token: fetch once, cache, refresh 60s before expiry.
//  2. Attach `Authorization` and (for account endpoints) `X-Tossinvest-Account`.
//  3. Turn Toss error bodies `{ error: { code, message, requestId } }` into AppError.
//  4. Respect 429 `Retry-After` once.

import { AppError } from '../domain.ts';

interface TokenState {
  accessToken: string;
  expiresAt: number;
}

export interface TossClientOptions {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

export class TossClient {
  private token: TokenState | null = null;
  private tokenInflight: Promise<string> | null = null;
  private readonly opts: TossClientOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TossClientOptions) {
    this.opts = opts;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.accessToken;
    // Collapse concurrent refreshes into one request.
    this.tokenInflight ??= this.fetchToken().finally(() => {
      this.tokenInflight = null;
    });
    return this.tokenInflight;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
    });
    const res = await this.fetchImpl(`${this.opts.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      // Never log the response body verbatim here: it may echo credentials on some errors.
      throw new AppError(502, 'toss-auth-failed', `토스증권 인증 실패 (HTTP ${res.status}). 키와 허용 IP를 확인하세요.`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async get<T>(path: string, query: Query = {}, accountSeq?: number): Promise<T> {
    return this.request<T>('GET', path, query, undefined, accountSeq);
  }

  async post<T>(path: string, body: unknown, accountSeq?: number): Promise<T> {
    return this.request<T>('POST', path, {}, body, accountSeq);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query: Query,
    body: unknown,
    accountSeq: number | undefined,
    retried = false,
  ): Promise<T> {
    const url = new URL(path, this.opts.baseUrl);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

    const headers: Record<string, string> = {
      authorization: `Bearer ${await this.accessToken()}`,
      accept: 'application/json',
    };
    if (accountSeq !== undefined) headers['x-tossinvest-account'] = String(accountSeq);
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });

    if (res.status === 401 && !retried) {
      this.token = null; // token revoked or expired early — refresh once
      return this.request<T>(method, path, query, body, accountSeq, true);
    }
    // Only retry 429 for reads. Re-sending an order is handled by clientOrderId idempotency upstream.
    if (res.status === 429 && !retried && method === 'GET') {
      const wait = Math.min(Number(res.headers.get('retry-after') ?? 1), 5) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      return this.request<T>(method, path, query, body, accountSeq, true);
    }
    if (!res.ok) {
      let code = `http-${res.status}`;
      let message = '토스증권 API 오류';
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string; requestId?: string } };
        code = err.error?.code ?? code;
        message = err.error?.message || message;
        if (err.error?.requestId) message += ` (요청ID ${err.error.requestId})`;
      } catch {
        /* non-JSON error body */
      }
      throw new AppError(res.status >= 500 ? 502 : res.status, code, message);
    }
    return ((await res.json()) as { result: T }).result;
  }
}
