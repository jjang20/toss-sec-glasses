// Offline MarketProvider: realistic-looking but FAKE prices that drift over time.
// Lets you design and demo the whole glasses UX — including the order flow — without
// API keys or real money. Every response is labelled `mode: mock` by the HTTP layer.

import {
  AppError,
  marketOf,
  type BoardType,
  type Currency,
  type Holding,
  type IndexQuote,
  type MarketCountry,
  type MarketProvider,
  type OrderDraft,
  type OrderResult,
  type Portfolio,
  type Quote,
  type StockDetail,
} from '../domain.ts';
import { rankMatches } from './live.ts';

interface Seed { symbol: string; name: string; currency: Currency; base: number; vol: number }

const UNIVERSE: Seed[] = [
  { symbol: '005930', name: '삼성전자', currency: 'KRW', base: 71_500, vol: 0.012 },
  { symbol: '000660', name: 'SK하이닉스', currency: 'KRW', base: 198_000, vol: 0.02 },
  { symbol: '035420', name: 'NAVER', currency: 'KRW', base: 214_500, vol: 0.015 },
  { symbol: '035720', name: '카카오', currency: 'KRW', base: 41_850, vol: 0.018 },
  { symbol: '005380', name: '현대차', currency: 'KRW', base: 246_000, vol: 0.014 },
  { symbol: '373220', name: 'LG에너지솔루션', currency: 'KRW', base: 389_500, vol: 0.022 },
  { symbol: '068270', name: '셀트리온', currency: 'KRW', base: 176_300, vol: 0.017 },
  { symbol: '105560', name: 'KB금융', currency: 'KRW', base: 83_400, vol: 0.011 },
  { symbol: '247540', name: '에코프로비엠', currency: 'KRW', base: 128_700, vol: 0.035 },
  { symbol: '196170', name: '알테오젠', currency: 'KRW', base: 352_000, vol: 0.04 },
  { symbol: 'AAPL', name: '애플', currency: 'USD', base: 228.4, vol: 0.011 },
  { symbol: 'NVDA', name: '엔비디아', currency: 'USD', base: 141.2, vol: 0.025 },
  { symbol: 'TSLA', name: '테슬라', currency: 'USD', base: 252.7, vol: 0.03 },
  { symbol: 'MSFT', name: '마이크로소프트', currency: 'USD', base: 431.9, vol: 0.01 },
  { symbol: 'AMZN', name: '아마존', currency: 'USD', base: 197.3, vol: 0.014 },
  { symbol: 'PLTR', name: '팔란티어', currency: 'USD', base: 64.1, vol: 0.04 },
];

// Deterministic pseudo-noise: the same (symbol, minute) always yields the same price, so
// every screen agrees with every other screen and restarts don't jump.
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100_000) / 100_000;
}

function walk(seed: Seed, minute: number): number {
  // Sum of a few sine waves + hashed jitter ≈ plausible intraday drift.
  const phase = hash(seed.symbol) * Math.PI * 2;
  const drift =
    Math.sin(minute / 47 + phase) * 0.6 + Math.sin(minute / 13 + phase * 2) * 0.3 + (hash(`${seed.symbol}:${minute}`) - 0.5) * 0.4;
  return seed.base * (1 + drift * seed.vol);
}

