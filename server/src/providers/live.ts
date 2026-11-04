// MarketProvider backed by the real Toss Securities Open API.
// Endpoint reference: https://developers.tossinvest.com/docs (OpenAPI 1.2.x).

import { TtlCache } from '../cache.ts';
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
import type { TossClient } from '../toss/client.ts';

// ---- Raw Toss response shapes (only the fields we read) --------------------------------
interface RawPrice { symbol: string; timestamp: string | null; lastPrice: string; currency: Currency }
interface RawCandle { timestamp: string; closePrice: string }
interface RawStock { symbol: string; name: string; currency: Currency; market: string }
interface RawListed { symbol: string; name: string }
interface RawRanking {
  rank: number;
  symbol: string;
  currency: Currency;
  price: { lastPrice: string; basePrice: string; changeRate: string | null };
}
interface RawHoldingItem {
  symbol: string;
  name: string;
  currency: Currency;
  quantity: string;
  lastPrice: string;
  averagePurchasePrice: string;
  profitLoss: { rate: string };
}
interface RawHoldings {
  marketValue: { amount: { krw: string; usd: string | null } };
  profitLoss: { amount: { krw: string; usd: string | null } };
  dailyProfitLoss: { rate: string };
  items: RawHoldingItem[];
}
interface RawAccount { accountSeq: number; accountType: string }
interface RawOrderbook { asks: { price: string; volume: string }[]; bids: { price: string; volume: string }[] }

const INDEX_NAMES: Record<string, string> = { KOSPI: '코스피', KOSDAQ: '코스닥', KR_BOND_3Y: '국고채 3년' };
const num = (s: string | null | undefined): number => (s == null ? NaN : Number(s));
const day = (iso: string | null | undefined) => (iso ?? '').slice(0, 10);

export class LiveProvider implements MarketProvider {
  readonly kind = 'live' as const;
  private readonly cache = new TtlCache();
  private readonly toss: TossClient;
  private readonly pinnedAccount: number | null;

  constructor(toss: TossClient, pinnedAccount: number | null) {
    this.toss = toss;
    this.pinnedAccount = pinnedAccount;
  }

  // ---- account ------------------------------------------------------------------------
  private async account(): Promise<number> {
    if (this.pinnedAccount !== null) return this.pinnedAccount;
    return this.cache.get('account', 3_600_000, async () => {
      const accounts = await this.toss.get<RawAccount[]>('/api/v1/accounts');
      const brokerage = accounts.find((a) => a.accountType === 'BROKERAGE') ?? accounts[0];
      if (!brokerage) throw new AppError(404, 'no-account', '토스증권 위탁계좌를 찾을 수 없어요');
      return brokerage.accountSeq;
    });
  }

  // ---- reference data -----------------------------------------------------------------
  private async names(symbols: string[]): Promise<Map<string, string>> {
    const key = `names:${[...symbols].sort().join(',')}`;
    return this.cache.get(key, 86_400_000, async () => {
      const rows = await this.toss.get<RawStock[]>('/api/v1/stocks', { symbols: symbols.join(',') });
      return new Map(rows.map((r) => [r.symbol, r.name]));
    });
  }

  /**
   * Previous close, used to compute 등락률. /prices only returns lastPrice, so we read the
   * two most recent daily candles (newest first). If the newest candle is from the same day
   * as the live price, today's session is in progress and the *second* candle is yesterday.
   */
  private async prevClose(symbol: string, priceTimestamp: string | null, indicator = false): Promise<number | null> {
    const path = indicator ? `/api/v1/market-indicators/${symbol}/candles` : '/api/v1/candles';
    const query = indicator ? { interval: '1d', count: 2 } : { symbol, interval: '1d', count: 2 };
    const candles = await this.cache.get(`d1:${symbol}`, 600_000, async () =>
      (await this.toss.get<{ candles: RawCandle[] }>(path, query)).candles,
    );
    if (!candles.length) return null;
    const sameDay = priceTimestamp && day(candles[0].timestamp) === day(priceTimestamp);
    const ref = sameDay ? candles[1] : candles[0];
    return ref ? num(ref.closePrice) : null;
  }

