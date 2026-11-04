// Run: npm test   (uses Node's built-in test runner; no extra dependencies)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCount, parseIntent } from './parse.ts';

test('Korean counts', () => {
  assert.equal(parseCount('10'), 10);
  assert.equal(parseCount('세'), 3);
  assert.equal(parseCount('열다섯'), 15);
  assert.equal(parseCount('스무'), 20);
  assert.equal(parseCount('삼십'), 30);
  assert.equal(parseCount('이십오'), 25);
  assert.equal(parseCount('백'), 100);
  assert.equal(parseCount('바나나'), null);
});

test('buy orders', () => {
  assert.deepEqual(parseIntent('삼성전자 10주 구매'), { kind: 'order', query: '삼성전자', side: 'BUY', quantity: 10, orderType: 'LIMIT' });
  assert.deepEqual(parseIntent('애플 세 주 사줘'), { kind: 'order', query: '애플', side: 'BUY', quantity: 3, orderType: 'LIMIT' });
  assert.deepEqual(parseIntent('엔비디아 시장가로 5주 매수'), { kind: 'order', query: '엔비디아', side: 'BUY', quantity: 5, orderType: 'MARKET' });
  assert.deepEqual(parseIntent('SK하이닉스 열다섯주 매수해줘'), { kind: 'order', query: 'SK하이닉스', side: 'BUY', quantity: 15, orderType: 'LIMIT' });
});

test('sell orders, quantity optional', () => {
  assert.deepEqual(parseIntent('카카오 팔아 2주'), { kind: 'order', query: '카카오', side: 'SELL', quantity: 2, orderType: 'LIMIT' });
  assert.deepEqual(parseIntent('삼성전자 판매'), { kind: 'order', query: '삼성전자', side: 'SELL', quantity: null, orderType: 'LIMIT' });
});

test('navigation and lookup', () => {
  assert.deepEqual(parseIntent('코스피'), { kind: 'home' });
  assert.deepEqual(parseIntent('급상승'), { kind: 'board', type: 'TOP_GAINERS', market: 'KR' });
  assert.deepEqual(parseIntent('해외 급하락 보여줘'), { kind: 'board', type: 'TOP_LOSERS', market: 'US' });
  assert.deepEqual(parseIntent('뉴스'), { kind: 'news', query: null });
  assert.deepEqual(parseIntent('삼성전자 뉴스'), { kind: 'news', query: '삼성전자' });
  assert.deepEqual(parseIntent('테슬라 주가'), { kind: 'stock', query: '테슬라' });
  assert.deepEqual(parseIntent('NAVER'), { kind: 'stock', query: 'NAVER' });
});

test('"주가" is not a quantity, ambiguous buy+sell is not an order', () => {
  assert.equal(parseIntent('삼성전자 주가').kind, 'stock');
  assert.notEqual(parseIntent('삼성전자 사줘 팔아').kind, 'order');
});
