import { Check, Globe, Languages, Monitor, Moon, Sun } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useI18n, useT } from '../../lib/i18n';
import { useTheme } from '../../lib/theme';
import { DropdownMenu, type MenuItem } from './DropdownMenu';

/**
 * Theme toggle.
 *
 * A three-way menu rather than a two-state button: "system" is a real setting
 * and a shop with two tills that disagree about brightness is a support call.
 */

export function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const t = useT();

  const items: MenuItem[] = [
    { key: 'light', label: t('theme.light'), icon: <Sun size={16} strokeWidth={1.75} />, hint: preference === 'light' ? <Check size={14} strokeWidth={2} /> : undefined, onSelect: () => setPreference('light') },
    { key: 'dark', label: t('theme.dark'), icon: <Moon size={16} strokeWidth={1.75} />, hint: preference === 'dark' ? <Check size={14} strokeWidth={2} /> : undefined, onSelect: () => setPreference('dark') },
    { key: 'system', label: t('theme.system'), icon: <Monitor size={16} strokeWidth={1.75} />, hint: preference === 'system' ? <Check size={14} strokeWidth={2} /> : undefined, onSelect: () => setPreference('system') },
  ];

  const Icon = preference === 'system' ? Monitor : preference === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu
      label={t('theme.light')}
      items={items}
      trigger={({ open, ref, onToggle }) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Theme"
          onClick={onToggle}
          className={cn(
            'flex size-[var(--height-control)] items-center justify-center rounded-[var(--radius-md)]',
            'text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
            open && 'bg-[var(--bg-sunken)] text-[var(--text-primary)]',
          )}
        >
          <Icon size={16} strokeWidth={1.75} />
        </button>
      )}
    />
  );
}

/**
 * Language switcher.
 *
 * Shows the language in its own script (`العربية`, `हिन्दी`), not the English
 * name: a shop owner looking for their language scans for their own glyphs.
 */
export function LanguageSwitcher() {
  const { languages, locale, setLocale, t } = useI18n();

  if (languages.length <= 1) return null;

  const current = languages.find((language) => language.code === locale);
  const items: MenuItem[] = languages.map((language) => ({
    key: language.code,
    label: `${language.nativeName || language.name}`,
    icon: language.direction === 'rtl' ? <Globe size={16} strokeWidth={1.75} /> : <Languages size={16} strokeWidth={1.75} />,
    hint: language.code === locale ? <Check size={14} strokeWidth={2} /> : undefined,
    onSelect: () => setLocale(language.code),
  }));

  return (
    <DropdownMenu
      label={t('language.menu')}
      items={items}
      trigger={({ open, ref, onToggle }) => (
        <button
          ref={ref}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t('language.menu')}
          onClick={onToggle}
          className={cn(
            'flex h-[var(--height-control)] items-center gap-1.5 rounded-[var(--radius-md)] px-2',
            'text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-sunken)] hover:text-[var(--text-primary)]',
            open && 'bg-[var(--bg-sunken)] text-[var(--text-primary)]',
          )}
        >
          <Languages size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="max-w-[7rem] truncate">{current?.nativeName || locale.toUpperCase()}</span>
        </button>
      )}
    />
  );
}