  // ---- MarketProvider -----------------------------------------------------------------
  async indices(): Promise<IndexQuote[]> {
    const symbols = ['KOSPI', 'KOSDAQ', 'KR_BOND_3Y'];
    return this.cache.get('indices', 5_000, async () => {
      const rows = await this.toss.get<RawPrice[]>('/api/v1/market-indicators/prices', { symbols: symbols.join(',') });
      return Promise.all(
        rows.map(async (r): Promise<IndexQuote> => {
          const value = num(r.lastPrice);
          const prev = await this.prevClose(r.symbol, r.timestamp, true).catch(() => null);
          const change = prev ? value - prev : null;
          return {
            symbol: r.symbol,
            name: INDEX_NAMES[r.symbol] ?? r.symbol,
            value,
            change,
            changeRate: prev && change !== null ? change / prev : null,
            unit: r.symbol.startsWith('KR_BOND') ? '%' : 'pt',
          };
        }),
      );
    });
  }

  async quotes(symbols: string[]): Promise<Quote[]> {
    if (!symbols.length) return [];
    const key = `quotes:${symbols.join(',')}`;
    return this.cache.get(key, 2_000, async () => {
      const [rows, names] = await Promise.all([
        this.toss.get<RawPrice[]>('/api/v1/prices', { symbols: symbols.join(',') }),
        this.names(symbols),
      ]);
      return Promise.all(
        rows.map(async (r): Promise<Quote> => {
          const price = num(r.lastPrice);
          const prev = await this.prevClose(r.symbol, r.timestamp).catch(() => null);
          const change = prev ? price - prev : null;
          return {
            symbol: r.symbol,
            name: names.get(r.symbol) ?? r.symbol,
            currency: r.currency,
            price,
            change,
            changeRate: prev && change !== null ? change / prev : null,
          };
        }),
      );
    });
  }

  async board(type: BoardType, market: MarketCountry): Promise<Quote[]> {
    return this.cache.get(`board:${type}:${market}`, 15_000, async () => {
      const res = await this.toss.get<{ rankings: RawRanking[] }>('/api/v1/rankings', {
        type,
        marketCountry: market,
        duration: 'realtime',
        excludeInvestmentCaution: true,
        count: 20,
      });
      const names = await this.names(res.rankings.map((r) => r.symbol));
      return res.rankings.map((r) => {
        const price = num(r.price.lastPrice);
        const base = num(r.price.basePrice);
        return {
          rank: r.rank,
          symbol: r.symbol,
          name: names.get(r.symbol) ?? r.symbol,
          currency: r.currency,
          price,
          change: Number.isFinite(base) ? price - base : null,
          changeRate: r.price.changeRate === null ? null : num(r.price.changeRate),
        };
      });
    });
  }

  async detail(symbol: string): Promise<StockDetail> {
    const acct = await this.account();
    const [quoteList, intraday, book, portfolio, power, sellable] = await Promise.all([
      this.quotes([symbol]),
      this.cache.get(`m1:${symbol}`, 30_000, () =>
        this.toss.get<{ candles: RawCandle[] }>('/api/v1/candles', { symbol, interval: '1m', count: 120 }),
      ),
      this.toss.get<RawOrderbook>('/api/v1/orderbook', { symbol }),
      this.portfolio(),
      this.toss
        .get<{ cashBuyingPower: string }>('/api/v1/buying-power', { currency: marketOf(symbol) === 'KR' ? 'KRW' : 'USD' }, acct)
        .catch(() => null),
      this.toss.get<{ sellableQuantity: string }>('/api/v1/sellable-quantity', { symbol }, acct).catch(() => null),
    ]);
    const quote = quoteList[0];
    if (!quote) throw new AppError(404, 'unknown-symbol', '종목을 찾을 수 없어요');
    return {
      quote,
      spark: intraday.candles.map((c) => num(c.closePrice)).reverse(),
      asks: book.asks.slice(0, 5).map((l) => ({ price: num(l.price), volume: num(l.volume) })),
      bids: book.bids.slice(0, 5).map((l) => ({ price: num(l.price), volume: num(l.volume) })),
      holding: portfolio?.holdings.find((h) => h.symbol === symbol) ?? null,
      buyingPower: power ? num(power.cashBuyingPower) : null,
      sellableQuantity: sellable ? num(sellable.sellableQuantity) : null,
    };
  }

