import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider, useI18n } from './lib/i18n';
import { ThemeProvider } from './lib/theme';
import { configureFormatting } from './lib/format';
import { useUiStore } from './lib/stores';
import { Toaster } from './components/ui/Toaster';
import { FullPageSpinner } from './routes/guards';
import { AppRoutes } from './routes/AppRoutes';

/**
 * Application root.
 *
 * PROVIDER ORDER IS NOT ARBITRARY:
 *   QueryClient  — depends on nothing below it
 *   Theme        — writes `data-theme`; nothing below branches on it, but the
 *                  toaster reads it
 *   I18n         — owns `<html lang dir>`, which everything below inherits
 *   Auth         — depends on i18n (it sets the locale on sign-in) and builds the
 *                  API client it needs
 *
 * `AppShell` and `Topbar` sit inside all four, so anything they render can read
 * the query cache, the theme, translations and the session without prop
 * drilling through every page.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reference data (categories, brands, units, taxes) changes rarely; list
      // data changes often enough that a longer stale time only adds surprise.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: (failureCount, error: unknown) => {
        // A transient failure is worth one silent retry; a permission or
        // validation error is not, and retrying only delays the honest error.
        const transient = error instanceof ApiError && error.isTransient;
        return transient && failureCount < 2;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <BrowserRouter>
              <SessionBootstrap>
                <AppRoutes />
              </SessionBootstrap>
              <Toaster />
            </BrowserRouter>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * Session-aware bootstrap.
 *
 * Two jobs, both of which must happen before any screen renders:
 *
 * 1. While the auth provider is still exchanging the refresh cookie for an
 *    access token, render a spinner rather than the login page. Flashing "sign
 *    in" at someone who is already signed in is the most common auth bug there
 *    is.
 * 2. Tell `Intl` which locale and currency to format with, from the business
 *    record, so the very first number on screen is already correct.
 */
function SessionBootstrap({ children }: { children: React.ReactNode }) {
  const { status, business } = useAuth();
  const { locale } = useI18n();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status !== 'loading') setReady(true);
  }, [status]);

  useEffect(() => {
    if (business) configureFormatting(business.currency, locale);
  }, [business, locale]);

  // Close the mobile drawer when the viewport grows past the breakpoint and the
  // sidebar stops being an overlay — otherwise it stays stuck open behind the
  // restored desktop rail.
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) useUiStore.getState().setMobileNavOpen(false);
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  if (!ready) return <FullPageSpinner label="Starting MonoPOS" />;

  return <>{children}</>;
}
