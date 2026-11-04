// Row-based focus engine for Neural Band input.
//
// On Ray-Ban Display there is no cursor or touch. The Neural Band's thumb swipes arrive as
// ArrowUp/Down/Left/Right, an index pinch arrives as Enter (= click on the focused
// <button>), and the "back" gesture arrives as Escape.
//
// Model: every focusable element carries `data-row`. Elements sharing a row value form a
// horizontal group (e.g. a segmented control); rows stack vertically in DOM order.
//   ↑/↓  move between rows, keeping roughly the same column
//   ←/→  move within a row; at the row's edge, bubble up as a "swipe" (switch tabs)
//   ←/→  on an element with `data-adjust` change its value instead (qty / price stepper)
//
// Like auto-layout in Figma: you don't place focus by coordinates, you declare structure
// (rows × columns) and the engine derives movement from it.

export const FOCUSABLE = '[data-row]:not([disabled]):not([aria-hidden="true"])';

export type SwipeDir = 'left' | 'right';

function rowsIn(root: HTMLElement): HTMLElement[][] {
  const order: string[] = [];
  const map = new Map<string, HTMLElement[]>();
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    const r = el.dataset.row!;
    if (!map.has(r)) {
      map.set(r, []);
      order.push(r);
    }
    map.get(r)!.push(el);
  }
  return order.map((r) => map.get(r)!);
}

export function focusFirst(root: HTMLElement | null, preferKey?: string | null): void {
  if (!root) return;
  const byKey = preferKey ? root.querySelector<HTMLElement>(`[data-key="${CSS.escape(preferKey)}"]`) : null;
  const target =
    byKey ??
    root.querySelector<HTMLElement>('[data-autofocus]:not([disabled])') ??
    root.querySelector<HTMLElement>('[data-row][aria-selected="true"]') ?? // never land on (and switch to) another tab
    root.querySelector<HTMLElement>(FOCUSABLE);
  if (target) focusEl(target);
}

export interface MoveResult {
  handled: boolean;
  swipe?: SwipeDir;
}

export function moveFocus(root: HTMLElement, key: string): MoveResult {
  const rows = rowsIn(root);
  if (!rows.length) return { handled: false, swipe: key === 'ArrowLeft' ? 'left' : key === 'ArrowRight' ? 'right' : undefined };
  const active = document.activeElement as HTMLElement | null;
  let ri = rows.findIndex((r) => r.includes(active!));
  if (ri < 0) {
    focusFirst(root);
    return { handled: true };
  }
  const row = rows[ri]!;
  const ci = row.indexOf(active!);

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const dir = key === 'ArrowRight' ? 1 : -1;
    if (active!.dataset.adjust !== undefined) {
      active!.dispatchEvent(new CustomEvent('nav-adjust', { detail: dir, bubbles: false }));
      return { handled: true };
    }
    const next = row[ci + dir];
    if (next) {
      focusEl(next);
      return { handled: true };
    }
    return { handled: false, swipe: dir > 0 ? 'right' : 'left' };
  }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    ri += key === 'ArrowDown' ? 1 : -1;
    const target = rows[ri];
    if (!target) {
      // At the very top/bottom: nudge the scroll owner so trailing text is still readable.
      active!.closest<HTMLElement>('[data-scroll]')?.scrollBy({ top: key === 'ArrowDown' ? 80 : -80 });
      return { handled: true };
    }
    // Entering a tab/segment row lands on its selected item, not whatever column we came from
    // (otherwise "up from content" would silently switch tabs, since tabs select on focus).
    const selected = target.find((el) => el.getAttribute('aria-selected') === 'true');
    if (selected) {
      focusEl(selected);
      return { handled: true };
    }
    // Keep the column proportional: from col 2 of 3 to a 2-col row → col 1.
    const col = row.length > 1 ? Math.round((ci / (row.length - 1)) * (target.length - 1)) : 0;
    focusEl(target[Math.min(col, target.length - 1)]!);
    return { handled: true };
  }
  return { handled: false };
}

function focusEl(el: HTMLElement) {
  el.removeAttribute('data-offscreen');
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest' });
  syncOffscreen(document);
}

/**
 * Hide focus targets that are scrolled past the 600×600 lens (Meta's gate rejects
 * focusables outside the device viewport). They are invisible anyway — clipped by the
 * scroll container — so the wearer sees no difference; focusEl() reveals a row just
 * before focusing it.
 */
export function syncOffscreen(root: ParentNode) {
  const h = window.innerHeight;
  const w = window.innerWidth;
  for (const el of root.querySelectorAll<HTMLElement>('[data-scroll] [data-row]')) {
    const r = el.getBoundingClientRect();
    const off = r.bottom > h + 1 || r.top < -1 || r.right > w + 1 || r.left < -1;
    if (off !== el.hasAttribute('data-offscreen')) el.toggleAttribute('data-offscreen', off);
  }
}
