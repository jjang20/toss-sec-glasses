// 호가: 매도 5호가(위) · 매수 5호가(아래). 2초마다 갱신.
import { Resource } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { money } from '../lib/format.ts';
import { usePoll } from '../lib/usePoll.ts';

export function Orderbook({ symbol }: { symbol: string }) {
  const s = usePoll(`stock:${symbol}`, (sig) => api.stock(symbol, sig), 2_000);
  return (
    <section className="screen" aria-label="호가">
      <header className="screen-head">
        <h1 className="screen-title">{s.data ? `${s.data.quote.name} 호가` : '호가'}</h1>
      </header>
      <div className="screen-body" data-scroll tabIndex={-1}>
        <Resource state={s} skeletonRows={6}>
          {(d) => {
            const c = d.quote.currency;
            const max = Math.max(1, ...d.asks.map((a) => a.volume), ...d.bids.map((b) => b.volume));
            const bar = (v: number, color: string) => ({
              backgroundImage: `linear-gradient(to left, ${color} ${(v / max) * 100}%, transparent 0)`,
            });
            return (
              <div className="book" role="table" aria-label="호가표">
                {[...d.asks].reverse().map((a) => (
                  <div key={`a${a.price}`} role="row" className={`book-row ask${a.price === d.quote.price ? ' last' : ''}`} style={bar(a.volume, 'rgba(69,147,252,.22)')}>
                    <span className="down">{money(a.price, c)}</span>
                    <span className="vol">{a.volume.toLocaleString('ko-KR')}</span>
                  </div>
                ))}
                {d.bids.map((b) => (
                  <div key={`b${b.price}`} role="row" className={`book-row bid${b.price === d.quote.price ? ' last' : ''}`} style={bar(b.volume, 'rgba(246,101,112,.22)')}>
                    <span className="up">{money(b.price, c)}</span>
                    <span className="vol">{b.volume.toLocaleString('ko-KR')}</span>
                  </div>
                ))}
              </div>
            );
          }}
        </Resource>
      </div>
      <div />
    </section>
  );
}
