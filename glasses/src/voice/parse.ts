// Voice / handwriting command → intent. Pure function, no I/O, fully unit-tested.
//
// Examples the wearer can say (or scribble on the Neural Band):
//   "삼성전자 10주 구매" / "애플 세 주 사줘" / "엔비디아 시장가로 5주 매수"
//   "카카오 팔아 2주" / "삼성전자 판매"
//   "SK하이닉스" / "테슬라 주가"
//   "코스피" / "홈" · "급상승" / "급하락" / "거래대금" / "해외 급상승" · "뉴스" / "삼성전자 뉴스"
//
// The parser only produces an *intent*. An order intent always lands on the order screen
// for a pinch-to-confirm step — voice can never place an order on its own.

import type { BoardType, MarketCountry, OrderType, Side } from '../lib/types.ts';

export type Intent =
  | { kind: 'order'; query: string; side: Side; quantity: number | null; orderType: OrderType }
  | { kind: 'stock'; query: string }
  | { kind: 'news'; query: string | null }
  | { kind: 'board'; type: BoardType; market: MarketCountry }
  | { kind: 'home' }
  | { kind: 'unknown'; text: string };

const BUY = /(구매|매수|사줘|사 ?줘|살래|사기|사$|사\s|매입|담아)/;
const SELL = /(판매|매도|팔아|팔래|팔기|팔$|팔\s|처분|정리해)/;

const NATIVE_UNITS: Record<string, number> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 석: 3, 네: 4, 넷: 4, 너: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
};
const NATIVE_TENS: Record<string, number> = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50 };
const SINO: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };

/** "10", "열다섯", "스무", "세", "삼십", "백" → number. */
export function parseCount(word: string): number | null {
  const w = word.replace(/\s+/g, '').replace(/,/g, '');
  if (/^\d+$/.test(w)) return Number(w);
  // native Korean: (tens)?(units)?
  const nm = /^(열|스물|스무|서른|마흔|쉰)?(한|하나|두|둘|세|셋|석|네|넷|너|다섯|여섯|일곱|여덟|아홉)?$/.exec(w);
  if (nm && (nm[1] || nm[2])) return (nm[1] ? NATIVE_TENS[nm[1]]! : 0) + (nm[2] ? NATIVE_UNITS[nm[2]]! : 0);
  // sino-Korean up to 999: (d백)?(d십)?(d)?
  const sm = /^(?:([이삼사오육칠팔구])?백)?(?:([이삼사오육칠팔구])?십)?([일이삼사오육칠팔구])?$/.exec(w);
  if (sm && w.length) {
    const hasHundred = w.includes('백');
    const hasTen = w.includes('십');
    return (hasHundred ? (sm[1] ? SINO[sm[1]]! : 1) * 100 : 0) + (hasTen ? (sm[2] ? SINO[sm[2]]! : 1) * 10 : 0) + (sm[3] ? SINO[sm[3]]! : 0);
  }
  return null;
}

const COUNT_TOKEN =
  '(\\d[\\d,]*|(?:열|스물|스무|서른|마흔|쉰)?(?:한|하나|두|둘|세|셋|석|네|넷|너|다섯|여섯|일곱|여덟|아홉)?|(?:[이삼사오육칠팔구]?백)?(?:[이삼사오육칠팔구]?십)?[일이삼사오육칠팔구]?)';
const QTY = new RegExp(`${COUNT_TOKEN}\\s*주(?![가식])`);

export function parseIntent(raw: string): Intent {
  const text = raw.trim().replace(/[.,!?。]+$/g, '').replace(/\s+/g, ' ');
  if (!text) return { kind: 'unknown', text: raw };
  const compact = text.replace(/\s+/g, '');

  // --- orders ---
  const isBuy = BUY.test(text);
  const isSell = SELL.test(text);
  if (isBuy !== isSell) {
    const side: Side = isBuy ? 'BUY' : 'SELL';
    const orderType: OrderType = /시장가/.test(compact) ? 'MARKET' : 'LIMIT';
    const qm = QTY.exec(text);
    const quantity = qm && qm[1] ? parseCount(qm[1]) : null;
    const query = text
      .replace(QTY, ' ')
      .replace(BUY, ' ')
      .replace(SELL, ' ')
      .replace(/(시장가|지정가|현재가)(로|에)?/g, ' ')
      .replace(/(을|를|좀|주식|해줘|해 줘|해)\s*$/g, '')
      .replace(/\s+(을|를|좀|주식)\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/(을|를)$/, '');
    if (query) return { kind: 'order', query, side, quantity: quantity && quantity > 0 ? quantity : null, orderType };
  }

  // --- navigation ---
  if (/^(홈|처음|메인|코스피|코스닥|지수|내자산|자산)(으로|화면)?(가줘|보여줘)?$/.test(compact)) return { kind: 'home' };
  const market: MarketCountry = /(해외|미국|나스닥|us)/i.test(compact) ? 'US' : 'KR';
  if (/급상승|상승률|많이오른|오른종목/.test(compact)) return { kind: 'board', type: 'TOP_GAINERS', market };
  if (/급하락|하락률|많이내린|내린종목/.test(compact)) return { kind: 'board', type: 'TOP_LOSERS', market };
  if (/거래대금|인기|많이거래|시장|랭킹|순위/.test(compact)) return { kind: 'board', type: 'MARKET_TRADING_AMOUNT', market };

  // --- news ---
  if (/뉴스|소식|기사/.test(compact)) {
    const q = text.replace(/(관련|최신|오늘)?\s*(뉴스|소식|기사).*$/, '').trim();
    return { kind: 'news', query: q || null };
  }

  // --- stock lookup ---
  const query = text.replace(/\s*(주가|시세|현재가|얼마|어때|보여줘|알려줘|찾아줘|검색)+.*$/, '').trim();
  if (query) return { kind: 'stock', query };
  return { kind: 'unknown', text };
}
