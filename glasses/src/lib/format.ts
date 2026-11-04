// Number formatting in Toss style: "71,500원", "+1,200원", "+1.7%", "$228.40".
import type { Currency } from './types.ts';

const krw = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dec2 = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function money(value: number, currency: Currency): string {
  if (!Number.isFinite(value)) return '-';
  return currency === 'USD' ? `$${usd.format(value)}` : `${krw.format(value)}원`;
}

export function signedMoney(value: number | null, currency: Currency): string {
  if (value === null || !Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${money(Math.abs(value), currency)}`;
}

export function pct(rate: number | null, withSign = true): string {
  if (rate === null || !Number.isFinite(rate)) return '-';
  const v = rate * 100;
  const sign = withSign && v > 0 ? '+' : '';
  return `${sign}${v.toFixed(v !== 0 && Math.abs(v) < 0.1 ? 2 : 1)}%`;
}

export function indexValue(value: number, unit: 'pt' | '%'): string {
  return unit === '%' ? `${value.toFixed(2)}%` : dec2.format(value);
}

/** Korean market convention: up = red, down = blue. */
export function tone(rate: number | null): 'up' | 'down' | 'flat' {
  if (rate === null || rate === 0 || !Number.isFinite(rate)) return 'flat';
  return rate > 0 ? 'up' : 'down';
}

export function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - Date.parse(iso));
  const m = Math.floor(diff / 60_000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

/** KRX unified tick size (KOSPI/KOSDAQ). Mirrors server/src/providers/mock.ts. */
export function krTick(price: number): number {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function stepPrice(price: number, currency: Currency, dir: 1 | -1): number {
  if (currency === 'USD') return Math.max(0.01, Math.round((price + dir * 0.01) * 100) / 100);
  // Step from the tick that applies on the side we're moving toward, so 2,000 ↓ gives 1,999.
  const tick = dir > 0 ? krTick(price) : krTick(price - 1);
  return Math.max(tick, Math.round(price / tick) * tick + dir * tick);
}
