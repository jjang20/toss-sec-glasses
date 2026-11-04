// The shapes the glasses app consumes. These are deliberately smaller and flatter than
// the raw Toss responses: the glasses link is ~500 Kbps, so every byte counts, and the
// UI should never have to do finance math itself.

export type Currency = 'KRW' | 'USD';
export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';

export interface Quote {
  symbol: string;
  name: string;
  currency: Currency;
  price: number;
  /** Absolute change vs previous close. null when unknown (e.g. no prior candle). */
  change: number | null;
  /** Ratio, 0.0125 = +1.25%. */
  changeRate: number | null;
  rank?: number;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  value: number;
  change: number | null;
  changeRate: number | null;
  unit: 'pt' | '%';
}

export interface Portfolio {
  marketValueKrw: number;
  marketValueUsd: number | null;
  profitLossKrw: number;
  dailyProfitLossRate: number | null;
  holdings: Holding[];
}

export interface Holding {
  symbol: string;
  name: string;
  currency: Currency;
  quantity: number;
  averagePrice: number;
  price: number;
  profitLossRate: number | null;
}

export interface OrderbookLevel {
  price: number;
  volume: number;
}

export interface StockDetail {
  quote: Quote;
  /** Intraday closes, oldest first, for the sparkline. */
  spark: number[];
  asks: OrderbookLevel[];
  bids: OrderbookLevel[];
  holding: Holding | null;
  buyingPower: number | null;
  sellableQuantity: number | null;
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  url: string | null;
}

export interface OrderDraft {
  symbol: string;
  side: Side;
  orderType: OrderType;
  quantity: number;
  /** Required for LIMIT, forbidden for MARKET. */
  price?: number;
}

export interface OrderPreview {
  ticket: string;
  draft: OrderDraft;
  name: string;
  currency: Currency;
  estimatedAmount: number;
  estimatedAmountKrw: number;
  commissionRate: number | null;
  expiresAt: string;
  warnings: string[];
}

export interface OrderResult {
  orderId: string;
  simulated: boolean;
}

export type BoardType = 'MARKET_TRADING_AMOUNT' | 'TOP_GAINERS' | 'TOP_LOSERS';
export type MarketCountry = 'KR' | 'US';

/** Everything the HTTP layer needs. Implemented by the live (Toss) and mock providers. */
export interface MarketProvider {
  readonly kind: 'live' | 'mock';
  indices(): Promise<IndexQuote[]>;
  quotes(symbols: string[]): Promise<Quote[]>;
  board(type: BoardType, market: MarketCountry): Promise<Quote[]>;
  detail(symbol: string): Promise<StockDetail>;
  portfolio(): Promise<Portfolio | null>;
  search(query: string): Promise<{ symbol: string; name: string }[]>;
  usdKrw(): Promise<number>;
  commissionRate(market: MarketCountry): Promise<number | null>;
  placeOrder(draft: OrderDraft, clientOrderId: string): Promise<OrderResult>;
}

export interface NewsProvider {
  readonly kind: string;
  latest(query?: string): Promise<NewsItem[]>;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function marketOf(symbol: string): MarketCountry {
  // KRX symbols are 6 chars starting with a digit (005930, 0101N0); US tickers are letters.
  return /^\d/.test(symbol) ? 'KR' : 'US';
}
