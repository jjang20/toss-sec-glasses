// 뉴스 요약 읽기. 포커스 대상이 없는 화면이라 ↑/↓는 스크롤, 뒤로 제스처로 닫아요.
import { relativeTime } from '../lib/format.ts';
import type { NewsItem } from '../lib/types.ts';

export function Article({ item }: { item: NewsItem }) {
  return (
    <section className="screen" aria-label="뉴스">
      <header className="screen-head">
        <span className="badge">{item.source}</span>
        <span className="row-sub">{relativeTime(item.publishedAt)}</span>
      </header>
      <div className="screen-body article" data-scroll tabIndex={-1}>
        <h2>{item.title}</h2>
        <p>{item.summary}</p>
        {item.url && <p className="row-sub">원문은 휴대폰에서 확인해 주세요</p>}
      </div>
      <div />
    </section>
  );
}
