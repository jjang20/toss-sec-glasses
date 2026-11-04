// Small presentational components. Named after their TDS counterparts where one exists.
import { useEffect, useRef, type ReactNode } from 'react';
import { indexValue, money, pct, signedMoney, tone } from '../lib/format.ts';
import type { IndexQuote, Quote } from '../lib/types.ts';
import type { PollState } from '../lib/usePoll.ts';

/** Colored change text: "+1,200원 (1.7%)" in red/blue. */
export function Change({ change, rate, currency, compact }: { change: number | null; rate: number | null; currency?: Quote['currency']; compact?: boolean }) {
  const t = tone(rate);
  if (compact || change === null || !currency) return <span className={t}>{pct(rate)}</span>;
  return (
    <span className={t}>
      {signedMoney(change, currency)} ({pct(rate, false).replace('-', '')})
    </span>
  );
}

/** TDS ListRow for a stock. Focusable; pinch opens the detail screen. */
export function QuoteRow({ q, row, onOpen }: { q: Quote; row: string; onOpen: (symbol: string) => void }) {
  return (
    <button type="button" className="row" data-row={row} data-key={`q:${q.symbol}`} onClick={() => onOpen(q.symbol)}>
      {q.rank !== undefined && <span className="row-rank">{q.rank}</span>}
      <span className="row-main">
        <span className="row-title">{q.name}</span>
      </span>
      <span className="row-end">
        <span className="row-price">{money(q.price, q.currency)}</span>
        <span className="row-change">
          <Change change={q.change} rate={q.changeRate} compact />
        </span>
      </span>
    </button>
  );
}

export function IndexCard({ i }: { i: IndexQuote }) {
  return (
    <div className="index">
      <span className="index-name">{i.name}</span>
      <span className="index-value">{indexValue(i.value, i.unit)}</span>
      <span className="index-change">
        <Change change={i.change} rate={i.changeRate} compact />
      </span>
    </div>
  );
}

/** Intraday line. Colored by direction vs the first point; a dashed baseline anchors it. */
export function Sparkline({ points, up }: { points: number[]; up: boolean }) {
  if (points.length < 2) return <div className="spark" />;
  const W = 552, H = 120, P = 6;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * W, P + (1 - (v - min) / span) * (H - P * 2)] as const);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const base = P + (1 - (points[0]! - min) / span) * (H - P * 2);
  const color = up ? 'var(--up)' : 'var(--down)';
  const last = xy[xy.length - 1]!;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2={W} y1={base} y2={base} stroke="var(--grey-700)" strokeDasharray="4 6" strokeWidth="1.5" />
      <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="5" fill={color} />
    </svg>
  );
}

/** Wraps a polled resource with consistent loading / error / offline / stale states. */
export function Resource<T>({ state, children, skeletonRows = 4 }: { state: PollState<T>; children: (data: T) => ReactNode; skeletonRows?: number }) {
  if (state.data !== null) {
    return (
      <>
        {state.stale && <p className="stale">마지막 업데이트 이후 연결이 불안정해요</p>}
        {children(state.data)}
      </>
    );
  }
  if (state.error) return <ErrorState code={state.error.code} message={state.error.message} onRetry={state.reload} />;
  return (
    <div aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: skeletonRows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function ErrorState({ code, message, onRetry }: { code: string; message: string; onRetry?: () => void }) {
  const title = code === 'offline' ? '연결이 끊겼어요' : code === 'unauthorized' ? '기기 연결이 필요해요' : '불러오지 못했어요';
  const body =
    code === 'unauthorized' ? '휴대폰에서 페어링 링크(#pair=…)로 앱을 한 번 열어주세요' : code === 'offline' ? '휴대폰 연결을 확인해 주세요' : message;
  return (
    <div className="state" role="alert">
      <strong>{title}</strong>
      <span>{body}</span>
      {onRetry && code !== 'unauthorized' && (
        <button type="button" className="btn" data-row="retry" data-autofocus style={{ flex: 'none', minWidth: 200 }} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

/** Calls `onAdjust(±1)` when the focus engine sends ←/→ to this element. */
export function useAdjust<T extends HTMLElement>(onAdjust: (dir: 1 | -1) => void) {
  const ref = useRef<T>(null);
  const cb = useRef(onAdjust);
  cb.current = onAdjust;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = (e: Event) => cb.current((e as CustomEvent<1 | -1>).detail);
    el.addEventListener('nav-adjust', h);
    return () => el.removeEventListener('nav-adjust', h);
  }, []);
  return ref;
}
