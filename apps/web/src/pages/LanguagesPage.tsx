import { useMemo, useState } from 'react';
import { Check, Globe, Plus, Trash2 } from 'lucide-react';

import { cn } from '../lib/cn';
import { EN } from '../lib/i18n';
import { useI18n } from '../lib/i18n';
import { queryKeys, useApiMutation, useApiQuery, type Language } from '../lib/queries';
import { useAuth } from '../lib/auth';
import { DataTable, type Column } from '../components/data';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Alert } from '../components/ui/Feedback';
import { FormDialog } from '../components/ui/Modal';
import { FormField } from '../components/ui/Form';
import { ConfirmRequestDialog, type ConfirmRequest } from '../components/ui/ConfirmDialog';
import { SearchInput } from '../components/ui/SearchInput';
import { TabPanel, Tabs, useTabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/shell/PageHeader';
import { Page } from './_shared';

/**
 * Languages.
 *
 * Translations are admin-managed data, not code: the owner decides which
 * languages the product speaks, and a half-finished translation falls back to
 * English rather than showing a customer a raw key.
 *
 * The editor therefore shows two things a plain key/value list cannot: which
 * keys are still untranslated (so work can be assigned), and a live RTL preview,
 * because Arabic and Urdu are not just a different alphabet — they lay out the
 * whole screen differently.
 */

const RTL_CODES = new Set(['ar', 'fa', 'he', 'ur', 'ps', 'sd', 'yi', 'dv', 'ku']);

export function LanguagesPage() {
  const { api, can } = useAuth();
  const { setLanguages, setTranslationsFor, setLocale } = useI18n();
  const [draftTranslations, setDraftTranslations] = useState<Record<string, string>>({});
  const [tab, setTab] = useTabs('list');
  const [search, setSearch] = useState('');
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [draft, setDraft] = useState({ code: '', name: '', nativeName: '', direction: 'ltr' as 'ltr' | 'rtl' });

  const list = useApiQuery<Language[]>(
    queryKeys.languages,
    async (signal) => {
      const languages = await api.data<Language[]>('/i18n/languages', { signal });
      setLanguages(
        languages.map((language) => ({
          code: language.code,
          name: language.name,
          nativeName: language.nativeName ?? language.name,
          direction: language.direction,
          isDefault: language.isDefault === true,
        })),
      );
      return languages;
    },
    { staleTime: 5 * 60_000 },
  );

  const translations = useApiQuery<Record<string, string>>(
    ['i18n', 'translations', editingCode ?? ''],
    async (signal) => {
      const table = await api.data<Record<string, string>>(`/i18n/${editingCode}/translations`, { signal });
      setTranslationsFor(editingCode ?? '', table);
      return table;
    },
    { enabled: editingCode !== null },
  );

  const create = useApiMutation<Record<string, unknown>, unknown>({
    invalidate: [queryKeys.languages],
    mutationFn: (body) => api.post('/i18n/languages', body),
    successMessage: 'Language added',
    onSuccess: () => setCreating(false),
  });

  const update = useApiMutation<{ path: string } & Record<string, unknown>, unknown>({
    invalidate: [queryKeys.languages],
    mutationFn: ({ path, ...body }) => api.patch(path, body),
    successMessage: 'Language updated',
  });

  const remove = useApiMutation<{ code: string }, unknown>({
    invalidate: [queryKeys.languages],
    mutationFn: ({ code }) => api.del(`/i18n/languages/${code}`),
    successMessage: 'Language removed',
    onSuccess: () => setConfirm(null),
  });

  const putTranslations = useApiMutation<{ code: string; entries: Array<{ key: string; value: string }> }, unknown>({
    mutationFn: async ({ code, entries }) => {
      for (const entry of entries) {
        await api.patch(`/i18n/${code}/translations`, entry);
      }
    },
    successMessage: 'Translations saved',
  });

  const rows = list.data ?? [];
  // Saved table merged with unsaved edits, so what you see is what you are
  // about to save — and so the "untranslated" list updates as you type.
  const table = useMemo(
    () => ({ ...(translations.data ?? {}), ...draftTranslations }),
    [translations.data, draftTranslations],
  );
  const allKeys = Object.keys(EN);

  const missing = useMemo(
    () => allKeys.filter((key) => !table[key] || table[key]?.trim() === ''),
    [allKeys, table],
  );

  const filteredKeys = useMemo(() => {
    const q = search.trim().toLowerCase();
    const keys = q ? allKeys.filter((key) => key.includes(q) || EN[key]?.toLowerCase().includes(q)) : allKeys;
    return keys;
  }, [allKeys, search]);

  const columns: Column<Language>[] = [
    {
      key: 'language',
      header: 'Language',
      value: (row) => row.name,
      sticky: true,
      cell: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-sunken)] text-[var(--text-tertiary)]">
            <Globe size={16} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{row.name}</p>
            <p className="truncate text-[12px] text-[var(--text-tertiary)]">
              {row.nativeName ?? '—'} · {row.code}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'direction',
      header: 'Direction',
      value: (row) => row.direction,
      width: '10rem',
      cell: (row) => (
        <span className="text-[12px] text-[var(--text-secondary)]">
          {row.direction === 'rtl' ? 'Right to left' : 'Left to right'}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Translated',
      value: (row) => (row.translatedCount ?? 0) / Math.max(allKeys.length, 1),
      cell: (row) => {
        const done = row.translatedCount ?? 0;
        const pct = Math.round((done / Math.max(allKeys.length, 1)) * 100);
        return (
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--bg-inset)]">
              <span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${pct}%` }} />
            </span>
            <span className="tabular-nums text-[12px] text-[var(--text-secondary)]">{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'default',
      header: '',
      width: '6rem',
      value: (row) => (row.isDefault ? 1 : 0),
      cell: (row) =>
        row.isDefault ? (
          <Badge tone="brand">Default</Badge>
        ) : row.isActive === false ? (
          <StatusBadge status="INACTIVE" />
        ) : null,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '11rem',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setEditingCode(row.code); }}>
            Translate
          </Button>
          {can('i18n:update') && !row.isDefault && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft({ code: row.code, name: row.name, nativeName: row.nativeName ?? row.name, direction: row.direction });
                  update.mutate({ path: `/i18n/languages/${row.code}`, name: draft.name || row.name });
                }}
              >
                Rename
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-[var(--danger-text)]"
                onClick={() =>
                  setConfirm({
                    title: `Remove ${row.name}?`,
                    description: 'Its translations are deleted. Any user whose language is set to this falls back to English.',
                    confirmLabel: 'Remove language',
                    onConfirm: () => remove.mutate({ code: row.code }),
                  })
                }
                aria-label={`Remove ${row.name}`}
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const activeLanguage = rows.find((row) => row.code === editingCode);

  return (
    <Page>
      <PageHeader
        title="Languages"
        description="The languages this business trades in. English is always the fallback for anything untranslated."
        actions={
          can('i18n:create') ? (
            <Button
              variant="primary"
              icon={<Plus size={16} strokeWidth={1.75} />}
              onClick={() => {
                setDraft({ code: '', name: '', nativeName: '', direction: 'ltr' });
                setCreating(true);
              }}
            >
              Add language
            </Button>
          ) : undefined
        }
      />

      <Tabs
        label="Language views"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'list', label: 'Languages', badge: rows.length ? <Badge tone="neutral">{rows.length}</Badge> : undefined },
          {
            value: 'translate',
            label: 'Translate',
            disabled: editingCode === null,
          },
        ]}
        className="mb-4"
      />

      <TabPanel value="list" active={tab}>
        <DataTable
          tableId="languages"
          columns={columns}
          rows={rows}
          meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
          getRowId={(row) => row.code}
          isLoading={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          exportable={false}
          emptyTitle="No languages configured"
          emptyDescription="English is available by default. Add a language to start translating the interface."
          emptyAction={can('i18n:create') ? { label: 'Add language', onClick: () => setCreating(true) } : undefined}
        />
      </TabPanel>

      <TabPanel value="translate" active={tab}>
        {editingCode === null ? (
          <Card>
            <p className="py-12 text-center text-[13px] text-[var(--text-tertiary)]">
              Choose a language from the list to start translating.
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <Card flush>
              <CardHeader
                title={`Translate ${activeLanguage?.nativeName ?? editingCode}`}
                description={`${allKeys.length - missing.length} of ${allKeys.length} keys translated. Untranslated keys fall back to English.`}
                actions={
                  <Button
                    variant="primary"
                    size="sm"
                    loading={putTranslations.isPending}
                    onClick={() =>
                      putTranslations.mutate({
                        code: editingCode,
                        entries: filteredKeys
                          .filter((key) => table[key] !== undefined && table[key] !== EN[key])
                          .map((key) => ({ key, value: table[key] ?? '' })),
                      })
                    }
                  >
                    Save changes
                  </Button>
                }
              />
              <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
                <SearchInput value={search} onValueChange={setSearch} placeholder="Search keys or English text" />
              </div>
              {translations.isPending ? (
                <p className="px-4 py-12 text-center text-[13px] text-[var(--text-tertiary)]">Loading translations…</p>
              ) : (
                <ul className="divide-y divide-[var(--border-subtle)]">
                  {filteredKeys.map((key) => (
                    <li key={key} className="grid gap-2 px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="min-w-0">
                        <p className="font-mono text-[12px] text-[var(--text-tertiary)]">{key}</p>
                        <p className="mt-0.5 truncate text-[13px] text-[var(--text-secondary)]">{EN[key]}</p>
                      </div>
                      <div className="min-w-0">
                        <Input
                          size="sm"
                          value={table[key] ?? ''}
                          placeholder={EN[key]}
                          onChange={(event) =>
                            setDraftTranslations((current) => ({ ...current, [key]: event.target.value }))
                          }
                          aria-label={`Translation for ${key}`}
                        />
                        {!table[key] && (
                          <p className="mt-1 text-[12px] text-[var(--warning-text)]">Untranslated — falls back to English</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="space-y-4">
              <Card flush>
                <CardHeader
                  title="Preview"
                  description="How the interface reads in this language."
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => setLocale(editingCode)}>
                      Switch app to this
                    </Button>
                  }
                />
                <div
                  dir={activeLanguage?.direction ?? 'ltr'}
                  lang={editingCode}
                  className="space-y-2 p-4 text-[13px]"
                >
                  <p className="font-semibold">{table['app.name'] ?? EN['app.name']}</p>
                  <p className="text-[var(--text-secondary)]">{table['pos.checkout'] ?? EN['pos.checkout']}</p>
                  <p className="text-[var(--text-secondary)]">{table['nav.sales'] ?? EN['nav.sales']}</p>
                  <p className="text-[var(--text-secondary)]">{table['common.amount'] ?? EN['common.amount']}</p>
                </div>
              </Card>

              <Card flush>
                <CardHeader title="Untranslated keys" description="Left to do." />
                {missing.length === 0 ? (
                  <p className="flex items-center gap-1.5 px-4 py-6 text-[13px] text-[var(--success-text)]">
                    <Check size={15} strokeWidth={1.75} aria-hidden="true" />
                    Every key has a translation.
                  </p>
                ) : (
                  <ul className="max-h-64 divide-y divide-[var(--border-subtle)] overflow-y-auto scrollbar-thin">
                    {missing.map((key) => (
                      <li key={key} className="px-4 py-1.5">
                        <span className="font-mono text-[12px] text-[var(--text-secondary)]">{key}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {activeLanguage && (
                <Card flush>
                  <CardHeader title="Direction" description="Set by the language record, not per screen." />
                  <div className="space-y-3 p-4">
                    <Select
                      label="Writing direction"
                      value={activeLanguage.direction}
                      onChange={(event) => {
                        const direction = event.target.value === 'rtl' ? 'rtl' : 'ltr';
                        setDraft((current) => ({ ...current, direction }));
                        update.mutate({ path: `/i18n/languages/${activeLanguage.code}`, direction });
                      }}
                      options={[
                        { value: 'ltr', label: 'Left to right' },
                        { value: 'rtl', label: 'Right to left' },
                      ]}
                    />
                    <p className={cn('text-[12px]', activeLanguage.direction === 'rtl' ? 'text-[var(--info-text)]' : 'text-[var(--text-tertiary)]')}>
                      {activeLanguage.direction === 'rtl'
                        ? 'The whole interface mirrors. Components use logical properties, so no screen needs its own RTL rules.'
                        : 'LTR is correct for this language.'}
                    </p>
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}
      </TabPanel>

      <FormDialog
        open={creating}
        onClose={() => setCreating(false)}
        title="Add a language"
        description="Create the language first, then translate it from the Translate tab."
        submitLabel="Add language"
        onSubmit={() =>
          create.mutate({
            code: draft.code.trim().toLowerCase(),
            name: draft.name.trim(),
            nativeName: draft.nativeName.trim() || draft.name.trim(),
            direction: draft.direction,
            isActive: true,
          })
        }
        submitting={create.isPending}
        disabled={draft.code.trim().length < 2 || draft.name.trim() === ''}
      >
        <div className="space-y-4">
          <Alert tone="neutral">
            Use the ISO 639-1 code, lower case: <span className="font-mono">ar</span>, <span className="font-mono">ur</span>,{' '}
            <span className="font-mono">fr</span>. Direction is detected automatically for right-to-left languages.
          </Alert>
          <FormField label="Code" required hint="Two letters, e.g. ar">
            {(id) => (
              <Input
                id={id}
                value={draft.code}
                maxLength={5}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    code: event.target.value,
                    direction: RTL_CODES.has(event.target.value.toLowerCase()) ? 'rtl' : current.direction,
                  }))
                }
              />
            )}
          </FormField>
          <FormField label="English name" required>
            {(id) => <Input id={id} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Arabic" />}
          </FormField>
          <FormField label="Name in that language" hint="Shown in the language switcher so users find their own script.">
            {(id) => <Input id={id} value={draft.nativeName} onChange={(event) => setDraft({ ...draft, nativeName: event.target.value })} dir="auto" />}
          </FormField>
          <FormField label="Writing direction">
            {(id) => (
              <Select
                id={id}
                value={draft.direction}
                onChange={(event) => setDraft({ ...draft, direction: event.target.value === 'rtl' ? 'rtl' : 'ltr' })}
                options={[
                  { value: 'ltr', label: 'Left to right' },
                  { value: 'rtl', label: 'Right to left' },
                ]}
              />
            )}
          </FormField>
        </div>
      </FormDialog>

      <ConfirmRequestDialog request={confirm} onClose={() => setConfirm(null)} pending={remove.isPending} cancelLabel="Keep it" />
    </Page>
  );
}

/** The Languages tab inside Settings links to this page rather than duplicating it. */
export function LanguagesSettings() {
  return (
    <Card flush>
      <CardHeader
        title="Languages"
        description="The languages this business trades in, and the translation editor."
        actions={
          <a href="/languages" className="text-[13px] text-[var(--accent-text)] hover:underline">
            Manage languages
          </a>
        }
      />
      <p className="px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        The translation editor lives on its own screen so you can work through keys without losing your place.
      </p>
    </Card>
  );
}

