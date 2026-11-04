// Order safety layer — the most important file in this repo.
//
// Pattern: "preview ticket" (two-phase commit for humans).
//   1. POST /api/orders/preview  → server validates, prices, and stores the EXACT order
//      payload under a one-time ticket (= Toss clientOrderId). Nothing is sent to Toss.
//   2. POST /api/orders { ticket } → server sends the stored payload, not anything the
//      client re-sends. What the wearer saw on the confirm screen is what gets executed.
//
// Why this matters on glasses: input is a finger pinch or a voice transcript, both of
// which can misfire. A ticket makes a stray double-pinch harmless (idempotent via
// clientOrderId), and a mis-heard voice command can never skip the confirm screen.

import { randomUUID } from 'node:crypto';
import {
  AppError,
  marketOf,
  type MarketProvider,
  type OrderDraft,
  type OrderPreview,
  type OrderResult,
} from './domain.ts';
import { krTick } from './providers/mock.ts';

const TICKET_TTL_MS = 60_000;

interface StoredTicket {
  preview: OrderPreview;
  expiresAt: number;
  /** Set once executed, so a replayed confirm returns the same result instead of re-ordering. */
  result?: OrderResult;
  inflight?: Promise<OrderResult>;
}

export interface OrderGuardOptions {
  tradingEnabled: boolean;
  maxOrderKrw: number;
}

export class OrderDesk {
  private readonly tickets = new Map<string, StoredTicket>();
  private readonly provider: MarketProvider;
  private readonly opts: OrderGuardOptions;

  constructor(provider: MarketProvider, opts: OrderGuardOptions) {
    this.provider = provider;
    this.opts = opts;
  }

  /** Live orders need TRADING_ENABLED=true. Mock orders are always allowed (they're fake). */
  get canTrade(): boolean {
    return this.provider.kind === 'mock' || this.opts.tradingEnabled;
  }

  async preview(input: unknown): Promise<OrderPreview> {
    const draft = parseDraft(input);
    const market = marketOf(draft.symbol);
    const [quote] = await this.provider.quotes([draft.symbol]);
    if (!quote) throw new AppError(404, 'unknown-symbol', '종목을 찾을 수 없어요');

    if (draft.orderType === 'LIMIT') {
      if (market === 'KR') {
        const tick = krTick(draft.price!);
        if (draft.price! % tick !== 0) {
          throw new AppError(400, 'invalid-tick', `호가 단위는 ${tick.toLocaleString('ko-KR')}원이에요`);
        }
      }
      // Fat-finger guard: a limit price far from market is almost always an input error.
      const gap = Math.abs(draft.price! - quote.price) / quote.price;
      if (gap > 0.1) throw new AppError(400, 'price-far-from-market', '현재가와 10% 이상 차이 나는 가격이에요');
    }

    const unitPrice = draft.orderType === 'LIMIT' ? draft.price! : quote.price;
    const estimatedAmount = round2(unitPrice * draft.quantity);
    const fx = quote.currency === 'USD' ? await this.provider.usdKrw() : 1;
    const estimatedAmountKrw = Math.round(estimatedAmount * fx);

    if (estimatedAmountKrw > this.opts.maxOrderKrw) {
      throw new AppError(
        400,
        'over-max-order',
        `1회 주문 한도(${this.opts.maxOrderKrw.toLocaleString('ko-KR')}원)를 넘어요`,
      );
    }

    const warnings: string[] = [];
    if (!this.canTrade) warnings.push('실거래가 꺼져 있어요 (TRADING_ENABLED=false)');
    if (draft.orderType === 'MARKET') warnings.push('시장가는 표시 가격과 다르게 체결될 수 있어요');
    if (this.provider.kind === 'mock') warnings.push('모의 주문이에요. 실제 돈이 움직이지 않아요');

    // Toss clientOrderId: max 36 chars, [a-zA-Z0-9-_]. A UUID is exactly 36.
    const ticket = randomUUID();
    const expiresAt = Date.now() + TICKET_TTL_MS;
    const preview: OrderPreview = {
      ticket,
      draft,
      name: quote.name,
      currency: quote.currency,
      estimatedAmount,
      estimatedAmountKrw,
      commissionRate: await this.provider.commissionRate(market).catch(() => null),
      expiresAt: new Date(expiresAt).toISOString(),
      warnings,
    };
    this.gc();
    this.tickets.set(ticket, { preview, expiresAt });
    return preview;
  }

  async execute(input: unknown): Promise<OrderResult & { preview: OrderPreview }> {
    const ticketId = (input as { ticket?: unknown })?.ticket;
    if (typeof ticketId !== 'string') throw new AppError(400, 'invalid-request', 'ticket이 필요해요');
    const t = this.tickets.get(ticketId);
    if (!t) throw new AppError(404, 'ticket-not-found', '주문 확인이 만료됐어요. 다시 시도해 주세요');
    if (t.result) return { ...t.result, preview: t.preview }; // replay → same answer, no new order
    if (t.inflight) return { ...(await t.inflight), preview: t.preview };
    if (Date.now() > t.expiresAt) {
      this.tickets.delete(ticketId);
      throw new AppError(410, 'ticket-expired', '주문 확인이 만료됐어요. 다시 시도해 주세요');
    }
    if (!this.canTrade) throw new AppError(403, 'trading-disabled', '서버에서 실거래가 꺼져 있어요');

    // Same ticket → same clientOrderId → Toss itself de-duplicates within 10 minutes,
    // so even a network retry after a timeout cannot create a second order.
    t.inflight = this.provider.placeOrder(t.preview.draft, ticketId);
    try {
      t.result = await t.inflight;
    } finally {
      t.inflight = undefined;
    }
    t.expiresAt = Date.now() + 10 * 60_000; // keep for replay-safety, mirrors Toss's 10 min window
    return { ...t.result, preview: t.preview };
  }

  private gc() {
    const now = Date.now();
    for (const [k, t] of this.tickets) if (t.expiresAt < now && !t.inflight) this.tickets.delete(k);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseDraft(input: unknown): OrderDraft {
  const o = (input ?? {}) as Record<string, unknown>;
  const symbol = typeof o.symbol === 'string' ? o.symbol.trim().toUpperCase() : '';
  if (!/^[A-Z0-9.\-]{1,12}$/.test(symbol)) throw new AppError(400, 'invalid-request', '종목 코드가 올바르지 않아요');
  if (o.side !== 'BUY' && o.side !== 'SELL') throw new AppError(400, 'invalid-request', 'side는 BUY 또는 SELL이에요');
  if (o.orderType !== 'LIMIT' && o.orderType !== 'MARKET') throw new AppError(400, 'invalid-request', 'orderType은 LIMIT 또는 MARKET이에요');
  const quantity = Number(o.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
    throw new AppError(400, 'invalid-request', '수량은 1주 이상 정수로 입력해 주세요');
  }
  const draft: OrderDraft = { symbol, side: o.side, orderType: o.orderType, quantity };
  if (o.orderType === 'LIMIT') {
    const price = Number(o.price);
    if (!Number.isFinite(price) || price <= 0) throw new AppError(400, 'invalid-request', '지정가 주문에는 가격이 필요해요');
    draft.price = price;
  } else if (o.price !== undefined) {
    throw new AppError(400, 'invalid-request', '시장가 주문에는 가격을 넣을 수 없어요');
  }
  return draft;
}
