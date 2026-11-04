// 종목 상세: 현재가 · 등락 · 당일 차트 · 보유 현황 → 판매하기 / 구매하기
import type { ReactNode } from 'react';
import { Change, Resource, Sparkline } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { money, pct, tone } from '../lib/format.ts';
import { usePoll } from '../lib/usePoll.ts';
import { useNav } from '../nav/nav.tsx';
import { VoiceInput } from '../voice/VoiceInput.tsx';

export function Stock({ symbol, badge }: { symbol: string; badge: ReactNode }) {
  const nav = useNav();
  const s = usePoll(`stock:${symbol}`, (sig) => api.stock(symbol, sig), 3_000);
  const name = s.data?.quote.name ?? symbol;

  return (
    <section className="screen" aria-label={`${name} 상세`}>
      <header className="screen-head">
        <h1 className="screen-title">{name}</h1>
        {badge}
        <VoiceInput row="head" />
      </header>
      <div className="screen-body" data-scroll>
        <Resource state={s} skeletonRows={4}>
          {(d) => {
            const q = d.quote;
            const h = d.holding;
            return (
              <>
                <p className="price-hero">{money(q.price, q.currency)}</p>
                <p className="price-change">
                  <span className="row-sub" style={{ font: 'inherit' }}>어제보다 </span>
                  <Change change={q.change} rate={q.changeRate} currency={q.currency} />
                </p>
                <Sparkline points={d.spark} up={tone(q.changeRate) !== 'down'} />
                <dl className="summary">
                  {h && (
                    <div className="kv">
                      <dt>내 주식</dt>
                      <dd>
                        {h.quantity.toLocaleString('ko-KR')}주 · <span className={tone(h.profitLossRate)}>{pct(h.profitLossRate)}</span>
                      </dd>
                    </div>
                  )}
                  {d.buyingPower !== null && (
                    <div className="kv">
                      <dt>주문 가능 금액</dt>
                      <dd>{money(d.buyingPower, q.currency)}</dd>
                    </div>
                  )}
                </dl>
                <div className="segmented" style={{ marginTop: 10 }}>
                  <button type="button" className="seg" data-row="more" data-key="book" onClick={() => nav.push({ name: 'orderbook', symbol })}>
                    호가 보기
                  </button>
                  <button
                    type="button"
                    className="seg"
                    data-row="more"
                    data-key="news"
                    onClick={() => {
                      nav.setNewsQuery(q.name);
                      nav.reset([], 'news');
                    }}
                  >
                    관련 뉴스
                  </button>
                </div>
              </>
            );
          }}
        </Resource>
      </div>
      <div className="dock">
        <button
          type="button"
          className="btn sell"
          data-row="dock"
          data-key="sell"
          disabled={!s.data || !s.data.sellableQuantity}
          onClick={() => nav.push({ name: 'order', symbol, side: 'SELL' })}
        >
          판매하기
        </button>
        <button
          type="button"
          className="btn buy"
          data-row="dock"
          data-key="buy"
          data-autofocus
          disabled={!s.data}
          onClick={() => nav.push({ name: 'order', symbol, side: 'BUY' })}
        >
          구매하기
        </button>
      </div>
    </section>
  );
}
