// 주문: ① 입력(유형·수량·가격) → ② 확인(서버가 발급한 주문 티켓) → ③ 완료
//
// Safety on glasses, in layers:
//  - Voice can pre-fill this screen, but only a pinch on the final button sends the order.
//  - The final button "arms" for ARM_MS after appearing. A pinch that was meant for the
//    previous button (double-pinch, EMG misfire) lands while it's unarmed and is ignored.
//  - The server stores the previewed order under a ticket; confirming sends the ticket only.
//    Re-pinching after success replays the same result instead of ordering twice.

import { useEffect, useState, type ReactNode } from 'react';
import { Resource, useAdjust } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { money, stepPrice } from '../lib/format.ts';
import type { OrderPreview, OrderResult, OrderType, Side, StockDetail } from '../lib/types.ts';
import { usePoll } from '../lib/usePoll.ts';
import { useBack, useNav, type Route } from '../nav/nav.tsx';

const ARM_MS = 900;
type Step = 'form' | 'confirm' | 'done';

export function Order({ route, badge }: { route: Extract<Route, { name: 'order' }>; badge: ReactNode }) {
  const nav = useNav();
  const detail = usePoll(`stock:${route.symbol}`, (s) => api.stock(route.symbol, s), 3_000);
  const [step, setStep] = useState<Step>('form');
  const [orderType, setOrderType] = useState<OrderType>(route.orderType ?? 'LIMIT');
  const [quantity, setQuantity] = useState(route.quantity ?? 1);
  const [price, setPrice] = useState<number | null>(null);
  const [preview, setPreview] = useState<OrderPreview | null>(null);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Seed the limit price with the live price once, then leave it to the wearer.
  useEffect(() => {
    if (price === null && detail.data) setPrice(detail.data.quote.price);
  }, [detail.data, price]);

  useBack(() => {
    if (step === 'confirm') {
      go('form', 'next');
      return true;
    }
    return false;
  });

  const verb = route.side === 'BUY' ? '구매' : '판매';
  const go = (next: Step, focusKey: string | null = null) => {
    nav.refocus(focusKey);
    setStep(next);
  };

  async function submitPreview() {
    if (!detail.data || busy) return;
    setBusy(true);
    try {
      const p = await api.previewOrder({
        symbol: route.symbol,
        side: route.side,
        orderType,
        quantity,
        ...(orderType === 'LIMIT' ? { price: price ?? detail.data.quote.price } : {}),
      });
      setPreview(p);
      go('confirm');
    } catch (e) {
      nav.toast(e instanceof ApiError ? e.message : '주문을 확인하지 못했어요');
    } finally {
      setBusy(false);
    }
  }

  async function submitOrder() {
    if (!preview || busy) return;
    setBusy(true);
    try {
      setResult(await api.placeOrder(preview.ticket));
      go('done');
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      nav.toast(err?.message ?? '주문하지 못했어요');
      if (err && (err.code === 'ticket-expired' || err.code === 'ticket-not-found')) go('form', 'next');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="screen" aria-label={`${verb} 주문`}>
      <header className="screen-head">
        <h1 className="screen-title">{detail.data?.quote.name ?? route.symbol}</h1>
        {badge}
      </header>
      {step === 'form' && (
        <Form
          state={detail}
          side={route.side}
          orderType={orderType}
          setOrderType={setOrderType}
          quantity={quantity}
          setQuantity={setQuantity}
          price={price}
          setPrice={setPrice}
          busy={busy}
          onNext={submitPreview}
        />
      )}
      {step === 'confirm' && preview && <Confirm key={preview.ticket} p={preview} busy={busy} onConfirm={submitOrder} onCancel={() => go('form', 'next')} />}
      {step === 'done' && result && <Done r={result} onClose={nav.pop} />}
    </section>
  );
}

// ---- ① Form --------------------------------------------------------------------------
function Form(props: {
  state: ReturnType<typeof usePoll<StockDetail>>;
  side: Side;
  orderType: OrderType;
  setOrderType: (t: OrderType) => void;
  quantity: number;
  setQuantity: (n: number) => void;
  price: number | null;
  setPrice: (n: number) => void;
  busy: boolean;
  onNext: () => void;
}) {
  const { state, side, orderType, quantity, price } = props;
  const d = state.data;
  const verb = side === 'BUY' ? '구매' : '판매';
  const maxQty = side === 'SELL' ? (d?.sellableQuantity ?? 0) : 10_000;

  const qtyRef = useAdjust<HTMLButtonElement>((dir) => props.setQuantity(Math.min(maxQty || 1, Math.max(1, quantity + dir))));
  const priceRef = useAdjust<HTMLButtonElement>((dir) => {
    if (d && price !== null) props.setPrice(stepPrice(price, d.quote.currency, dir));
  });

  return (
    <>
      <div className="screen-body" data-scroll>
        <Resource state={state} skeletonRows={4}>
          {(d) => {
            const c = d.quote.currency;
            const unit = orderType === 'LIMIT' ? (price ?? d.quote.price) : d.quote.price;
            return (
              <>
                <p className="question">몇 주 {verb}할까요?</p>
                <div className="segmented" role="group" aria-label="주문 유형">
                  {(['LIMIT', 'MARKET'] as const).map((t) => (
                    <button key={t} type="button" className="seg" data-row="otype" data-key={`ot:${t}`} aria-pressed={orderType === t} onClick={() => props.setOrderType(t)}>
                      {t === 'LIMIT' ? '지정가' : '시장가'}
                    </button>
                  ))}
                </div>
                <button
                  ref={qtyRef}
                  type="button"
                  className="stepper"
                  data-row="qty"
                  data-key="qty"
                  data-adjust
                  data-autofocus
                  aria-label={`수량 ${quantity}주. 좌우로 조절`}
                >
                  <span className="stepper-label">수량</span>
                  <span className="stepper-value">
                    <span className="stepper-arrow">‹</span>
                    {quantity.toLocaleString('ko-KR')}주<span className="stepper-arrow">›</span>
                  </span>
                </button>
                {orderType === 'LIMIT' && (
                  <button
                    ref={priceRef}
                    type="button"
                    className="stepper"
                    data-row="price"
                    data-key="price"
                    data-adjust
                    aria-label={`가격 ${money(unit, c)}. 좌우로 한 호가씩 조절`}
                  >
                    <span className="stepper-label">가격</span>
                    <span className="stepper-value">
                      <span className="stepper-arrow">‹</span>
                      {money(unit, c)}
                      <span className="stepper-arrow">›</span>
                    </span>
                  </button>
                )}
                <dl className="summary">
                  <div className="kv">
                    <dt>예상 금액</dt>
                    <dd>{money(Math.round(unit * quantity * 100) / 100, c)}</dd>
                  </div>
                  <div className="kv">
                    <dt>{side === 'BUY' ? '주문 가능 금액' : '판매 가능 수량'}</dt>
                    <dd>
                      {side === 'BUY'
                        ? d.buyingPower === null
                          ? '-'
                          : money(d.buyingPower, c)
                        : `${(d.sellableQuantity ?? 0).toLocaleString('ko-KR')}주`}
                    </dd>
                  </div>
                </dl>
              </>
            );
          }}
        </Resource>
      </div>
      <div className="dock">
        <button
          type="button"
          className={`btn ${side === 'BUY' ? 'buy' : 'sell'}`}
          data-row="dock"
          data-key="next"
          disabled={!d || props.busy}
          onClick={props.onNext}
        >
          {props.busy ? '확인 중…' : '다음'}
        </button>
      </div>
    </>
  );
}

// ---- ② Confirm -----------------------------------------------------------------------
function Confirm({ p, busy, onConfirm, onCancel }: { p: OrderPreview; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), ARM_MS);
    return () => window.clearTimeout(t);
  }, []);
  const c = p.currency;
  const verb = p.draft.side === 'BUY' ? '구매' : '판매';
  const priceText = p.draft.orderType === 'MARKET' ? '시장가' : money(p.draft.price!, c);

  return (
    <>
      <div className="screen-body" data-scroll>
        <p className="question">
          {p.name} {p.draft.quantity.toLocaleString('ko-KR')}주를
          <br />
          {priceText}
          {p.draft.orderType === 'MARKET' ? '로' : '에'} {verb}할까요?
        </p>
        <dl className="summary">
          <div className="kv">
            <dt>예상 금액</dt>
            <dd>{money(p.estimatedAmount, c)}</dd>
          </div>
          {c === 'USD' && (
            <div className="kv">
              <dt>원화 환산</dt>
              <dd>약 {money(p.estimatedAmountKrw, 'KRW')}</dd>
            </div>
          )}
          {p.commissionRate !== null && (
            <div className="kv">
              <dt>수수료율</dt>
              <dd>{(p.commissionRate * 100).toFixed(3)}%</dd>
            </div>
          )}
        </dl>
        {p.warnings.map((w) => (
          <p key={w} className="warn">
            {w}
          </p>
        ))}
      </div>
      <div className="dock">
        <button type="button" className="btn" data-row="dock" data-key="cancel" onClick={onCancel} style={{ flex: '0 0 40%' }}>
          취소
        </button>
        <button
          type="button"
          className={`btn ${p.draft.side === 'BUY' ? 'buy' : 'sell'}`}
          data-row="dock"
          data-key="confirm"
          data-autofocus
          aria-disabled={!armed || busy}
          onClick={() => armed && !busy && onConfirm()}
          style={{ ['--arm-ms' as string]: `${ARM_MS}ms` }}
        >
          {busy ? '주문 중…' : `${verb}하기`}
          {!armed && <span className="arming" aria-hidden="true" />}
        </button>
      </div>
    </>
  );
}

// ---- ③ Done --------------------------------------------------------------------------
function Done({ r, onClose }: { r: OrderResult; onClose: () => void }) {
  const verb = r.preview.draft.side === 'BUY' ? '구매' : '판매';
  return (
    <>
      <div className="screen-body" data-scroll>
        <div className="result" role="status">
          <div className="result-icon" aria-hidden="true">
            ✓
          </div>
          <p className="question" style={{ margin: 0 }}>
            {r.simulated ? '모의 ' : ''}
            {verb} 주문을 넣었어요
          </p>
          <span className="row-sub">
            {r.preview.name} {r.preview.draft.quantity}주 · 주문번호 {r.orderId}
          </span>
          <span className="row-sub">체결 여부는 토스증권 앱 주문내역에서 확인할 수 있어요</span>
        </div>
      </div>
      <div className="dock">
        <button type="button" className="btn primary" data-row="dock" data-key="done" data-autofocus onClick={onClose}>
          확인
        </button>
      </div>
    </>
  );
}
