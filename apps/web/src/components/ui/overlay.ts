import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../../lib/cn';

/**
 * Overlay plumbing shared by Modal, Drawer, DropdownMenu and Popover.
 *
 * The behaviours that make an overlay usable are easy to get subtly wrong and
 * expensive to notice: focus must move in on open and return to the trigger on
 * close, Tab must not walk into the page behind it, background scroll must lock
 * without a layout jump, and Esc must close it. All of that lives here so each
 * overlay component is only about geometry and content.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableWithin(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.offsetParent !== null || element === document.activeElement,
  );
}

let lockCount = 0;

/**
 * Lock body scroll without the page shifting when the scrollbar disappears.
 * The counter matters: two stacked overlays must not unlock on the first close.
 */
export function useScrollLock(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingInlineEnd;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    if (scrollbar > 0) body.style.paddingInlineEnd = `${scrollbar}px`;
    body.style.overflow = 'hidden';
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        body.style.overflow = previousOverflow;
        body.style.paddingInlineEnd = previousPadding;
      }
    };
  }, [active]);
}

export interface DismissableOptions {
  open: boolean;
  onClose: () => void;
  /** Click outside the surface closes the overlay. */
  closeOnOutside?: boolean;
  closeOnEscape?: boolean;
  /** `initial` for dialogs that should receive focus, `anchor` for menus. */
  initialFocus?: 'surface' | 'first' | 'none';
}

/** Escape-to-close plus focus capture and restoration. */
export function useDismissable<T extends HTMLElement>({
  open,
  onClose,
  closeOnOutside = true,
  closeOnEscape = true,
  initialFocus = 'surface',
}: DismissableOptions): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    // Defer one frame so the surface is in the DOM before we reach into it.
    const frame = requestAnimationFrame(() => {
      const surface = ref.current;
      if (!surface) return;
      if (initialFocus === 'none') return;
      if (initialFocus === 'first') {
        focusableWithin(surface)[0]?.focus();
      } else {
        surface.focus();
      }
    });

    return () => {
      cancelAnimationFrame(frame);
      // Returning focus to the trigger is what makes a keyboard flow feel
      // continuous; without it focus falls back to <body> and is lost.
      restoreTo.current?.focus?.();
    };
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, closeOnEscape, onClose]);

  useEffect(() => {
    if (!open || !closeOnOutside) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, closeOnOutside, onClose]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const surface = ref.current;
      if (!surface) return;
      const items = focusableWithin(surface);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        surface.focus();
        return;
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return ref;
}

export interface AnchoredPosition {
  top: number;
  start: number;
  /** Set when the panel had to flip above the anchor to stay on screen. */
  above: boolean;
}

/**
 * Position a floating panel against its trigger, flipping and clamping so it
 * never renders off-screen. Uses logical `start` so it follows the text
 * direction without a second RTL code path.
 */
export function useAnchoredPosition(
  anchor: HTMLElement | null,
  panel: HTMLElement | null,
  opts: { gap?: number; align?: 'start' | 'end' | 'center'; side?: 'bottom' | 'top' } = {},
): AnchoredPosition {
  const { gap = 6, align = 'start', side = 'bottom' } = opts;
  const [position, setPosition] = useState<AnchoredPosition>({ top: 0, start: 0, above: false });

  useLayoutEffect(() => {
    if (!anchor || !panel) return;

    const recompute = () => {
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const margin = 8;

      let top = side === 'bottom' ? a.bottom + gap : a.top - p.height - gap;
      let above = false;
      if (top + p.height > window.innerHeight - margin && a.top - gap - p.height > margin) {
        top = a.top - gap - p.height;
        above = true;
      }
      if (top < margin) top = margin;

      const isRtl = getComputedStyle(anchor).direction === 'rtl';
      let start: number;
      if (align === 'end') start = a.right - p.width;
      else if (align === 'center') start = a.left + a.width / 2 - p.width / 2;
      else start = a.left;

      if (isRtl) start = window.innerWidth - (start + p.width);
      start = Math.min(Math.max(margin, start), window.innerWidth - p.width - margin);

      setPosition({ top, start, above });
    };

    recompute();
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [anchor, panel, gap, align, side]);

  return position;
}

/** Portals need a DOM; during SSR or a test there is none. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export function Portal({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  if (!mounted) return null;
  return createPortal(children, document.body);
}

/** Roving arrow-key navigation for menus and listboxes. */
export function useListNavigation(count: number, onSelect?: (index: number) => void) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (active >= count) setActive(0);
  }, [active, count]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (count === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % count);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + count) % count);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(count - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      onSelect?.(active);
    }
  };

  return { active, setActive, onKeyDown };
}

/** Shared class for the floating surface so every overlay matches exactly. */
export const overlaySurface = cn(
  'rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-raised)]',
  'shadow-[var(--shadow-lg)]',
);

/**
 * A ref an overlay hands to its trigger.
 *
 * Deliberately a callback taking the widest element type rather than a
 * `RefObject`: a `RefObject` is invariant, so a trigger typed against
 * `HTMLButtonElement` could never accept one, whereas a callback that accepts
 * any `HTMLElement` assigns cleanly to both a button and a span.
 */
export type AnchorRef = (node: HTMLElement | null) => void;

