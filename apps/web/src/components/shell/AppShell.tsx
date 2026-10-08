import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { configureFormatting } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../lib/i18n';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ShortcutProvider } from './ShortcutProvider';

/**
 * App shell.
 *
 * Sidebar + topbar + a scrolling content column. The layout is a plain CSS
 * flex row rather than a grid: the sidebar collapses to a different width and
 * the content column must simply take whatever is left.
 *
 * Currency and locale for `money()`/`date()` are configured here, once, from
 * the signed-in business — so every formatted number in the product agrees
 * about which currency and which digits it is in.
 */
export function AppShell() {
  const { business } = useAuth();
  const { locale } = useI18n();
  const location = useLocation();

  useEffect(() => {
    if (business) configureFormatting(business.currency, locale);
  }, [business, locale]);

  // Reset the scroll position on navigation. Without this, scrolling a long
  // product list and opening an item lands the user halfway down the detail.
  useEffect(() => {
    document.querySelector('[data-app-scroll]')?.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    document.title = business ? `${business.name} — MonoPOS` : 'MonoPOS';
  }, [business]);


  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--bg-canvas)] text-[var(--text-primary)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-3 focus:top-3 focus:z-50 focus:rounded-[var(--radius-md)] focus:bg-[var(--bg-surface)] focus:px-3 focus:py-2 focus:text-[13px] focus:shadow-[var(--shadow-md)]"
      >
        Skip to content
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main-content" data-app-scroll className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>

      <ShortcutProvider />
    </div>
  );
}
