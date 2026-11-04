// News is NOT part of the Toss Securities Open API, so it is a separate, swappable provider.
// - NaverNewsProvider: Naver Search API (news), free tier 25,000 calls/day.
//   https://developers.naver.com/docs/serviceapi/search/news/news.md
// - MockNewsProvider: canned headlines for offline design work.

import type { NewsItem, NewsProvider } from './domain.ts';
import { TtlCache } from './cache.ts';

const ENTITIES: Record<string, string> = { '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&apos;': "'", '&#39;': "'" };
const clean = (s: string) =>
  s.replace(/<[^>]+>/g, '').replace(/&(quot|amp|lt|gt|apos|#39);/g, (m) => ENTITIES[m] ?? m).trim();

export class NaverNewsProvider implements NewsProvider {
  readonly kind = 'naver';
  private readonly cache = new TtlCache();
  private readonly id: string;
  private readonly secret: string;

  constructor(id: string, secret: string) {
    this.id = id;
    this.secret = secret;
  }

  async latest(query = '증시'): Promise<NewsItem[]> {
    return this.cache.get(`news:${query}`, 120_000, async () => {
      const url = new URL('https://openapi.naver.com/v1/search/news.json');
      url.searchParams.set('query', query);
      url.searchParams.set('display', '10');
      url.searchParams.set('sort', 'date');
      const res = await fetch(url, {
        headers: { 'X-Naver-Client-Id': this.id, 'X-Naver-Client-Secret': this.secret },
        signal: AbortSignal.timeout(6_000),
      });
      if (!res.ok) throw new Error(`naver news HTTP ${res.status}`);
      const json = (await res.json()) as {
        items: { title: string; description: string; originallink: string; link: string; pubDate: string }[];
      };
      return json.items.map((it, i) => ({
        id: `${Date.parse(it.pubDate)}-${i}`,
        title: clean(it.title),
        summary: clean(it.description),
        source: sourceOf(it.originallink || it.link),
        publishedAt: new Date(it.pubDate).toISOString(),
        url: it.originallink || it.link,
      }));
    });
  }
}

function sourceOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').split('.')[0] ?? '';
  } catch {
    return '';
  }
}

const MOCK: Omit<NewsItem, 'id' | 'publishedAt'>[] = [
  { title: '외국인 사흘째 순매수…코스피 2,770선 회복', summary: '반도체 대형주 중심으로 외국인 매수세가 이어지며 지수가 강보합으로 마감했다. 기관은 차익 실현에 나섰다.', source: '모의뉴스', url: null },
  { title: 'SK하이닉스, HBM 신규 공급 계약 기대감에 강세', summary: '차세대 고대역폭메모리 공급 확대 전망이 나오면서 장 초반 3% 넘게 올랐다.', source: '모의뉴스', url: null },
  { title: '미 연준 위원 "금리 경로 데이터에 달려"', summary: '연준 인사 발언 이후 달러 강세가 다소 진정되며 원·달러 환율이 1,380원대에서 등락했다.', source: '모의뉴스', url: null },
  { title: '엔비디아, 실적 발표 앞두고 변동성 확대', summary: '옵션 시장에서는 발표 직후 ±8% 수준의 주가 변동을 반영하고 있다.', source: '모의뉴스', url: null },
  { title: '2차전지주 반등…에코프로비엠 5% 상승', summary: '리튬 가격 하락세가 멈췄다는 분석에 낙폭이 컸던 2차전지 종목들이 일제히 반등했다.', source: '모의뉴스', url: null },
  { title: '국고채 3년물 금리 2.8%대 하락', summary: '경기 둔화 우려로 채권 매수세가 유입되며 단기물 중심으로 금리가 내렸다.', source: '모의뉴스', url: null },
];

export class MockNewsProvider implements NewsProvider {
  readonly kind = 'mock';
  async latest(query?: string): Promise<NewsItem[]> {
    const now = Date.now();
    const items = MOCK.map((n, i) => ({ ...n, id: `mock-${i}`, publishedAt: new Date(now - (i * 17 + 4) * 60_000).toISOString() }));
    if (!query || query === '증시') return items;
    const hits = items.filter((n) => n.title.includes(query) || n.summary.includes(query));
    return hits.length ? hits : items.slice(0, 3);
  }
}
