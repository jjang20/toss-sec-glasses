// Voice & handwriting entry point.
//
// On Ray-Ban Display, focusing + pinching a plain <input type="text"> opens the system
// composer (voice dictation or Neural Band handwriting). No SDK call needed — we just read
// the committed text from the `change` event and hand it to the intent parser.
//
// On a desktop browser (development), press "v" anywhere to dictate via the Web Speech API
// if the browser supports it, or focus the mic and type a command + Enter.

import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { useNav } from '../nav/nav.tsx';
import { parseIntent } from './parse.ts';

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: { 0: { transcript: string } }[] }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
};

export function VoiceInput({ row = 'tabs' }: { row?: string }) {
  const nav = useNav();
  const ref = useRef<HTMLInputElement>(null);
  const [listening, setListening] = useState(false);
  const run = useRef<(text: string) => void>(() => {});

  run.current = async (text: string) => {
    const intent = parseIntent(text);
    nav.toast(`“${text.trim()}”`);
    try {
      switch (intent.kind) {
        case 'home':
          return nav.reset([], 'home');
        case 'board':
          nav.setBoard({ type: intent.type, market: intent.market });
          return nav.reset([], 'market');
        case 'news':
          nav.setNewsQuery(intent.query);
          return nav.reset([], 'news');
        case 'stock':
        case 'order': {
          const [hit] = await api.search(intent.query);
          if (!hit) return nav.toast(`‘${intent.query}’ 종목을 찾지 못했어요`);
          if (intent.kind === 'stock') return nav.reset([{ name: 'stock', symbol: hit.symbol }]);
          // Order intents ALWAYS open the order screen for a pinch-to-confirm step.
          nav.reset([
            { name: 'stock', symbol: hit.symbol },
            { name: 'order', symbol: hit.symbol, side: intent.side, quantity: intent.quantity ?? 1, orderType: intent.orderType },
          ]);
          return nav.toast(`${hit.name} ${intent.quantity ?? 1}주 ${intent.side === 'BUY' ? '구매' : '판매'} 주문을 준비했어요`);
        }
        default:
          return nav.toast('다시 말씀해 주세요. 예: “삼성전자 10주 구매”');
      }
    } catch {
      nav.toast('명령을 처리하지 못했어요');
    }
  };

  // Native `change` = the composer committed text (or Enter on desktop).
  useEffect(() => {
    const el = ref.current!;
    const onChange = () => {
      const v = el.value;
      el.value = '';
      if (v.trim()) run.current(v);
    };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  // Desktop-only dictation shortcut.
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'v' || document.activeElement === ref.current) return;
      const rec = new Ctor();
      rec.lang = 'ko-KR';
      rec.interimResults = false;
      rec.onresult = (ev) => run.current(ev.results[0]![0].transcript);
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      setListening(true);
      rec.start();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <input
      ref={ref}
      type="text"
      className={`voice${listening ? ' listening' : ''}`}
      data-row={row}
      data-key="voice"
      aria-label="말하거나 손글씨로 명령하기"
      placeholder="명령"
      enterKeyHint="go"
      autoComplete="off"
    />
  );
}
