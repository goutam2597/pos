import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import { SHORTCUTS } from '../../lib/routes';
import { useUiStore } from '../../lib/stores';

/**
 * Global keyboard shortcuts.
 *
 * Two chords, deliberately few:
 *   Cmd/Ctrl + K  command palette
 *   g then <key>  go to a module
 *
 * `g`-prefixed chords (vim style) are ignored while a text field has focus,
 * because a cashier typing "g s" into a search box should get the letters, not
 * a navigation.
 */
export function ShortcutProvider() {
  const navigate = useNavigate();
  const toggleCommandPalette = useUiStore((state) => state.toggleCommandPalette);
  const pendingPrefix = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      const tag = element.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        element.isContentEditable === true
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        toggleCommandPalette();
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      if (pendingPrefix.current) {
        const destination = SHORTCUTS[event.key.toLowerCase()];
        pendingPrefix.current = false;
        if (timer.current) clearTimeout(timer.current);
        if (destination) {
          event.preventDefault();
          navigate(destination);
        }
        return;
      }

      if (event.key.toLowerCase() === 'g') {
        pendingPrefix.current = true;
        // A chord that is never completed should expire rather than surprise
        // the user with a jump on their next keypress.
        timer.current = setTimeout(() => {
          pendingPrefix.current = false;
        }, 1200);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [navigate, toggleCommandPalette]);

  return null;
}
