import { useCallback, useLayoutEffect, useRef, useState } from 'react';

interface FitRowsOptions {
  /** Height of one desktop table row, in px. Matches the `h-12` cell in JobsTable. */
  rowHeight?: number;
  /** Height of one stacked mobile card, in px. */
  mobileRowHeight?: number;
  /** Never ask for fewer than this many rows. */
  min?: number;
  /** Never ask for more than this many rows (the API caps `limit` at 100). */
  max?: number;
  /**
   * Space left below the last row: the page wrapper's bottom padding (`py-8` = 32px) plus the
   * panel border, so the table stops short of the scroll container instead of overflowing it.
   */
  reserve?: number;
}

/** Nearest scrollable ancestor, so the measurement is taken against the box the table lives in. */
function scrollParent(el: HTMLElement): HTMLElement {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return document.documentElement;
}

/**
 * Every element laid out above `el` inside the scroller: its previous siblings, then its ancestors'
 * previous siblings. Deliberately excludes `el`, its ancestors and its descendants - those contain
 * the table, whose height is this hook's output, and observing them fed the row count back into
 * itself. What is above `el` moves its top edge, so it genuinely needs a re-measure.
 */
function elementsAbove(el: HTMLElement, scroller: HTMLElement): Element[] {
  const found: Element[] = [];
  let node: HTMLElement | null = el;

  while (node && node !== scroller) {
    for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
      found.push(sib);
    }
    node = node.parentElement;
  }

  return found;
}

/**
 * Fraction of a row a measurement has to clear before the count changes. A few px of layout jitter
 * (a scrollbar appearing, a label rewrapping) would otherwise flip `rows` back and forth, and every
 * flip refetches at a new `limit`.
 */
const DEADBAND = 0.35;

/**
 * Measures how many rows fit between the returned ref's top edge and the bottom of the scroll
 * container, so a list can request exactly as many items as the viewport can show.
 *
 * `rows` is `null` until the first measurement lands - callers should hold off fetching until then
 * so they don't fire one request at a guessed size and a second at the real one.
 */
export function useFitRows({
  rowHeight = 48,
  mobileRowHeight = 101,
  min = 3,
  max = 30,
  reserve = 36,
}: FitRowsOptions = {}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [rows, setRows] = useState<number | null>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const scroller = scrollParent(el);
    // Offset from the scroll container's content top, not the viewport: stays put while the user
    // scrolls, so growing the table can't feed back into the row count.
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const available = scroller.clientHeight - top - reserve;

    const wide = typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 640px)').matches
      : true;
    const unit = wide ? rowHeight : mobileRowHeight;
    const fits = Math.max(min, Math.min(max, Math.floor(available / unit)));

    setRows((current) => {
      if (current === null || fits === current) return fits;

      // A one-row change has to be decisive; anything larger is a real resize, so take it as-is.
      if (Math.abs(fits - current) === 1) {
        const margin = unit * DEADBAND;
        const growing = fits > current;
        if (growing && available < (current + 1) * unit + margin) return current;
        if (!growing && available > current * unit - margin) return current;
      }

      return fits;
    });
  }, [rowHeight, mobileRowHeight, min, max, reserve]);

  useLayoutEffect(() => {
    measure();

    const el = ref.current;
    if (!el) return;

    // Guarded for jsdom, which has no ResizeObserver; window resize alone is enough there.
    //
    // Callbacks are coalesced into a frame so a burst of resize notifications measures once, after
    // layout has settled.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    const scroller = scrollParent(el);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(scroller);
    // Content above shifts the table's top edge: the stat cards settling, or a banner that only
    // appears once its own request resolves.
    for (const node of elementsAbove(el, scroller)) observer?.observe(node);

    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [measure]);

  return { ref, rows };
}
