// App shell: tab state, a stack of pushed screens, and the Neural Band key router.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './lib/api.ts';
import type { Health } from './lib/types.ts';
import { focusFirst, moveFocus, syncOffscreen } from './nav/focus.ts';
import { NavContext, type BoardSel, type Nav, type Route, type Tab } from './nav/nav.tsx';
import { Article } from './screens/Article.tsx';
import { Home } from './screens/Home.tsx';
import { Market } from './screens/Market.tsx';
import { News } from './screens/News.tsx';
import { Order } from './screens/Order.tsx';
import { Orderbook } from './screens/Orderbook.tsx';
import { Stock } from './screens/Stock.tsx';
import { VoiceInput } from './voice/VoiceInput.tsx';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: '홈' },
  { id: 'market', label: '시장' },
  { id: 'news', label: '뉴스' },
];

export default function App() {
  const [tab, setTabState] = useState<Tab>('home');
  const [stack, setStack] = useState<Route[]>([]);
  const [board, setBoard] = useState<BoardSel>({ type: 'MARKET_TRADING_AMOUNT', market: 'KR' });
  const [newsQuery, setNewsQuery] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const backHandler = useRef<(() => boolean) | null>(null);
  /** data-key to re-focus on each stack level when we come back to it. */
  const returnKeys = useRef<(string | null)[]>([]);
  const pendingFocus = useRef<{ key: string | null } | null>({ key: null });
  const toastTimer = useRef<number>(undefined);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 2600);
  }, []);

  const activeKey = () => (document.activeElement as HTMLElement | null)?.dataset?.key ?? null;

  const nav: Nav = useMemo(
    () => ({
      tab,
      setTab: (t) => {
        pendingFocus.current = { key: null }; // land in the new tab's content
        setTabState(t);
      },
      push: (r) => {
        returnKeys.current.push(activeKey());
        pendingFocus.current = { key: null };
        setStack((s) => [...s, r]);
      },
      pop: () => {
        pendingFocus.current = { key: returnKeys.current.pop() ?? null };
        setStack((s) => s.slice(0, -1));
      },
      reset: (routes, t) => {
        returnKeys.current = routes.map(() => null);
        pendingFocus.current = { key: null };
        if (t) setTabState(t);
        setStack(routes);
      },
      board,
      setBoard,
      newsQuery,
      setNewsQuery,
      toast,
      health,
      backHandler,
      refocus: (key = null) => {
        pendingFocus.current = { key };
      },
    }),
    [tab, board, newsQuery, toast, health],
  );

  // Move focus after navigation; and again when async content first renders focusables.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      if (!pendingFocus.current) return;
      const { key } = pendingFocus.current;
      if (key && root.querySelector(`[data-key="${CSS.escape(key)}"]`)) {
        focusFirst(root, key);
        pendingFocus.current = null;
        return;
      }
      const auto = root.querySelector<HTMLElement>('[data-autofocus][data-row]:not([disabled])');
      if (auto) {
        auto.focus({ preventScroll: true });
        auto.scrollIntoView({ block: 'nearest' });
        pendingFocus.current = null;
        return;
      }
      const content = root.querySelector<HTMLElement>('[data-scroll]');
      const target = content?.querySelector('[data-row]') ? content : null;
      if (target) {
        focusFirst(target);
        pendingFocus.current = null;
      } else if (!root.contains(document.activeElement)) {
        // Content not loaded yet: park focus in the header so input is never lost.
        focusFirst(root);
      }
    };
    const onChange = () => {
      apply();
      syncOffscreen(root);
    };
    onChange();
    const mo = new MutationObserver(onChange);
    mo.observe(root, { childList: true, subtree: true });
    const onScroll = () => syncOffscreen(root);
    root.addEventListener('scroll', onScroll, true);
    return () => {
      mo.disconnect();
      root.removeEventListener('scroll', onScroll, true);
    };
  }, [tab, stack.length]);

  // Neural Band router. Thumb swipe → arrows, pinch → Enter (native click), back → Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.key === 'Escape') {
        if (backHandler.current?.()) return e.preventDefault();
        if (stack.length) {
          e.preventDefault();
          return nav.pop();
        }
        if (tab !== 'home') {
          e.preventDefault();
          return nav.setTab('home');
        }
        return; // at home root: let the system handle "back" (exit app)
      }
      if (!e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const r = moveFocus(root, e.key);
      if (!r.handled && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        // Screens without focus stops (article, orderbook) scroll instead.
        root.querySelector<HTMLElement>('[data-scroll]')?.scrollBy({ top: e.key === 'ArrowDown' ? 120 : -120 });
      }
      if (r.swipe && !stack.length) {
        const i = TABS.findIndex((t) => t.id === tab);
        const next = TABS[i + (r.swipe === 'right' ? 1 : -1)];
        if (next) {
          pendingFocus.current = { key: null }; // land in content, not on the tab
          setTabState(next.id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nav, stack.length, tab]);

  const top = stack[stack.length - 1];
  const modeBadge = health && (
    <span className={`badge${health.mode === 'live' ? ' live' : ''}`}>{health.mode === 'live' ? '실계좌' : '모의'}</span>
  );

  return (
    <NavContext.Provider value={nav}>
      <div ref={rootRef} style={{ position: 'absolute', inset: 0 }}>
        {top ? (
          <StackScreen route={top} badge={modeBadge} key={stack.length} />
        ) : (
          <section className="screen" aria-label="토스증권 글래스">
            <header className="screen-head">
              <nav className="tabs" role="tablist" aria-label="메뉴">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={tab === t.id}
                    data-row="tabs"
                    data-key={`tab:${t.id}`}
                    // Selection follows focus (Toss tab behaviour): swiping across tabs switches them.
                    onFocus={() => tab !== t.id && setTabState(t.id)}
                    onClick={() => setTabState(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </nav>
              {modeBadge}
              <VoiceInput />
            </header>
            <div className="screen-body" data-scroll>
              {tab === 'home' && <Home />}
              {tab === 'market' && <Market />}
              {tab === 'news' && <News />}
            </div>
            <div />
          </section>
        )}
        {toastMsg && (
          <div className="toast" role="status" aria-live="polite">
            {toastMsg}
          </div>
        )}
      </div>
    </NavContext.Provider>
  );
}

function StackScreen({ route, badge }: { route: Route; badge: ReactNode }) {
  switch (route.name) {
    case 'stock':
      return <Stock symbol={route.symbol} badge={badge} />;
    case 'orderbook':
      return <Orderbook symbol={route.symbol} />;
    case 'order':
      return <Order route={route} badge={badge} />;
    case 'article':
      return <Article item={route.item} />;
  }
}
