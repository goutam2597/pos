import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { db } from './db';

/**
 * Internationalisation.
 *
 * ADMIN-MANAGED, NOT HARD-CODED. The set of available languages comes from the
 * server (`/i18n/languages`), which the owner edits in Settings. Adding Urdu to
 * the product is a database row and a translation file, not a code change and a
 * rebuild.
 *
 * FALLBACK CHAIN. `ar` falls back to `en` for any key an admin has not
 * translated yet, so a half-finished translation degrades to English rather
 * than showing raw keys to a customer.
 *
 * RTL IS A DOCUMENT PROPERTY. The `dir` attribute on <html> flips the layout,
 * and because every component styles with logical properties (`ms-*`, `me-*`,
 * `ps-*`, `start-0`), no component needs RTL-specific rules. Direction comes
 * from the language record the admin configured.
 *
 * PLURALISATION. Handled by the ICU-lite `{one}` / `{other}` form rather than
 * `n === 1`, because that is wrong in Arabic, Polish and Russian.
 */

export interface LanguageOption {
  code: string;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  isDefault: boolean;
}

export interface I18nContextValue {
  locale: string;
  direction: 'ltr' | 'rtl';
  languages: LanguageOption[];
  t: (key: string, values?: Record<string, string | number>) => string;
  setLocale: (code: string) => void;
  /** Keys that resolved to their fallback — surfaced in Settings as a TODO list. */
  missing: Set<string>;
  /** Replace the language list after fetching it from the server. */
  setLanguages: (languages: LanguageOption[]) => void;
  /** Replace one locale's translation table after fetching it. */
  setTranslationsFor: (locale: string, table: Record<string, string>) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = 'monopos.locale';
const TABLE_KEY = 'translations';

/**
 * Shipped English strings. This is the seed the server also receives on first
 * run, and the permanent fallback for every other locale.
 */
export const EN: Record<string, string> = {
  'app.name': 'MonoPOS',
  'app.tagline': 'Point of Sale, Inventory, ERP & Accounting',

  'nav.dashboard': 'Dashboard',
  'nav.pos': 'Point of Sale',
  'nav.sales': 'Sales',
  'nav.purchases': 'Purchases',
  'nav.inventory': 'Inventory',
  'nav.products': 'Products',
  'nav.categories': 'Categories',
  'nav.brands': 'Brands',
  'nav.customers': 'Customers',
  'nav.suppliers': 'Suppliers',
  'nav.employees': 'Employees',
  'nav.branches': 'Branches',
  'nav.warehouses': 'Warehouses',
  'nav.invoices': 'Invoices',
  'nav.payments': 'Payments',
  'nav.expenses': 'Expenses',
  'nav.accounting': 'Accounting',
  'nav.accounts': 'Chart of Accounts',
  'nav.journal': 'Journal',
  'nav.ledger': 'Ledger',
  'nav.reports': 'Reports',
  'nav.tax': 'Taxes',
  'nav.users': 'Users',
  'nav.roles': 'Roles',
  'nav.settings': 'Settings',
  'nav.languages': 'Languages',
  'nav.audit': 'Audit Log',
  'nav.sync': 'Sync',
  'nav.group.sell': 'Selling',
  'nav.group.buy': 'Buying',
  'nav.group.stock': 'Stock',
  'nav.group.money': 'Money',
  'nav.group.manage': 'Manage',

  'action.save': 'Save',
  'action.cancel': 'Cancel',
  'action.delete': 'Delete',
  'action.edit': 'Edit',
  'action.create': 'Create',
  'action.close': 'Close',
  'action.confirm': 'Confirm',
  'action.search': 'Search',
  'action.filter': 'Filter',
  'action.export': 'Export',
  'action.print': 'Print',
  'action.refresh': 'Refresh',
  'action.back': 'Back',
  'action.next': 'Next',
  'action.previous': 'Previous',
  'action.view': 'View',
  'action.approve': 'Approve',
  'action.void': 'Void',
  'action.retry': 'Retry',
  'action.signOut': 'Sign out',

  'state.loading': 'Loading…',
  'state.empty': 'Nothing here yet',
  'state.error': 'Something went wrong',
  'state.saved': 'Saved',
  'state.online': 'Online',
  'state.offline': 'Offline',
  'state.pending': 'Pending',
  'state.syncing': 'Syncing',
  'state.synced': 'Synced',
  'state.failed': 'Failed',
  'state.conflict': 'Needs attention',

  'pos.cart': 'Cart',
  'pos.emptyCart': 'Cart is empty',
  'pos.checkout': 'Charge',
  'pos.cash': 'Cash',
  'pos.card': 'Card',
  'pos.change': 'Change',
  'pos.total': 'Total',
  'pos.subtotal': 'Subtotal',
  'pos.tax': 'Tax',
  'pos.discount': 'Discount',
  'pos.hold': 'Hold',
  'pos.held': 'Held sales',
  'pos.receipt': 'Receipt',
  'pos.offlineBanner':
    'Working offline. Sales are saved on this device and will sync when the connection returns.',
  'pos.syncQueue': '{count} sale waiting to sync',
  'pos.syncQueuePlural': '{count} sales waiting to sync',

  'sync.title': 'Synchronisation',
  'sync.pending': 'Pending',
  'sync.lastSynced': 'Last synced',
  'sync.syncNow': 'Sync now',
  'sync.failedItems': 'Failed items',
  'sync.retryAll': 'Retry all',
  'sync.noFailures': 'Nothing needs attention',

  'common.name': 'Name',
  'common.code': 'Code',
  'common.email': 'Email',
  'common.phone': 'Phone',
  'common.address': 'Address',
  'common.status': 'Status',
  'common.date': 'Date',
  'common.quantity': 'Quantity',
  'common.price': 'Price',
  'common.cost': 'Cost',
  'common.amount': 'Amount',
  'common.notes': 'Notes',
  'common.actions': 'Actions',
  'common.all': 'All',
  'common.none': 'None',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.active': 'Active',
  'common.inactive': 'Inactive',
  'common.required': 'Required',
  'common.optional': 'Optional',
  'common.itemsSelected': '{count} selected',
  'common.item': '{count} item',
  'common.itemPlural': '{count} items',
  'common.page': 'Page',
  'common.of': 'of',
  'common.results': 'results',
  'common.showing': 'Showing {from}–{to}',

  'auth.signIn': 'Sign in',
  'auth.signOut': 'Sign out',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.signInTitle': 'Sign in to {business}',
  'auth.invalid': 'Email or password is incorrect',
  'auth.locked': 'Too many failed attempts. Try again later.',

  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'theme.system': 'System',

  'language.menu': 'Language',
  'direction.ltr': 'Left to right',
  'direction.rtl': 'Right to left',
};

export function interpolate(
  template: string,
  values?: Record<string, string | number>,
): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * Pick between a singular and plural form using the `{one}` / `{other}`
 * convention, so languages with more than two plural categories can be added
 * later without changing the call sites.
 */
export function plural(
  template: string,
  count: number,
  values?: Record<string, string | number>,
): string {
  const one = template.match(/\{one\}\s*([^{]*)/)?.[1]?.trim();
  const other = template.match(/\{other\}\s*([^{]*)/)?.[1]?.trim();
  const chosen = count === 1 ? one : other;
  if (!chosen) return interpolate(template.replace(/\{(one|other)\}\s*/g, ''), { ...values, count });
  return interpolate(chosen, { ...values, count });
}

const FALLBACK_LOCALE = 'en';

export function I18nProvider({
  children,
  initialLocale = FALLBACK_LOCALE,
  initialLanguages,
}: {
  children: ReactNode;
  initialLocale?: string;
  initialLanguages?: LanguageOption[];
}) {
  const [locale, setLocaleState] = useState<string>(() => {
    if (typeof window === 'undefined') return initialLocale;
    return window.localStorage.getItem(STORAGE_KEY) ?? initialLocale;
  });

  const [languages, setLanguages] = useState<LanguageOption[]>(
    initialLanguages ?? [{ code: 'en', name: 'English', nativeName: 'English', direction: 'ltr', isDefault: true }],
  );

  const [translations, setTranslations] = useState<Record<string, Record<string, string>>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());

  // Load cached translations for instant first paint (the till must not wait on
  // the network to render, even when online).
  useEffect(() => {
    void (async () => {
      try {
        const cached = await db.meta.get(TABLE_KEY);
        if (cached?.value) setTranslations(cached.value as Record<string, Record<string, string>>);
      } catch {
        /* IndexedDB unavailable (private mode): fall back to network-only. */
      }
    })();
  }, []);

  // Direction is a document-level concern.
  useEffect(() => {
    const active = languages.find((l) => l.code === locale);
    const direction = active?.direction ?? 'ltr';
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, languages]);

  const setLocale = useCallback((code: string) => {
    setLocaleState(code);
    window.localStorage.setItem(STORAGE_KEY, code);
  }, []);

  const t = useCallback(
    (key: string, values?: Record<string, string | number>): string => {
      const table = translations[locale];
      const value = table?.[key];

      if (value) return interpolate(value, values);

      // Fall back to English, then to the key itself so a missing string is
      // visible to whoever is fixing it rather than rendering as blank.
      const fallback = EN[key];
      if (fallback) {
        setMissing((current) => (current.has(key) ? current : new Set(current).add(key)));
        return interpolate(fallback, values);
      }

      setMissing((current) => (current.has(key) ? current : new Set(current).add(key)));
      return key;
    },
    [locale, translations],
  );

  /** Replace the translation tables (called after fetching from the server). */
  const setTranslationsFor = useCallback((locale: string, table: Record<string, string>) => {
    setTranslations((current) => {
      const next = { ...current, [locale]: table };
      void db.meta.put({ key: TABLE_KEY, value: next }).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      direction: (languages.find((l) => l.code === locale)?.direction ?? 'ltr') as 'ltr' | 'rtl',
      languages,
      t,
      setLocale,
      missing,
      setLanguages,
      setTranslationsFor,
    }),
    [locale, languages, t, setLocale, missing],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}

/** Shorthand for components that only need the translate function. */
export function useT() {
  return useI18n().t;
}
