// HTTP routes for the glasses app. Plain node:http — no framework — so every line that
// touches money is visible and there are zero runtime dependencies to audit.

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import { AppError, type BoardType, type MarketCountry, type MarketProvider, type NewsProvider } from './domain.ts';
import { OrderDesk } from './orders.ts';

export interface AppDeps {
  config: Config;
  provider: MarketProvider;
  news: NewsProvider;
}

type Handler = (ctx: { url: URL; body: unknown; params: string[] }) => Promise<unknown>;

const BOARD_TYPES: BoardType[] = ['MARKET_TRADING_AMOUNT', 'TOP_GAINERS', 'TOP_LOSERS'];

export function createHandler({ config, provider, news }: AppDeps) {
  const desk = new OrderDesk(provider, { tradingEnabled: config.trading.enabled, maxOrderKrw: config.trading.maxOrderKrw });

  const routes: [method: string, pattern: RegExp, handler: Handler][] = [
    ['GET', /^\/api\/health$/, async () => ({
      mode: provider.kind,
      news: news.kind,
      tradingEnabled: desk.canTrade,
      maxOrderKrw: config.trading.maxOrderKrw,
    })],
    ['GET', /^\/api\/home$/, async () => {
      const [indices, watchlist, portfolio, usdKrw] = await Promise.all([
        provider.indices(),
        provider.quotes(config.watchlist),
        provider.portfolio().catch(() => null),
        provider.usdKrw().catch(() => null),
      ]);
      return { indices, watchlist, portfolio, usdKrw };
    }],
    ['GET', /^\/api\/board$/, async ({ url }) => {
      const type = (url.searchParams.get('type') ?? 'MARKET_TRADING_AMOUNT') as BoardType;
      const market = (url.searchParams.get('market') ?? 'KR') as MarketCountry;
      if (!BOARD_TYPES.includes(type) || (market !== 'KR' && market !== 'US')) {
        throw new AppError(400, 'invalid-request', 'type/market 값이 올바르지 않아요');
      }
      return (await provider.board(type, market)).slice(0, 10);
    }],
    ['GET', /^\/api\/stocks\/([A-Za-z0-9.\-]{1,12})$/, async ({ params }) => provider.detail(params[0]!.toUpperCase())],
    ['GET', /^\/api\/search$/, async ({ url }) => provider.search((url.searchParams.get('q') ?? '').slice(0, 40))],
    ['GET', /^\/api\/news$/, async ({ url }) => news.latest(url.searchParams.get('q')?.slice(0, 40) || undefined)],
    ['GET', /^\/api\/portfolio$/, async () => provider.portfolio()],
    ['POST', /^\/api\/orders\/preview$/, async ({ body }) => desk.preview(body)],
    ['POST', /^\/api\/orders$/, async ({ body }) => desk.execute(body)],
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(config.staticDir, url.pathname, res);
      if (!authorized(req, config.deviceToken)) throw new AppError(401, 'unauthorized', '기기 연결(페어링)이 필요해요');

      const route = routes.find(([m, p]) => m === req.method && p.test(url.pathname));
      if (!route) throw new AppError(404, 'not-found', '없는 경로예요');
      const params = route[1].exec(url.pathname)!.slice(1);
      const body = req.method === 'POST' ? await readJson(req) : undefined;
      const data = await route[2]({ url, body, params });
      send(res, 200, { mode: provider.kind, data });
    } catch (err) {
      if (err instanceof AppError) return send(res, err.status, { error: { code: err.code, message: err.message } });
      console.error('[server] unexpected', err);
      send(res, 500, { error: { code: 'internal', message: '잠시 후 다시 시도해 주세요' } });
    }
  };
}

function authorized(req: IncomingMessage, token: string | null): boolean {
  if (!token) return true; // mock/dev mode without a token
  const header = req.headers.authorization ?? '';
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(token);
  // Constant-time compare so the token can't be guessed byte-by-byte from response timing.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 16_384) throw new AppError(413, 'too-large', '요청이 너무 커요');
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid-json', 'JSON 형식이 아니에요');
  }
}

function send(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function serveStatic(dir: string | null, pathname: string, res: ServerResponse) {
  if (!dir) return send(res, 404, { error: { code: 'not-found', message: 'STATIC_DIR not set' } });
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(dir, safe);
  if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    // Hashed assets are immutable; index.html must revalidate so new builds reach the glasses.
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
