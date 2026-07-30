'use client';

/**
 * Keep the page steady across StoryView's INTENTIONAL iframe remount.
 *
 * An agent edit remounts <AgentHtml> (keyed on the story hash), tearing the iframe down; the
 * fresh one first measures ~0px and regrows async as embeds hydrate, so the page content
 * briefly shrinks and the browser clamps the scroll container toward the top. Two defenses,
 * owned together by one hook (one ResizeObserver, one lifecycle):
 *
 *  1. HEIGHT PIN — right before the rebuild (adjust-state-during-render, so the style lands in
 *     the SAME commit as the child's remount) the story box's min-height pins to its last
 *     stable measured height. The pin releases only once the rebuilt content has regrown to at
 *     least the pinned height, or after MAX_PIN_MS (a story that legitimately got much shorter
 *     must not hold a huge min-height forever). It does NOT release on a mere gap in the
 *     resize stream — embeds awaiting query results pause resizing for far longer than the
 *     settle debounce, and releasing there is exactly what used to clamp scroll to the top.
 *
 *  2. SCROLL RESTORE — at the same render-phase moment the nearest scrollable ancestor's
 *     scrollTop is snapshotted (the DOM still holds the pre-rebuild position). If the browser
 *     clamps it anyway (pin missed: first render, zero lastHeight, pin timeout), the position
 *     is re-asserted as soon as the rebuilt content is tall enough to hold it. A user scroll
 *     during the rebuild cancels the restore (we never yank the page from under the user).
 *
 * Timing-based by nature (the iframe regrows async): the decision logic is pure and
 * unit-tested; the full behavior is verified in-browser.
 */
import { useEffect, useInsertionEffect, useRef, useState } from 'react';

/** Debounce for "the (re)built content stopped resizing" — one state update per settle. */
export const REBUILD_SETTLE_MS = 150;
/** Max time a rebuild may hold the height pin before conceding the story really got shorter. */
export const MAX_PIN_MS = 20_000;

/** Release the pin only when the rebuilt content regrew to the pinned height, or on timeout. */
export function shouldReleasePin(
  height: number,
  pinnedHeight: number,
  elapsedMs: number,
  maxPinMs: number = MAX_PIN_MS,
): boolean {
  return height >= pinnedHeight || elapsedMs >= maxPinMs;
}

/** Nearest ancestor that actually scrolls vertically (overflow/overflow-y auto|scroll). */
export function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const s = window.getComputedStyle(n);
    if (/(auto|scroll)/.test(`${s.overflowY} ${s.overflow}`)) return n;
  }
  return null;
}

/** The content height should hold the saved position plus one viewport below it. */
export function canHoldScroll(contentHeight: number, savedTop: number, viewportHeight: number): boolean {
  return contentHeight >= savedTop + viewportHeight;
}

interface ScrollSnapshot { scroller: HTMLElement; top: number }

/**
 * @param boxRef    the story canvas box (the iframe's ancestor whose min-height we pin)
 * @param renderKey AgentHtml's remount key — a change means the iframe is about to rebuild
 * @returns the min-height (px) to pin on the box, or null when unpinned
 */
export function useStoryRebuildStability(
  boxRef: React.RefObject<HTMLDivElement | null>,
  renderKey: string,
): number | null {
  // State (not refs) for the render-phase branch below: refs must not be READ during render,
  // and `lastHeight` is only recorded on settle so this stays one update per resize-burst.
  const [pin, setPin] = useState<number | null>(null);
  const [lastHeight, setLastHeight] = useState(0);
  const [prevKey, setPrevKey] = useState(renderKey);
  const settleRef = useRef(0);
  // The scroll snapshot is consumed imperatively (never rendered) — a ref, written at the
  // key-change moment while the DOM still holds the pre-rebuild scroll position.
  const scrollSnapRef = useRef<ScrollSnapshot | null>(null);

  // Adjust-state-during-render: the instant the render key changes (imminent iframe remount),
  // pin the last stable height so the box can't collapse in this same commit.
  if (prevKey !== renderKey) {
    setPrevKey(renderKey);
    if (lastHeight > 0) setPin(lastHeight);
  }

  // Snapshot the scroll position on the same key change, in an INSERTION effect: it fires
  // before this commit's DOM mutations (and before all layout effects, where the fresh iframe
  // first sizes ~0), so the scroller still holds the pre-rebuild position — and unlike the
  // render phase, effects may read the DOM and write refs.
  useInsertionEffect(() => {
    const scroller = findScrollableAncestor(boxRef.current);
    scrollSnapRef.current = scroller && scroller.scrollTop > 0
      ? { scroller, top: scroller.scrollTop }
      : null;
  }, [boxRef, renderKey]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    // The rebuild clock starts here — this effect re-runs exactly once per renderKey change,
    // committed together with the remount (the render phase must stay pure, so no Date.now there).
    const rebuildStartedAt = Date.now();
    const measure = () => box.querySelector('iframe')?.offsetHeight ?? box.offsetHeight;

    const maybeRestoreScroll = () => {
      const snap = scrollSnapRef.current;
      if (!snap) return;
      if (snap.scroller.scrollTop > 0 && snap.scroller.scrollTop !== snap.top) {
        scrollSnapRef.current = null; // the user scrolled during the rebuild — never fight them
        return;
      }
      if (canHoldScroll(measure(), snap.top, snap.scroller.clientHeight)) {
        snap.scroller.scrollTop = snap.top;
        scrollSnapRef.current = null;
      }
    };

    const ro = new ResizeObserver(() => {
      // Re-assert scroll per resize frame (the restore must land the moment the content is
      // tall enough); the PIN decision debounces to the settle so it's one update per burst.
      maybeRestoreScroll();
      if (settleRef.current) window.clearTimeout(settleRef.current);
      settleRef.current = window.setTimeout(() => {
        const h = measure();
        if (h > 0) setLastHeight(h);
        setPin(p => (p !== null && !shouldReleasePin(h, p, Date.now() - rebuildStartedAt) ? p : null));
      }, REBUILD_SETTLE_MS);
    });
    ro.observe(box.querySelector('iframe') ?? box);

    // Timeout floor: content never regrew (the story legitimately got shorter) — release the
    // pin and settle scroll at the best position the shorter content can hold.
    const floor = window.setTimeout(() => {
      setPin(null);
      const snap = scrollSnapRef.current;
      if (snap) {
        snap.scroller.scrollTop = snap.top; // browser clamps to whatever the shorter content allows
        scrollSnapRef.current = null;
      }
    }, MAX_PIN_MS);

    return () => {
      ro.disconnect();
      if (settleRef.current) window.clearTimeout(settleRef.current);
      window.clearTimeout(floor);
    };
  }, [boxRef, renderKey]); // re-observe the fresh iframe after each remount

  return pin;
}
