import { useMemo, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';

import type { Permission } from '@monopos/shared';
import { useAuth } from '../../lib/auth';
import { ApiError } from '../../lib/api';
import {
  useApiList,
  useCreate,
  useRemove,
  useUpdate,
  type ListMeta,
  type QueryParams,
} from '../../lib/queries';
import { Button } from '../ui/Button';
import { ConfirmRequestDialog, type ConfirmRequest } from '../ui/ConfirmDialog';
import { FormDialog } from '../ui/Modal';
import { FormField, FormGrid, FormSection } from '../ui/Form';
import { Input, Textarea } from '../ui/Input';
import { Select } from '../ui/Select';
import { Switch } from '../ui/Toggle';
import { MoneyInput, QuantityInput } from '../ui/NumberInput';
import { DateInput } from '../ui/SearchInput';
import { SearchInput } from '../ui/SearchInput';
import { ActiveBadge } from '../ui/Badge';
import { PageHeader } from '../shell/PageHeader';
import { Page } from './Page';
import { FilterBar, type ActiveFilter } from './FilterBar';
import { DataTable, type Column } from './DataTable';

/**
 * The list page pattern, once.
 *
 * Roughly twenty screens in this product are the same shape: a searchable
 * table of reference records with a create/edit dialog and a delete
 * confirmation. Writing that twenty times is how pages drift apart — different
 * validation, different empty states, different "what happens on a 409".
 * `CrudPage` owns that behaviour and the pages supply only their columns and
 * field definitions.
 */

export type CrudFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'textarea'
  | 'money'
  | 'qty'
  | 'number'
  | 'select'
  | 'switch'
  | 'date'
  | 'checkbox';

export interface CrudFieldOption {
  value: string;
  label: string;
  group?: string;
}

export interface CrudField {
  name: string;
  label: string;
  type: CrudFieldType;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  /** Spans the full dialog width. Use for textareas and switches. */
  full?: boolean;
  options?: CrudFieldOption[];
  /** Options that depend on the record being edited (e.g. child categories). */
  optionsFor?: (editing: unknown) => CrudFieldOption[];
  /** Section heading this field belongs to. Fields sharing a name are grouped. */
  section?: string;
  sectionHint?: string;
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
}

export interface CrudPermissions {
  create?: Permission;
  update?: Permission;
  delete?: Permission;
}

export interface CrudPageProps<T> {
  tableId: string;
  title: string;
  description?: string;
  /** Resource path without an id, e.g. `/categories`. */
  path: string;
  columns: Column<T>[];
  fields: CrudField[];
  getRowId: (row: T) => string;
  /** Name used in confirmations and empty states. */
  entityName: (row: T) => string;
  permissions?: CrudPermissions;
  searchPlaceholder?: string;
  /** Extra query parameters merged into the request (filters, branch, dates). */
  params?: QueryParams;
  /** Extra filter controls rendered in the collapsible filter row. */
  filterFields?: CrudFilterField[];
  emptyTitle?: string;
  emptyDescription?: string;
  createLabel?: string;
  /** Custom header buttons next to the primary action. */
  headerActions?: ReactNode;
  /** Row-click navigation, or a detail link in the first column. */
  currency?: string;
  /** Runs before the request; return `false` to abort (e.g. a failed check). */
  beforeSubmit?: (form: Record<string, unknown>, editing: T | null) => boolean;
  /** Map form state to the request body. */
  toBody?: (form: Record<string, unknown>, editing: T | null) => Record<string, unknown>;
  /** Seed form state from a row. */
  fromRow?: (row: T) => Record<string, unknown>;
  /** Query keys invalidated after a write. */
  invalidate: readonly (readonly unknown[])[];
  /** Rendered under the header, e.g. a summary strip. */
  summary?: ReactNode;
  /** Suppress pagination for short reference lists. */
  paginated?: boolean;
}

export function CrudPage<T>({
  tableId,
  title,
  description,
  path,
  columns,
  fields,
  getRowId,
  entityName,
  permissions,
  searchPlaceholder = 'Search',
  params,
  filterFields,
  emptyTitle,
  emptyDescription,
  createLabel = 'New',
  headerActions,
  currency = 'USD',
  beforeSubmit,
  toBody,
  fromRow,
  invalidate,
  summary,
  paginated = true,
}: CrudPageProps<T>) {
  const { can } = useAuth();
  const may = {
    create: !permissions?.create || can(permissions.create),
    update: !permissions?.update || can(permissions.update),
    delete: !permissions?.delete || can(permissions.delete),
  };

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const requestParams = useMemo(
    () => ({
      ...(params ?? {}),
      page,
      pageSize,
      ...(search ? { search } : {}),
      ...filters,
    }),
    [params, page, pageSize, search, filters],
  );

  const list = useApiList<T>([tableId, requestParams], path, requestParams, { enabled: paginated });

  const create = useCreate<Record<string, unknown>>(invalidate);
  const update = useUpdate<Record<string, unknown>>(invalidate);
  const remove = useRemove(invalidate);

  const defaultForm = useMemo(() => {
    const next: Record<string, unknown> = {};
    for (const field of fields) {
      next[field.name] = field.defaultValue ?? (field.type === 'switch' || field.type === 'checkbox' ? false : '');
    }
    return next;
  }, [fields]);

  const startCreate = () => {
    setEditing(null);
    setForm({ ...defaultForm });
    setErrors({});
    setFormError(null);
    setOpen(true);
  };

  const startEdit = (row: T) => {
    setEditing(row);
    setForm({ ...defaultForm, ...(fromRow ? fromRow(row) : {}) });
    setErrors({});
    setFormError(null);
    setOpen(true);
  };

  const submit = () => {
    if (beforeSubmit && !beforeSubmit(form, editing)) return;

    const body = toBody ? toBody(form, editing) : form;

    const onSettled = (error: unknown) => {
      if (!error) {
        setOpen(false);
        return;
      }
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const mapped: Record<string, string> = {};
        for (const [key, value] of Object.entries(error.details ?? {})) {
          mapped[key] = Array.isArray(value) ? (value[0] ?? '') : value;
        }
        setErrors(mapped);
        setFormError(null);
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError('Something went wrong.');
      }
    };

    if (editing) {
      update.mutate(
        { path: `${path}/${getRowId(editing)}`, ...body },
        { onSuccess: () => toast.success(`${title.replace(/s$/, '')} updated`), onError: onSettled },
      );
    } else {
      create.mutate(
        { path, ...body },
        { onSuccess: () => toast.success(`${title.replace(/s$/, '')} created`), onError: onSettled },
      );
    }
  };

  const askDelete = (row: T) => {
    setConfirm({
      title: `Delete ${entityName(row)}?`,
      description: `This removes it from ${title.toLowerCase()}. Records already used on documents keep their history.`,
      confirmLabel: 'Delete',
      onConfirm: () =>
        remove.mutate(
          { path: `${path}/${getRowId(row)}` },
          {
            onSuccess: () => {
              setConfirm(null);
              toast.success(`${entityName(row)} deleted`);
            },
            onError: () => setConfirm(null),
          },
        ),
    });
  };

  const withActions = may.update || may.delete
    ? [
        ...columns,
        {
          key: '__actions',
          header: '',
          align: 'end' as const,
          width: '7rem',
          cell: (row: T) => (
            <div className="flex items-center justify-end gap-1">
              {may.update && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    startEdit(row);
                  }}
                >
                  Edit
                </Button>
              )}
              {may.delete && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-[var(--danger-text)]"
                  onClick={(event) => {
                    event.stopPropagation();
                    askDelete(row);
                  }}
                >
                  Delete
                </Button>
              )}
            </div>
          ),
        },
      ]
    : columns;

  const activeFilters: ActiveFilter[] = Object.entries(filters)
    .filter(([, value]) => value !== '')
    .map(([key, value]) => ({
      key,
      label: `${fieldLabel(fields, filterFields, key)}: ${value}`,
      onRemove: () => setFilters((current) => ({ ...current, [key]: '' })),
    }));

  const emptyMeta: ListMeta = { total: 0, page: 1, pageSize, pageCount: 1 };

  return (
    <Page>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {headerActions}
            {may.create && (
              <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={startCreate}>
                {createLabel}
              </Button>
            )}
          </>
        }
      />

      {summary}

      <DataTable
        tableId={tableId}
        columns={withActions}
        rows={list.data?.rows ?? []}
        meta={list.data?.meta ?? emptyMeta}
        getRowId={getRowId}
        isLoading={list.isPending}
        isRefetching={list.isFetching && !list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        {...(paginated ? { onPageChange: setPage, onPageSizeChange: setPageSize } : {})}
        exportName={tableId}
        toolbar={
          <FilterBar
            className="w-full"
            active={activeFilters}
            {...(activeFilters.length > 0 ? { onClearAll: () => setFilters({}) } : {})}
          >
            <SearchInput value={search} onValueChange={(value) => { setSearch(value); setPage(1); }} placeholder={searchPlaceholder} />
          </FilterBar>
        }
        filters={
          filterFields && filterFields.length > 0 ? (
            <>
              {filterFields.map((field) => (
                <div key={field.name} className="min-w-0 w-[10rem]">
                  <Select
                    label={field.label}
                    placeholder="All"
                    value={filters[field.name] ?? ''}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, [field.name]: event.target.value }));
                      setPage(1);
                    }}
                    options={field.options ?? []}
                  />
                </div>
              ))}
            </>
          ) : undefined
        }
        emptyTitle={
          search || activeFilters.length > 0
            ? `No ${title.toLowerCase()} match those filters`
            : (emptyTitle ?? `No ${title.toLowerCase()} yet`)
        }
        emptyDescription={
          search || activeFilters.length > 0
            ? 'Try a shorter search, or clear the filters.'
            : emptyDescription
        }
        emptyAction={
          may.create && !search && activeFilters.length === 0
            ? { label: createLabel, onClick: startCreate, icon: <Plus size={15} strokeWidth={1.75} /> }
            : undefined
        }
      />

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${entityName(editing)}` : createLabel}
        onSubmit={submit}
        submitting={create.isPending || update.isPending}
        submitLabel={editing ? 'Save changes' : 'Create'}
        size="lg"
      >
        <div className="space-y-5">
          {formError && (
            <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger-text)]">
              {formError}
            </p>
          )}
          <FormSections
            fields={fields}
            form={form}
            setForm={setForm}
            errors={errors}
            currency={currency}
            editing={editing}
          />
        </div>
      </FormDialog>

      <ConfirmRequestDialog request={confirm} onClose={() => setConfirm(null)} pending={remove.isPending} cancelLabel="Keep it" />
    </Page>
  );
}

function fieldLabel(fields: CrudField[], filterFields: CrudFilterField[] | undefined, key: string): string {
  return [...fields, ...(filterFields ?? [])].find((field) => field.name === key)?.label ?? key;
}

function FormSections<T>({
  fields,
  form,
  setForm,
  errors,
  currency,
  editing,
}: {
  fields: CrudField[];
  form: Record<string, unknown>;
  setForm: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  errors: Record<string, string>;
  currency: string;
  editing: T | null;
}) {
  const sections: Array<{ name?: string; hint?: string; fields: CrudField[] }> = [];

  for (const field of fields) {
    const last = sections[sections.length - 1];
    if (last && last.name === field.section) last.fields.push(field);
    else sections.push({ name: field.section, hint: field.sectionHint, fields: [field] });
  }

  return (
    <>
      {sections.map((section, index) => (
        <FormSection key={section.name ?? index} title={section.name} description={section.hint}>
          <FormGrid>
            {section.fields.map((field) => (
              <FieldControl
                key={field.name}
                field={field}
                value={form[field.name]}
                error={errors[field.name]}
                onChange={(value) => setForm((current) => ({ ...current, [field.name]: value }))}
                currency={currency}
                editing={editing}
                wrapperClassName={field.full ? 'sm:col-span-2' : undefined}
              />
            ))}
          </FormGrid>
        </FormSection>
      ))}
    </>
  );
}

function FieldControl({
  field,
  value,
  error,
  onChange,
  currency,
  editing,
  wrapperClassName,
}: {
  field: CrudField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  currency: string;
  editing: unknown;
  wrapperClassName?: string;
}) {
  const options = field.optionsFor && editing ? field.optionsFor(editing) : field.options;

  if (field.type === 'switch' || field.type === 'checkbox') {
    return (
      <div className={wrapperClassName}>
        <Switch
          label={field.label}
          description={field.hint}
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
    );
  }

  return (
    <FormField
      label={field.label}
      required={field.required}
      {...(error ? { error } : {})}
      {...(field.hint && !error ? { hint: field.hint } : {})}
      className={wrapperClassName}
    >
      {(id) => {
        switch (field.type) {
          case 'textarea':
            return (
              <Textarea
                id={id}
                rows={3}
                value={String(value ?? '')}
                placeholder={field.placeholder}
                onChange={(event) => onChange(event.target.value)}
              />
            );
          case 'select':
            return (
              <Select
                id={id}
                placeholder={field.placeholder ?? 'None'}
                value={String(value ?? '')}
                options={options ?? []}
                onChange={(event) => onChange(event.target.value)}
              />
            );
          case 'money':
            return (
              <MoneyInput
                id={id}
                value={typeof value === 'number' ? value : 0}
                onValueChange={onChange}
                currency={currency}
                {...(field.min !== undefined ? { min: field.min } : {})}
                {...(field.max !== undefined ? { max: field.max } : {})}
              />
            );
          case 'qty':
            return (
              <QuantityInput
                id={id}
                value={typeof value === 'number' ? value : 0}
                onValueChange={onChange}
                {...(field.min !== undefined ? { min: field.min } : {})}
              />
            );
          case 'number':
            return (
              <Input
                id={id}
                type="number"
                inputMode="decimal"
                value={String(value ?? '')}
                placeholder={field.placeholder}
                onChange={(event) => onChange(event.target.value === '' ? 0 : Number(event.target.value))}
              />
            );
          case 'date':
            return (
              <DateInput
                id={id}
                value={String(value ?? '')}
                onValueChange={onChange}
                {...(field.hint ? { hint: field.hint } : {})}
              />
            );
          default:
            return (
              <Input
                id={id}
                type={field.type === 'email' ? 'email' : field.type === 'tel' ? 'tel' : 'text'}
                value={String(value ?? '')}
                placeholder={field.placeholder}
                onChange={(event) => onChange(event.target.value)}
              />
            );
        }
      }}
    </FormField>
  );
}

/**
 * A select shown in the collapsible filter row.
 *
 * A distinct type from `CrudField` because a filter never carries a value type,
 * a hint or a section — it only narrows the request.
 */
export interface CrudFilterField {
  name: string;
  label: string;
  options: CrudFieldOption[];
}

/** Shared "Status" column for any record with an `isActive` flag. */
export function activeStatusColumn<T extends { isActive?: boolean }>(header = 'Status'): Column<T> {
  return {
    key: 'status',
    header,
    value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
    width: '7rem',
    cell: (row) => <ActiveBadge isActive={row.isActive} />,
  };
}
