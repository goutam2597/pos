/**
 * Keyboard-wedge scanner capture.
 *
 * A USB/Bluetooth barcode scanner is a keyboard: it "types" the code in a few
 * milliseconds and finishes with Enter. The browser delivers those keystrokes
 * to whatever has focus, which is why naive scanning only works while the
 * search box is focused — and why a scan while focus sits on the page is worse
 * than lost: the digits do nothing but the trailing Enter fires the global
 * "open payment" shortcut.
 *
 * This hook listens on `window` in the capture phase (so it sees every key
 * before any other handler) and recognises a scan by timing, not by focus:
 *
 *   * inter-key gap never exceeds MAX_GAP_MS — human typing cannot sustain it,
 *     a scanner always can;
 *   * the burst ends with Enter;
 *   * the code is at least MIN_SCAN_LENGTH characters.
 *
 * A recognised scan is consumed outright: default (form submit, caret moves)
 * is prevented and other keydown listeners are stopped, then `onScan` decides
 * what the code means. While a burst is in flight and focus is NOT in a text
 * field, the cart shortcut keys (`+ - Delete Backspace` and the arrows) are
 * swallowed too — scan content must never step a quantity or void a line,
 * even for the rare symbology whose payload contains punctuation.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';

/** Longest silence between two keys of one scan. Human fingers can't. */
const MAX_GAP_MS = 75;
/** Shortest payload treated as a scan (EAN-8 is 8; some Code128 run shorter). */
const MIN_SCAN_LENGTH = 4;

/** Keys whose page shortcuts a scan burst must never trigger. */
const CART_SHORTCUT_KEYS = new Set(['+', '=', '-', '_', 'Delete', 'Backspace', 'ArrowUp', 'ArrowDown']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export interface UseScannerOptions {
  /** Off while a modal owns the flow (payment must not change under a tender). */
  enabled: boolean;
  /** Called with the scanned payload once it is recognised as a scan. */
  onScan: (code: string) => void | Promise<unknown>;
}

export function useScanner({ enabled, onScan }: UseScannerOptions): void {
  const bufferRef = useRef('');
  const lastKeyAtRef = useRef(0);
  const onScanRef = useRef(onScan);

  useLayoutEffect(() => {
    onScanRef.current = onScan;
  });

  useEffect(() => {
    if (!enabled) {
      bufferRef.current = '';
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // Modifier combos are human shortcuts (Ctrl+V, Alt+Tab), never scan
      // output — scanners emit bare characters.
      if (event.ctrlKey || event.metaKey || event.altKey) {
        bufferRef.current = '';
        return;
      }
      if (event.repeat) return;

      const now = performance.now();
      const burstActive = bufferRef.current.length > 0 && now - lastKeyAtRef.current <= MAX_GAP_MS;
      if (!burstActive) bufferRef.current = '';
      lastKeyAtRef.current = now;

      if (event.key === 'Enter') {
        const code = bufferRef.current;
        bufferRef.current = '';
        if (code.length >= MIN_SCAN_LENGTH) {
          event.preventDefault();
          event.stopImmediatePropagation();
          void onScanRef.current(code);
        }
        return;
      }

      if (event.key.length === 1) {
        bufferRef.current += event.key;
        return;
      }

      // Any other key breaks a burst — except the cart shortcuts, which a scan
      // must swallow rather than act on. Only when focus is outside a text
      // field: there the keys belong to the cashier's typing.
      if (!isTypingTarget(event.target) && burstActive && CART_SHORTCUT_KEYS.has(event.key)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      bufferRef.current = '';
    };

    // Capture phase: run before the page's bubble-phase shortcut handler so a
    // recognised scan can consume the event before anything acts on it.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      bufferRef.current = '';
    };
  }, [enabled]);
}
