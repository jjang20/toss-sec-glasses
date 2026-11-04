// 뉴스: 최신 증시 뉴스 (BFF → Naver 뉴스 검색 or mock). 핀치하면 요약을 읽을 수 있어요.
import { Resource } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { relativeTime } from '../lib/format.ts';
import { usePoll } from '../lib/usePoll.ts';
import { useNav } from '../nav/nav.tsx';

export function News() {
  const nav = useNav();
  const q = nav.newsQuery;
  const news = usePoll(`news:${q ?? ''}`, (s) => api.news(q ?? undefined, s), 120_000);

  return (
    <>
      {q && (
        <div className="segmented">
          <button type="button" className="seg" data-row="q" data-key="news:all" aria-pressed="true" onClick={() => nav.setNewsQuery(null)}>
            ‘{q}’ 뉴스 · 전체 보기
          </button>
        </div>
      )}
      <Resource state={news} skeletonRows={5}>
        {(items) =>
          items.length ? (
            <div className="list">
              {items.map((n, i) => (
                <button
                  key={n.id}
                  type="button"
                  className="row"
                  data-row={`n${i}`}
                  data-key={`n:${n.id}`}
                  onClick={() => nav.push({ name: 'article', item: n })}
                >
                  <span className="row-main">
                    <span className="row-title news-title">{n.title}</span>
                    <span className="row-sub">
                      {n.source} · {relativeTime(n.publishedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="state">
              <strong>새 뉴스가 없어요</strong>
            </div>
          )
        }
      </Resource>
    </>
  );
}