export function krTick(price: number): number {
  // KRX unified tick-size table (KOSPI/KOSDAQ, 2023~).
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

function roundPrice(seed: Seed, raw: number): number {
  if (seed.currency === 'USD') return Math.round(raw * 100) / 100;
  const tick = krTick(raw);
  return Math.round(raw / tick) * tick;
}

const nowMinute = () => Math.floor(Date.now() / 60_000);
const PREV_CLOSE_MINUTE = (m: number) => m - (m % 1440) - 1; // "yesterday" = last minute before today's UTC day

export class MockProvider implements MarketProvider {
  readonly kind = 'mock' as const;
  private readonly positions = new Map<string, { quantity: number; averagePrice: number }>([
    ['005930', { quantity: 30, averagePrice: 68_200 }],
    ['035420', { quantity: 5, averagePrice: 228_000 }],
    ['NVDA', { quantity: 12, averagePrice: 118.5 }],
  ]);
  private cashKrw = 2_450_000;
  private cashUsd = 830.25;
  private orderSeq = 1;

  private seed(symbol: string): Seed {
    const s = UNIVERSE.find((u) => u.symbol === symbol);
    if (!s) throw new AppError(404, 'unknown-symbol', '종목을 찾을 수 없어요');
    return s;
  }

  private quoteOf(seed: Seed): Quote {
    const m = nowMinute();
    const price = roundPrice(seed, walk(seed, m));
    const prev = roundPrice(seed, walk(seed, PREV_CLOSE_MINUTE(m)));
    return {
      symbol: seed.symbol,
      name: seed.name,
      currency: seed.currency,
      price,
      change: price - prev,
      changeRate: (price - prev) / prev,
    };
  }

  async indices(): Promise<IndexQuote[]> {
    const mk = (symbol: string, name: string, base: number, vol: number, unit: 'pt' | '%'): IndexQuote => {
      const seed = { symbol, name, currency: 'KRW' as Currency, base, vol };
      const m = nowMinute();
      const value = Math.round(walk(seed, m) * 100) / 100;
      const prev = Math.round(walk(seed, PREV_CLOSE_MINUTE(m)) * 100) / 100;
      return { symbol, name, value, change: value - prev, changeRate: (value - prev) / prev, unit };
    };
    return [mk('KOSPI', '코스피', 2_768.4, 0.006, 'pt'), mk('KOSDAQ', '코스닥', 812.7, 0.009, 'pt'), mk('KR_BOND_3Y', '국고채 3년', 2.84, 0.004, '%')];
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    return symbols.flatMap((s) => {
      const seed = UNIVERSE.find((u) => u.symbol === s);
      return seed ? [this.quoteOf(seed)] : [];
    });
  }

  async board(type: BoardType, market: MarketCountry): Promise<Quote[]> {
    const list = UNIVERSE.filter((u) => marketOf(u.symbol) === market).map((u) => this.quoteOf(u));
    const sorted =
      type === 'TOP_GAINERS'
        ? list.sort((a, b) => (b.changeRate ?? 0) - (a.changeRate ?? 0))
        : type === 'TOP_LOSERS'
          ? list.sort((a, b) => (a.changeRate ?? 0) - (b.changeRate ?? 0))
          : list.sort((a, b) => b.price * hash(b.symbol) - a.price * hash(a.symbol));
    return sorted.map((q, i) => ({ ...q, rank: i + 1 }));
  }

  async detail(symbol: string): Promise<StockDetail> {
    const seed = this.seed(symbol);
    const quote = this.quoteOf(seed);
    const m = nowMinute();
    const spark = Array.from({ length: 60 }, (_, i) => roundPrice(seed, walk(seed, m - 59 + i)));
    const tick = seed.currency === 'KRW' ? krTick(quote.price) : 0.01;
    const lvl = (i: number, dir: 1 | -1) => ({
      price: Math.round((quote.price + dir * tick * (i + 1)) * 100) / 100,
      volume: Math.round(500 + hash(`${symbol}:${m}:${dir}:${i}`) * 9_500),
    });
    const pos = this.positions.get(symbol);
    return {
      quote,
      spark,
      asks: [0, 1, 2, 3, 4].map((i) => lvl(i, 1)),
      bids: [0, 1, 2, 3, 4].map((i) => lvl(i, -1)),
      holding: pos ? this.holdingOf(seed, pos) : null,
      buyingPower: seed.currency === 'KRW' ? this.cashKrw : this.cashUsd,
      sellableQuantity: pos?.quantity ?? 0,
    };
  }

  private holdingOf(seed: Seed, pos: { quantity: number; averagePrice: number }): Holding {
    const price = this.quoteOf(seed).price;
    return {
      symbol: seed.symbol,
      name: seed.name,
      currency: seed.currency,
      quantity: pos.quantity,
      averagePrice: pos.averagePrice,
      price,
      profitLossRate: (price - pos.averagePrice) / pos.averagePrice,
    };
  }

  async portfolio(): Promise<Portfolio> {
    const fx = await this.usdKrw();
    const holdings = [...this.positions].map(([symbol, pos]) => this.holdingOf(this.seed(symbol), pos));
    let krw = 0, usd = 0, costKrw = 0, prevKrw = 0;
    for (const h of holdings) {
      const q = this.quoteOf(this.seed(h.symbol));
      const prev = q.price - (q.change ?? 0);
      const k = h.currency === 'USD' ? fx : 1;
      if (h.currency === 'USD') usd += h.price * h.quantity;
      else krw += h.price * h.quantity;
      costKrw += h.averagePrice * h.quantity * k;
      prevKrw += prev * h.quantity * k;
    }
    const totalKrw = krw + usd * fx;
    return {
      marketValueKrw: krw,
      marketValueUsd: usd,
      profitLossKrw: Math.round(totalKrw - costKrw),
      dailyProfitLossRate: prevKrw ? (totalKrw - prevKrw) / prevKrw : null,
      holdings,
    };
  }

  async search(query: string) {
    return rankMatches(UNIVERSE, query);
  }

  async usdKrw(): Promise<number> {
    return 1_384.5;
  }

  async commissionRate(market: MarketCountry): Promise<number | null> {
    return market === 'KR' ? 0.00015 : 0.001;
  }

  async placeOrder(draft: OrderDraft): Promise<OrderResult> {
    const seed = this.seed(draft.symbol);
    const fill = draft.orderType === 'LIMIT' && draft.price ? draft.price : this.quoteOf(seed).price;
    const amount = fill * draft.quantity;
    const pos = this.positions.get(draft.symbol) ?? { quantity: 0, averagePrice: 0 };
    const isKrw = seed.currency === 'KRW';
    if (draft.side === 'BUY') {
      const cash = isKrw ? this.cashKrw : this.cashUsd;
      if (amount > cash) throw new AppError(400, 'insufficient-buying-power', '주문 가능 금액이 부족해요');
      const qty = pos.quantity + draft.quantity;
      this.positions.set(draft.symbol, { quantity: qty, averagePrice: (pos.averagePrice * pos.quantity + amount) / qty });
      if (isKrw) this.cashKrw -= amount;
      else this.cashUsd -= amount;
    } else {
      if (draft.quantity > pos.quantity) throw new AppError(400, 'insufficient-sellable-quantity', '판매 가능 수량이 부족해요');
      const qty = pos.quantity - draft.quantity;
      if (qty === 0) this.positions.delete(draft.symbol);
      else this.positions.set(draft.symbol, { ...pos, quantity: qty });
      if (isKrw) this.cashKrw += amount;
      else this.cashUsd += amount;
    }
    return { orderId: `MOCK-${String(this.orderSeq++).padStart(5, '0')}`, simulated: true };
  }
}