  async portfolio(): Promise<Portfolio | null> {
    const acct = await this.account();
    return this.cache.get('portfolio', 5_000, async () => {
      const raw = await this.toss.get<RawHoldings>('/api/v1/holdings', {}, acct);
      const holdings: Holding[] = raw.items.map((i) => ({
        symbol: i.symbol,
        name: i.name,
        currency: i.currency,
        quantity: num(i.quantity),
        averagePrice: num(i.averagePurchasePrice),
        price: num(i.lastPrice),
        profitLossRate: num(i.profitLoss.rate),
      }));
      return {
        marketValueKrw: num(raw.marketValue.amount.krw),
        marketValueUsd: raw.marketValue.amount.usd === null ? null : num(raw.marketValue.amount.usd),
        profitLossKrw: num(raw.profitLoss.amount.krw),
        dailyProfitLossRate: num(raw.dailyProfitLoss.rate),
        holdings,
      };
    });
  }

  async search(query: string): Promise<{ symbol: string; name: string }[]> {
    // /stocks/all is a daily batch (~30KB gzip per market). Cache the universe for 12h.
    const universe = await this.cache.get('universe', 43_200_000, async () => {
      const markets = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE'];
      const lists = await Promise.all(
        markets.map((market) => this.toss.get<RawListed[]>('/api/v1/stocks/all', { market, commonShare: true })),
      );
      return lists.flat().map((s) => ({ symbol: s.symbol, name: s.name }));
    });
    return rankMatches(universe, query);
  }

  async usdKrw(): Promise<number> {
    return this.cache.get('fx', 60_000, async () => {
      const fx = await this.toss.get<{ rate: string }>('/api/v1/exchange-rate', { baseCurrency: 'USD', quoteCurrency: 'KRW' });
      return num(fx.rate);
    });
  }

  async commissionRate(market: MarketCountry): Promise<number | null> {
    const acct = await this.account();
    const rows = await this.cache.get('commissions', 3_600_000, () =>
      this.toss.get<{ marketCountry: string; commissionRate: string }[]>('/api/v1/commissions', {}, acct),
    );
    const row = rows.find((r) => r.marketCountry === market);
    return row ? num(row.commissionRate) : null;
  }

  async placeOrder(draft: OrderDraft, clientOrderId: string): Promise<OrderResult> {
    const acct = await this.account();
    const body: Record<string, unknown> = {
      clientOrderId,
      symbol: draft.symbol,
      side: draft.side,
      orderType: draft.orderType,
      timeInForce: 'DAY',
      quantity: String(draft.quantity),
    };
    if (draft.orderType === 'LIMIT') body.price = String(draft.price);
    // confirmHighValueOrder is intentionally never sent: orders ≥ 1억 원 are refused by Toss,
    // and our own MAX_ORDER_KRW guard is far below that anyway.
    const res = await this.toss.post<{ orderId: string }>('/api/v1/orders', body, acct);
    return { orderId: res.orderId, simulated: false };
  }
}

/** Shared by live + mock: exact symbol > name prefix > name contains. */
export function rankMatches(universe: { symbol: string; name: string }[], query: string) {
  const q = query.replace(/\s+/g, '').toLowerCase();
  if (!q) return [];
  const scored: { s: { symbol: string; name: string }; score: number }[] = [];
  for (const s of universe) {
    const name = s.name.replace(/\s+/g, '').toLowerCase();
    const sym = s.symbol.toLowerCase();
    let score = 0;
    if (sym === q) score = 100;
    else if (name === q) score = 90;
    else if (name.startsWith(q)) score = 60 - name.length / 100;
    else if (name.includes(q)) score = 30 - name.length / 100;
    else if (sym.startsWith(q)) score = 20;
    if (score > 0) scored.push({ s, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.s);
}
