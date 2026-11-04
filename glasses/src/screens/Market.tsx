// 시장: 국내/해외 × 거래대금/급상승/급하락 랭킹 보드 (Toss GET /api/v1/rankings)
import { QuoteRow, Resource } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import type { BoardType, MarketCountry } from '../lib/types.ts';
import { usePoll } from '../lib/usePoll.ts';
import { useNav } from '../nav/nav.tsx';

const TYPES: { id: BoardType; label: string }[] = [
  { id: 'MARKET_TRADING_AMOUNT', label: '거래대금' },
  { id: 'TOP_GAINERS', label: '급상승' },
  { id: 'TOP_LOSERS', label: '급하락' },
];
const MARKETS: { id: MarketCountry; label: string }[] = [
  { id: 'KR', label: '국내' },
  { id: 'US', label: '해외' },
];

export function Market() {
  const nav = useNav();
  const { type, market } = nav.board;
  const board = usePoll(`board:${type}:${market}`, (s) => api.board(type, market, s), 15_000);

  return (
    <>
      <div className="segmented" role="group" aria-label="시장">
        {MARKETS.map((m) => (
          <button
            key={m.id}
            type="button"
            className="seg"
            data-row="mkt"
            data-key={`mkt:${m.id}`}
            aria-pressed={market === m.id}
            onClick={() => nav.setBoard({ type, market: m.id })}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="segmented" role="group" aria-label="순위 기준" style={{ marginTop: -4 }}>
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="seg"
            data-row="type"
            data-key={`type:${t.id}`}
            aria-pressed={type === t.id}
            onClick={() => nav.setBoard({ type: t.id, market })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Resource state={board} skeletonRows={4}>
        {(rows) =>
          rows.length ? (
            <div className="list">
              {rows.map((q, i) => (
                <QuoteRow key={q.symbol} q={q} row={`r${i}`} onOpen={(symbol) => nav.push({ name: 'stock', symbol })} />
              ))}
            </div>
          ) : (
            <div className="state">
              <strong>지금은 순위가 없어요</strong>
              <span>장이 열리면 다시 보여드릴게요</span>
            </div>
          )
        }
      </Resource>
    </>
  );
}
