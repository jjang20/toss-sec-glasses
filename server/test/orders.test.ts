import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, type OrderDraft } from '../src/domain.ts';
import { OrderDesk, parseDraft } from '../src/orders.ts';
import { MockProvider, krTick } from '../src/providers/mock.ts';
import { TossClient } from '../src/toss/client.ts';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return 'no-error';
};

test('KRX tick table', () => {
  assert.equal(krTick(1_999), 1);
  assert.equal(krTick(4_999), 5);
  assert.equal(krTick(71_500), 100);
  assert.equal(krTick(214_500), 500);
  assert.equal(krTick(612_000), 1_000);
});

test('parseDraft rejects malformed orders', () => {
  assert.equal(code(() => parseDraft({ symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: 1 })), 'invalid-request');
  assert.equal(code(() => parseDraft({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 1, price: 1 })), 'invalid-request');
  assert.equal(code(() => parseDraft({ symbol: '005930', side: 'HOLD', orderType: 'MARKET', quantity: 1 })), 'invalid-request');
  assert.equal(code(() => parseDraft({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 1.5 })), 'invalid-request');
  assert.equal(code(() => parseDraft({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 2 })), 'no-error');
});

test('preview → execute uses the stored payload, and replays never double-order', async () => {
  const provider = new MockProvider();
  let calls = 0;
  const original = provider.placeOrder.bind(provider);
  provider.placeOrder = async (d: OrderDraft) => {
    calls++;
    return original(d);
  };
  const desk = new OrderDesk(provider, { tradingEnabled: false, maxOrderKrw: 1_000_000 });
  const p = await desk.preview({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 2 });
  assert.equal(p.ticket.length, 36);
  const a = await desk.execute({ ticket: p.ticket });
  const b = await desk.execute({ ticket: p.ticket }); // stray double-pinch
  assert.equal(a.orderId, b.orderId);
  assert.equal(calls, 1);
  assert.equal(a.simulated, true);
});

test('max order amount guard', async () => {
  const desk = new OrderDesk(new MockProvider(), { tradingEnabled: true, maxOrderKrw: 100_000 });
  await assert.rejects(
    desk.preview({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 50 }),
    (e: AppError) => e.code === 'over-max-order',
  );
});

test('limit price must match tick and stay near market', async () => {
  const provider = new MockProvider();
  const desk = new OrderDesk(provider, { tradingEnabled: true, maxOrderKrw: 10_000_000 });
  const [q] = await provider.quotes(['005930']);
  await assert.rejects(
    desk.preview({ symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: 1, price: q!.price + 7 }),
    (e: AppError) => e.code === 'invalid-tick',
  );
  await assert.rejects(
    desk.preview({ symbol: '005930', side: 'BUY', orderType: 'LIMIT', quantity: 1, price: Math.round(q!.price * 1.5 / 100) * 100 }),
    (e: AppError) => e.code === 'price-far-from-market',
  );
});

test('live provider + TRADING_ENABLED=false refuses to execute', async () => {
  const live = Object.assign(new MockProvider(), { kind: 'live' as const });
  const desk = new OrderDesk(live, { tradingEnabled: false, maxOrderKrw: 1_000_000 });
  const p = await desk.preview({ symbol: '005930', side: 'BUY', orderType: 'MARKET', quantity: 1 });
  assert.ok(p.warnings.some((w) => w.includes('TRADING_ENABLED')));
  await assert.rejects(desk.execute({ ticket: p.ticket }), (e: AppError) => e.code === 'trading-disabled');
});

test('TossClient caches the OAuth token and sends the account header', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.endsWith('/oauth2/token')) {
      return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 3600 }));
    }
    return new Response(JSON.stringify({ result: { ok: true } }));
  }) as typeof fetch;
  const c = new TossClient({ baseUrl: 'https://example.test', clientId: 'id', clientSecret: 's', fetchImpl: fakeFetch });
  await c.get('/api/v1/prices', { symbols: '005930' });
  await c.get('/api/v1/holdings', {}, 42);
  assert.equal(seen.filter((s) => s.url.endsWith('/oauth2/token')).length, 1);
  const holdings = seen.find((s) => s.url.includes('/holdings'))!;
  assert.equal(holdings.headers['authorization'], 'Bearer tok');
  assert.equal(holdings.headers['x-tossinvest-account'], '42');
});
