/**
 * Customer select and quick create.
 *
 * Creating a customer with no network is a first-class path, not an error: the
 * record is written locally, queued as `CUSTOMER_CREATE`, and the UI says so
 * plainly. A cashier who is told "cannot create customer offline" simply serves
 * the customer as a walk-in, and the business loses the customer record
 * permanently.
 *
 * The pending badge on a selected customer carries through the cart panel for
 * the rest of the sale, because that customer's details may not be on the
 * server yet when the invoice is raised.
 */

import { useEffect, useMemo, useState } from 'react';
import { CloudOff, UserPlus, Users } from 'lucide-react';
import { useT } from '../../lib/i18n';
import { Badge, Button, Divider, EmptyState, Field, Input, Modal, Spinner, cx } from './ui';

export interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
  /** True when this row was created on this till and has not synced. */
  pendingSync?: boolean;
}

export interface QuickCustomerDraft {
  name: string;
  phone: string;
  email: string;
}

export interface CustomerPickerProps {
  open: boolean;
  customers: CustomerOption[];
  loading: boolean;
  onSelect: (customer: CustomerOption) => void;
  onClear: () => void;
  onCreate: (draft: QuickCustomerDraft) => Promise<void>;
  onClose: () => void;
}

export function CustomerPicker({ open, customers, loading, onSelect, onClear, onCreate, onClose }: CustomerPickerProps) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<QuickCustomerDraft>({ name: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCreating(false);
    setDraft({ name: '', phone: '', email: '' });
    setError(null);
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle === ''
      ? customers
      : customers.filter((c) => c.name.toLowerCase().includes(needle) || (c.phone ?? '').toLowerCase().includes(needle));
    return list.slice(0, 60);
  }, [customers, query]);

  const submit = async (): Promise<void> => {
    if (draft.name.trim() === '') {
      setError('A customer needs a name');
      return;
    }
    setBusy(true);
    try {
      await onCreate(draft);
      setCreating(false);
      setDraft({ name: '', phone: '', email: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Customer"
      onClose={onClose}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClear}>
            Continue as walk-in
          </Button>
          <Button variant="secondary" onClick={() => setCreating((value) => !value)}>
            <UserPlus size={14} strokeWidth={1.75} />
            {creating ? 'Cancel new customer' : 'New customer'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or phone"
          autoFocus
          aria-label="Search customers"
        />

        {creating ? (
          <div className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-sunken)] p-3">
            <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <CloudOff size={14} strokeWidth={1.75} />
              This customer is saved on this till straight away and sent to the server as soon as there is a connection.
            </div>
            <Field label={t('common.name')}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  autoFocus
                />
              )}
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('common.phone')}>
                {(id) => (
                  <Input id={id} value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
                )}
              </Field>
              <Field label={t('common.email')}>
                {(id) => (
                  <Input id={id} value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
                )}
              </Field>
            </div>
            {error ? <p className="text-[12px] text-[var(--danger-text)]">{error}</p> : null}
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? <Spinner /> : <UserPlus size={14} strokeWidth={1.75} />}
              Save customer
            </Button>
          </div>
        ) : null}

        <Divider />

        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : results.length === 0 ? (
          <EmptyState
            icon={<Users size={22} strokeWidth={1.75} />}
            title="No customers on this till"
            description={
              customers.length === 0
                ? 'This terminal has no customer list yet. Sync once to download it, or create a customer now — it will be saved locally either way.'
                : `Nothing matches "${query}".`
            }
          />
        ) : (
          <ul className="scrollbar-thin flex max-h-72 flex-col gap-1 overflow-y-auto">
            {results.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  onClick={() => onSelect(customer)}
                  className={cx(
                    'flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-transparent px-2 py-1.5 text-start',
                    'hover:border-[var(--border-default)] hover:bg-[var(--bg-sunken)]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-primary)]">{customer.name}</span>
                  {customer.phone ? (
                    <span className="tabular shrink-0 text-[11px] text-[var(--text-tertiary)]">{customer.phone}</span>
                  ) : null}
                  {customer.pendingSync ? <Badge tone="warning">Not yet synced</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
