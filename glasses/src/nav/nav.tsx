import { createContext, useContext, useEffect, useRef } from 'react';
import type { BoardType, Health, MarketCountry, NewsItem, OrderType, Side } from '../lib/types.ts';

export type Tab = 'home' | 'market' | 'news';

/** Screens pushed on top of the tabs. Like Figma prototype overlays, they stack. */
export type Route =
  | { name: 'stock'; symbol: string }
  | { name: 'orderbook'; symbol: string }
  | { name: 'order'; symbol: string; side: Side; quantity?: number; orderType?: OrderType }
  | { name: 'article'; item: NewsItem };

export interface BoardSel {
  type: BoardType;
  market: MarketCountry;
}

export interface Nav {
  tab: Tab;
  setTab: (t: Tab) => void;
  push: (r: Route) => void;
  pop: () => void;
  /** Replace the whole stack (used by voice commands that jump somewhere new). */
  reset: (routes: Route[], tab?: Tab) => void;
  board: BoardSel;
  setBoard: (b: BoardSel) => void;
  newsQuery: string | null;
  setNewsQuery: (q: string | null) => void;
  toast: (msg: string) => void;
  health: Health | null;
  /** Ask the shell to move focus after the next DOM change (e.g. a step change inside a screen). */
  refocus: (key?: string | null) => void;
  /** Screens register a handler that runs before the default "pop" on Escape. */
  backHandler: { current: (() => boolean) | null };
}

export const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavContext);
  if (!n) throw new Error('useNav outside NavContext');
  return n;
}

/** Intercept the back gesture (Escape). Return true if you handled it. */
export function useBack(handler: () => boolean) {
  const nav = useNav();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = () => ref.current();
    nav.backHandler.current = fn;
    return () => {
      if (nav.backHandler.current === fn) nav.backHandler.current = null;
    };
  }, [nav.backHandler]);
}
