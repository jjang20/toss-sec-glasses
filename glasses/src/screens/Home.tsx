// 홈: 지수 3종 · 내 자산 · 보유 종목 · 관심 종목
import { Change, IndexCard, QuoteRow, Resource } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { money, pct, tone } from '../lib/format.ts';
import { usePoll } from '../lib/usePoll.ts';
import { useNav } from '../nav/nav.tsx';

export function Home() {
  const nav = useNav();
  const home = usePoll('home', (s) => api.home(s), 5_000);
  const open = (symbol: string) => nav.push({ name: 'stock', symbol });

  return (
    <Resource state={home} skeletonRows={5}>
      {(d) => {
        const p = d.portfolio;
        // KRW + USD holdings shown as one 원화 figure, the way the Toss app does.
        const usd = p?.marketValueUsd ?? 0;
        const fxTotal = p ? p.marketValueKrw + (d.usdKrw ? usd * d.usdKrw : 0) : 0;
        return (
          <>
            <div className="indices">
              {d.indices.map((i) => (
                <IndexCard key={i.symbol} i={i} />
              ))}
            </div>

            {p && (
              <div className="asset" aria-label="내 투자">
                <div>
                  <div className="asset-label">내 투자</div>
                  <div className="asset-value">{money(Math.round(fxTotal), 'KRW')}</div>
                </div>
                <div className={`row-change ${tone(p.dailyProfitLossRate)}`} style={{ font: 'var(--t-3)' }}>
                  오늘 {pct(p.dailyProfitLossRate)}
                </div>
              </div>
            )}

            {p && p.holdings.length > 0 && (
              <>
                <div className="section-label">내 주식</div>
                <div className="list">
                  {p.holdings.map((h, i) => (
                    <button key={h.symbol} type="button" className="row" data-row={`h${i}`} data-key={`h:${h.symbol}`} onClick={() => open(h.symbol)}>
                      <span className="row-main">
                        <span className="row-title">{h.name}</span>
                        <span className="row-sub">{h.quantity.toLocaleString('ko-KR')}주</span>
                      </span>
                      <span className="row-end">
                        <span className="row-price">{money(h.price * h.quantity, h.currency)}</span>
                        <span className="row-change">
                          <Change change={null} rate={h.profitLossRate} compact />
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="section-label">관심 종목</div>
            <div className="list">
              {d.watchlist.map((q, i) => (
                <QuoteRow key={q.symbol} q={q} row={`w${i}`} onOpen={open} />
              ))}
            </div>
          </>
        );
      }}
    </Resource>
  );
}
