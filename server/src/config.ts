// All runtime configuration comes from environment variables (see ../.env.example).
// Secrets live ONLY here, on the server — never in the glasses bundle.

export type Mode = 'mock' | 'live';

export interface Config {
  mode: Mode;
  port: number;
  /** Shared secret the glasses app sends as `Authorization: Bearer <token>`. */
  deviceToken: string | null;
  toss: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    /** Optional: pin a specific account. Otherwise the first BROKERAGE account is used. */
    accountSeq: number | null;
  };
  trading: {
    /** Live orders are refused unless this is explicitly true. */
    enabled: boolean;
    /** Hard ceiling per order in KRW (USD orders are converted with the live FX rate). */
    maxOrderKrw: number;
  };
  news: {
    naverClientId: string | null;
    naverClientSecret: string | null;
  };
  watchlist: string[];
  staticDir: string | null;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

export function loadConfig(): Config {
  const mode: Mode = env('APP_MODE') === 'live' ? 'live' : 'mock';
  const cfg: Config = {
    mode,
    port: Number(env('PORT') ?? 8787),
    deviceToken: env('DEVICE_TOKEN') ?? null,
    toss: {
      baseUrl: env('TOSS_BASE_URL') ?? 'https://openapi.tossinvest.com',
      clientId: env('TOSS_CLIENT_ID') ?? '',
      clientSecret: env('TOSS_CLIENT_SECRET') ?? '',
      accountSeq: env('TOSS_ACCOUNT_SEQ') ? Number(env('TOSS_ACCOUNT_SEQ')) : null,
    },
    trading: {
      enabled: env('TRADING_ENABLED') === 'true',
      maxOrderKrw: Number(env('MAX_ORDER_KRW') ?? 1_000_000),
    },
    news: {
      naverClientId: env('NAVER_CLIENT_ID') ?? null,
      naverClientSecret: env('NAVER_CLIENT_SECRET') ?? null,
    },
    watchlist: (env('WATCHLIST') ?? '005930,000660,035420,AAPL,NVDA,TSLA')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    staticDir: env('STATIC_DIR') ?? null,
  };

  if (mode === 'live') {
    if (!cfg.toss.clientId || !cfg.toss.clientSecret) {
      throw new Error('APP_MODE=live requires TOSS_CLIENT_ID and TOSS_CLIENT_SECRET');
    }
    // A live server can move real money. It must never be reachable without a device token.
    if (!cfg.deviceToken || cfg.deviceToken.length < 24) {
      throw new Error('APP_MODE=live requires DEVICE_TOKEN (at least 24 random characters)');
    }
  }
  return cfg;
}
