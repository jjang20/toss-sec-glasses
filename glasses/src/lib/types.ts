// Mirrors server/src/domain.ts (the BFF contract). Kept as a copy on purpose: the glasses
// bundle must not import server code. If the contract grows, promote it to a shared package.

export type Currency = 'KRW' | 'USD';
export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type BoardType = 'MARKET_TRADING_AMOUNT' | 'TOP_GAINERS' | 'TOP_LOSERS';
export type MarketCountry = 'KR' | 'US';

export interface Quote {
  symbol: string;
  name: string;
  currency: Currency;
  price: number;
  change: number | null;
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

export interface Holding {
  symbol: string;
  name: string;
  currency: Currency;
  quantity: number;
  averagePrice: number;
  price: number;
  profitLossRate: number | null;
}

export interface Portfolio {
  marketValueKrw: number;
  marketValueUsd: number | null;
  profitLossKrw: number;
  dailyProfitLossRate: number | null;
  holdings: Holding[];
}

export interface StockDetail {
  quote: Quote;
  spark: number[];
  asks: { price: number; volume: number }[];
  bids: { price: number; volume: number }[];
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
  preview: OrderPreview;
}

export interface Health {
  mode: 'mock' | 'live';
  news: string;
  tradingEnabled: boolean;
  maxOrderKrw: number;
}

export interface HomeData {
  indices: IndexQuote[];
  watchlist: Quote[];
  portfolio: Portfolio | null;
  /** 1 USD in KRW (Toss reference rate). null if unavailable. */
  usdKrw: number | null;
}
