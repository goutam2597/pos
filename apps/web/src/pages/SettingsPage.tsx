import { useMemo, useState } from 'react';
import { KeyRound, Plus, Save } from 'lucide-react';

import { ACTIONS, RESOURCES, allPermissions, type Permission } from '@monopos/shared';
import { cn } from '../lib/cn';
import { dateTime, relativeTime } from '../lib/format';
import {
  queryKeys,
  useApiList,
  useApiMutation,
  useApiQuery,
  type AuditLog,
  type Branch,
  type Register,
  type Role,
  type SyncOverview,
  type User,
  type Warehouse,
} from '../lib/queries';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { DataTable, type Column } from '../components/data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/data/Table';
import { SearchInput } from '../components/ui/SearchInput';
import { Select } from '../components/ui/Select';
import { Switch } from '../components/ui/Toggle';
import { Checkbox } from '../components/ui/Toggle';
import { Input, Textarea } from '../components/ui/Input';
import { FormDialog } from '../components/ui/Modal';
import { FormField, FormGrid, FormSection } from '../components/ui/Form';
import { ActiveBadge, Badge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { Alert } from '../components/ui/Feedback';
import { DateRangePicker, isoDaysAgo, todayIso } from '../components/ui/SearchInput';
import { TabPanel, Tabs } from '../components/ui/Tabs';
import { PageHeader } from '../components/shell/PageHeader';
import { useTabs } from '../components/ui/Tabs';
import { Page, useQueryState } from './_shared';

/**
 * Settings, users, roles and the audit trail.
 *
 * Grouped into one Settings page with tabs because these are all "configure the
 * business once" surfaces — a shop owner visits them rarely and expects them to
 * be in one predictable place. Users, roles and audit get their own top-level
 * routes as well, because they are also linked to directly from elsewhere.
 */

// ---------------------------------------------------------------------------
// Branches, warehouses and registers
// ---------------------------------------------------------------------------

export function BranchesPage() {
  const { api, can } = useAuth();
  const [editing, setEditing] = useState<Branch | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', address: '', phone: '', email: '', isActive: true });

  const list = useApiList<Branch>(queryKeys.branches, '/branches', { page: 1, pageSize: 200 }, { enabled: false });

  const query = useApiQuery<Branch[]>(queryKeys.branches, (signal) => api.data<Branch[]>('/branches', { signal }));
  const rows = query.data ?? [];

  const save = useApiMutation<{ path: string } & Record<string, unknown>, unknown>({
    invalidate: [queryKeys.branches],
    mutationFn: ({ path, ...body }) => (editing ? api.patch(path, body) : api.post(path, body)),
    successMessage: editing ? 'Branch updated' : 'Branch created',
    onSuccess: () => setOpen(false),
  });

  const columns: Column<Branch>[] = [
    {
      key: 'name',
      header: 'Branch',
      value: (row) => row.name,
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          {row.code && <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.code}</p>}
        </div>
      ),
    },
    { key: 'address', header: 'Address', optional: true, value: (row) => row.address, cell: (row) => row.address ?? '—' },
    { key: 'phone', header: 'Phone', optional: true, value: (row) => row.phone, cell: (row) => row.phone ?? '—' },
    {
      key: 'status',
      header: 'Status',
      value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
      width: '8rem',
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          <ActiveBadge isActive={row.isActive} />
          {row.isDefault && <Badge tone="brand">Default</Badge>}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '6rem',
      cell: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(row);
            setForm({
              name: row.name,
              code: row.code ?? '',
              address: row.address ?? '',
              phone: row.phone ?? '',
              email: row.email ?? '',
              isActive: row.isActive !== false,
            });
            setOpen(true);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Branches"
        description="Locations. Users are granted access to specific branches from the Users tab."
        actions={
          can('branch:create') ? (
            <Button
              variant="primary"
              icon={<Plus size={16} strokeWidth={1.75} />}
              onClick={() => {
                setEditing(null);
                setForm({ name: '', code: '', address: '', phone: '', email: '', isActive: true });
                setOpen(true);
              }}
            >
              New branch
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="branches"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        exportName="branches"
        emptyTitle="No branches yet"
        emptyDescription="A single-location business does not need a branch — this list can stay empty."
        emptyAction={can('branch:create') ? { label: 'New branch', onClick: () => setOpen(true) } : undefined}
      />

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New branch'}
        onSubmit={() =>
          save.mutate({
            path: editing ? `/branches/${editing.id}` : '/branches',
            name: form.name.trim(),
            code: form.code.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
            isActive: form.isActive,
          })
        }
        submitting={save.isPending}
      >
        <FormGrid>
          <FormField label="Name" required>
            {(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
          </FormField>
          <FormField label="Code">
            {(id) => <Input id={id} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="MAIN" />}
          </FormField>
          <div className="sm:col-span-2">
            <FormField label="Address">
              {(id) => <Input id={id} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} />}
            </FormField>
          </div>
          <FormField label="Phone">
            {(id) => <Input id={id} type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}
          </FormField>
          <FormField label="Email">
            {(id) => <Input id={id} type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />}
          </FormField>
          <div className="sm:col-span-2">
            <Switch
              label="Active"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
          </div>
        </FormGrid>
      </FormDialog>

      <span className="sr-only">{list.isPending ? 'loading' : ''}</span>
    </Page>
  );
}

export function WarehousesPage() {
  const { api } = useAuth();
  const branches = useApiQuery<Branch[]>(queryKeys.branches, (signal) => api.data<Branch[]>('/branches', { signal }));
  const query = useApiQuery<Warehouse[]>(queryKeys.warehouses, (signal) => api.data<Warehouse[]>('/warehouses', { signal }));
  const rows = query.data ?? [];

  const columns: Column<Warehouse>[] = [
    { key: 'name', header: 'Warehouse', value: (row) => row.name, sticky: true, cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: 'code', header: 'Code', value: (row) => row.code, width: '8rem', cell: (row) => row.code ?? '—' },
    { key: 'type', header: 'Type', value: (row) => row.type, width: '9rem', cell: (row) => <span className="text-[var(--text-secondary)]">{(row.type ?? 'STORE').replace('_', ' ').toLowerCase()}</span> },
    { key: 'branch', header: 'Branch', value: (row) => row.branchName, cell: (row) => row.branchName ?? 'All branches' },
    { key: 'address', header: 'Address', optional: true, value: (row) => row.address, cell: (row) => row.address ?? '—' },
    {
      key: 'status',
      header: 'Status',
      value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
      width: '7rem',
      cell: (row) => <ActiveBadge isActive={row.isActive} />,
    },
  ];

  return (
    <Page>
      <PageHeader title="Warehouses" description="Where stock physically lives. Stock levels are counted per warehouse." />
      <DataTable
        tableId="warehouses"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        exportName="warehouses"
        emptyTitle="No warehouses yet"
        emptyDescription="A default store is created for you on first run."
      />
      <span className="sr-only">{branches.data?.length ?? 0} branches</span>
    </Page>
  );
}

export function RegistersPage() {
  const { api, branchId } = useAuth();
  const query = useApiQuery<Register[]>(
    queryKeys.registers({ branchId: branchId ?? undefined }),
    (signal) => api.data<Register[]>('/registers', { signal, query: { branchId: branchId ?? undefined } }),
  );
  const rows = query.data ?? [];

  const columns: Column<Register>[] = [
    { key: 'name', header: 'Register', value: (row) => row.name, sticky: true, cell: (row) => <span className="font-medium">{row.name}</span> },
    { key: 'code', header: 'Code', value: (row) => row.code, width: '8rem', cell: (row) => row.code ?? '—' },
    { key: 'branch', header: 'Branch', value: (row) => row.branchName, cell: (row) => row.branchName ?? '—' },
    {
      key: 'status',
      header: 'Status',
      value: (row) => row.status,
      width: '8rem',
      cell: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Registers"
        description="Tills. A register's ID is what the till app asks for on first sign-in."
      />
      <DataTable
        tableId="registers"
        columns={columns}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        exportName="registers"
        emptyTitle="No registers yet"
        emptyDescription="Register a till to let staff sign in at a specific point of sale."
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Users and roles
// ---------------------------------------------------------------------------

export function UsersPage() {
  const { api, can } = useAuth();
  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', phone: '', roleNames: [] as string[], isActive: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<User | null>(null);
  const [tempPassword, setTempPassword] = useState('');

  const roles = useApiQuery<Role[]>(queryKeys.roles, (signal) => api.data<Role[]>('/roles', { signal }));
  const branches = useApiQuery<Branch[]>(queryKeys.branches, (signal) => api.data<Branch[]>('/branches', { signal }));

  const params = useMemo(
    () => ({ page: 1, pageSize: 200, search: search || undefined, isActive: isActive || undefined }),
    [search, isActive],
  );

  const list = useApiList<User>(queryKeys.users(params), '/users', params);
  const rows = list.data?.rows ?? [];

  const save = useApiMutation<{ path: string } & Record<string, unknown>, unknown>({
    invalidate: [queryKeys.users({}), ['users']],
    mutationFn: ({ path, ...body }) => (editing ? api.patch(path, body) : api.post(path, body)),
    successMessage: editing ? 'User updated' : 'User created',
    onSuccess: () => setOpen(false),
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED') {
        const mapped: Record<string, string> = {};
        for (const [key, value] of Object.entries(error.details ?? {})) {
          mapped[key] = Array.isArray(value) ? (value[0] ?? '') : value;
        }
        setErrors(mapped);
      }
    },
  });

  const resetPassword = useApiMutation<{ id: string }, { temporaryPassword?: string }>({
    mutationFn: ({ id }) => api.post(`/users/${id}/reset-password`),
    successMessage: 'Password reset — share the temporary password securely',
    onSuccess: (result) => {
      setTempPassword(result?.temporaryPassword ?? '');
    },
  });

  const columns: Column<User>[] = [
    {
      key: 'name',
      header: 'User',
      value: (row) => `${row.firstName} ${row.lastName ?? ''}`.trim(),
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{[row.firstName, row.lastName].filter(Boolean).join(' ') || row.email}</p>
          <p className="truncate text-[12px] text-[var(--text-tertiary)]">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      value: (row) => (row.roleNames ?? []).join(', '),
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.roleNames ?? []).map((role) => (
            <Badge key={role} tone="brand">
              {role}
            </Badge>
          ))}
          {(row.roleNames?.length ?? 0) === 0 && <span className="text-[var(--text-tertiary)]">—</span>}
        </div>
      ),
    },
    {
      key: 'branches',
      header: 'Branches',
      optional: true,
      value: (row) => (row.branchNames ?? []).join(', '),
      cell: (row) => <span className="text-[var(--text-secondary)]">{(row.branchNames ?? []).join(', ') || 'All'}</span>,
    },
    {
      key: 'lastLogin',
      header: 'Last seen',
      optional: true,
      value: (row) => row.lastLoginAt,
      cell: (row) => <span className="text-[var(--text-secondary)]">{row.lastLoginAt ? relativeTime(row.lastLoginAt) : 'Never'}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (row) => (row.isActive === false ? 'INACTIVE' : 'ACTIVE'),
      width: '7rem',
      cell: (row) => <ActiveBadge isActive={row.isActive} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      width: '9rem',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(row);
              setErrors({});
              setForm({
                email: row.email,
                firstName: row.firstName,
                lastName: row.lastName ?? '',
                phone: row.phone ?? '',
                roleNames: row.roleNames ?? [],
                isActive: row.isActive !== false,
              });
              setOpen(true);
            }}
          >
            Edit
          </Button>
          {can('user:update') && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              aria-label={`Reset password for ${row.email}`}
              onClick={() => {
                setTempPassword('');
                setResetting(row);
              }}
            >
              <KeyRound size={15} strokeWidth={1.75} />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Page>
      <PageHeader
        title="Users"
        description="Who can sign in, what they can do, and which branches they can see."
        actions={
          can('user:create') ? (
            <Button
              variant="primary"
              icon={<Plus size={16} strokeWidth={1.75} />}
              onClick={() => {
                setEditing(null);
                setErrors({});
                setForm({ email: '', firstName: '', lastName: '', phone: '', roleNames: [], isActive: true });
                setOpen(true);
              }}
            >
              New user
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="users"
        columns={columns}
        rows={rows}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 200, pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        exportName="users"
        toolbar={
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search name or email" className="w-full sm:w-72" />
        }
        filters={
          <div className="w-[10rem]">
            <Select
              label="Status"
              placeholder="Any"
              value={isActive}
              onChange={(event) => setIsActive(event.target.value)}
              options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
            />
          </div>
        }
        emptyTitle={search ? 'No users match' : 'No users yet'}
      />

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.email}` : 'New user'}
        description={editing ? 'Changing roles takes effect the next time they load a page.' : 'A temporary password is emailed to them.'}
        onSubmit={() =>
          save.mutate({
            path: editing ? `/users/${editing.id}` : '/users',
            email: form.email.trim(),
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim() || null,
            phone: form.phone.trim() || null,
            roleNames: form.roleNames,
            isActive: form.isActive,
          })
        }
        submitting={save.isPending}
      >
        <div className="space-y-4">
          <FormGrid>
            <FormField label="Email" required error={errors.email}>
              {(id) => (
                <Input
                  id={id}
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                  disabled={editing !== null}
                />
              )}
            </FormField>
            <FormField label="First name" required error={errors.firstName}>
              {(id) => <Input id={id} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} />}
            </FormField>
            <FormField label="Last name">
              {(id) => <Input id={id} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} />}
            </FormField>
            <FormField label="Phone">
              {(id) => <Input id={id} type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />}
            </FormField>
          </FormGrid>

          <FormSection title="Roles" description="Permissions come from the roles, never from the user directly.">
            <div className="space-y-2">
              {(roles.data ?? []).map((role) => (
                <Checkbox
                  key={role.id}
                  label={
                    <span className="flex items-center gap-2">
                      {role.name}
                      {role.isSystem && <Badge tone="neutral">System</Badge>}
                    </span>
                  }
                  checked={form.roleNames.includes(role.name)}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      roleNames: event.target.checked
                        ? [...current.roleNames, role.name]
                        : current.roleNames.filter((name) => name !== role.name),
                    }))
                  }
                />
              ))}
              {(roles.data?.length ?? 0) === 0 && (
                <p className="text-[13px] text-[var(--text-tertiary)]">No roles available.</p>
              )}
            </div>
          </FormSection>

          <Switch
            label="Active"
            description="Inactive users keep their history but cannot sign in."
            checked={form.isActive}
            onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
          />

          <span className="sr-only">{branches.data?.length ?? 0} branches available</span>
        </div>
      </FormDialog>

      <FormDialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title="Reset password"
        description={resetting ? `Set a new password for ${resetting.email}.` : ''}
        submitLabel="Reset password"
        onSubmit={() => resetting && resetPassword.mutate({ id: resetting.id })}
        submitting={resetPassword.isPending}
        size="sm"
      >
        {tempPassword ? (
          <Alert tone="warning" title="Temporary password">
            <p className="font-mono text-[13px] break-all">{tempPassword}</p>
            <p className="mt-1">It is shown once. Deliver it in person, not over chat.</p>
          </Alert>
        ) : (
          <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
            Their current password stops working immediately and any open sessions are ended.
          </p>
        )}
      </FormDialog>
    </Page>
  );
}

export function RolesPage() {
  const { api, can } = useAuth();
  const [editing, setEditing] = useState<Role | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', permissions: [] as string[] });

  const query = useApiQuery<Role[]>(queryKeys.roles, (signal) => api.data<Role[]>('/roles', { signal }));
  const rows = query.data ?? [];

  const save = useApiMutation<{ path: string } & Record<string, unknown>, unknown>({
    invalidate: [queryKeys.roles],
    mutationFn: ({ path, ...body }) => (editing ? api.patch(path, body) : api.post(path, body)),
    successMessage: editing ? 'Role updated' : 'Role created',
    onSuccess: () => setOpen(false),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const permission of allPermissions()) {
      const [resource] = permission.split(':');
      if (!resource) continue;
      map.set(resource, [...(map.get(resource) ?? []), permission]);
    }
    return [...map.entries()];
  }, []);

  const toggle = (permission: string) => {
    setForm((current) => ({
      ...current,
      permissions: current.permissions.includes(permission)
        ? current.permissions.filter((p) => p !== permission)
        : [...current.permissions, permission],
    }));
  };

  return (
    <Page>
      <PageHeader
        title="Roles"
        description="A named bundle of permissions. Assign roles to users; never permissions directly."
        actions={
          can('role:create') ? (
            <Button
              variant="primary"
              icon={<Plus size={16} strokeWidth={1.75} />}
              onClick={() => {
                setEditing(null);
                setForm({ name: '', description: '', permissions: [] });
                setOpen(true);
              }}
            >
              New role
            </Button>
          ) : undefined
        }
      />

      <DataTable
        tableId="roles"
        columns={[
          {
            key: 'name',
            header: 'Role',
            value: (row) => row.name,
            sticky: true,
            cell: (row) => (
              <div className="flex items-center gap-2">
                <span className="font-medium">{row.name}</span>
                {row.isSystem && <Badge tone="neutral">System</Badge>}
              </div>
            ),
          },
          {
            key: 'description',
            header: 'Description',
            optional: true,
            value: (row) => row.description,
            cell: (row) => <span className="text-[var(--text-secondary)]">{row.description ?? '—'}</span>,
          },
          {
            key: 'permissions',
            header: 'Permissions',
            align: 'end',
            value: (row) => row.permissions?.length ?? 0,
            width: '8rem',
            cell: (row) => <span className="tabular-nums">{row.permissions?.length ?? 0}</span>,
          },
          {
            key: 'users',
            header: 'Users',
            align: 'end',
            optional: true,
            value: (row) => row.userCount ?? 0,
            width: '6rem',
            cell: (row) => <span className="tabular-nums">{row.userCount ?? 0}</span>,
          },
          {
            key: 'actions',
            header: '',
            align: 'end',
            width: '6rem',
            cell: (row) => (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(row);
                  setForm({ name: row.name, description: row.description ?? '', permissions: row.permissions ?? [] });
                  setOpen(true);
                }}
              >
                Edit
              </Button>
            ),
          },
        ]}
        rows={rows}
        meta={{ total: rows.length, page: 1, pageSize: Math.max(rows.length, 1), pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        exportName="roles"
        emptyTitle="No roles"
      />

      <FormDialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'New role'}
        description="Tick what this role may do. Anything unticked is refused by the server, not just hidden."
        onSubmit={() =>
          save.mutate({
            path: editing ? `/roles/${editing.id}` : '/roles',
            name: form.name.trim(),
            description: form.description.trim() || null,
            permissions: form.permissions,
          })
        }
        submitting={save.isPending}
        size="xl"
      >
        <div className="space-y-4">
          <FormGrid>
            <FormField label="Role name" required>
              {(id) => <Input id={id} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />}
            </FormField>
            <FormField label="Description">
              {(id) => <Input id={id} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />}
            </FormField>
          </FormGrid>

          <FormSection title="Permission matrix" description={`${form.permissions.length} of ${allPermissions().length} granted`}>
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border-default)]">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="min-w-[10rem]">Resource</TableHead>
                    {ACTIONS.map((action) => (
                      <TableHead key={action} className="text-center">
                        {action.charAt(0).toUpperCase() + action.slice(1)}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {grouped.map(([resource, permissions]) => (
                    <TableRow key={resource}>
                      <TableCell className="font-medium">{resource}</TableCell>
                      {ACTIONS.map((action) => {
                        const permission = `${resource}:${action}` as Permission;
                        const granted = form.permissions.includes(permission);
                        return (
                          <TableCell key={action} className="text-center">
                            <Checkbox
                              checked={granted}
                              onChange={() => toggle(permission)}
                              aria-label={`${resource} ${action}`}
                              className="inline-flex"
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </FormSection>
        </div>
      </FormDialog>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Audit and sync
// ---------------------------------------------------------------------------

export function AuditPage() {
  const { api, can } = useAuth();
  const [query, patch] = useQueryState({
    page: 1,
    pageSize: 50,
    search: '',
    action: '',
    entityType: '',
    from: isoDaysAgo(7),
    to: todayIso(),
  });

  if (!can('audit:view')) {
    return (
      <Page>
        <PageHeader title="Audit log" />
        <Alert tone="warning">You do not have permission to view the audit log.</Alert>
      </Page>
    );
  }

  const params = useMemo(
    () => ({
      page: query.page,
      pageSize: query.pageSize,
      search: query.search || undefined,
      action: query.action || undefined,
      entityType: query.entityType || undefined,
      from: query.from || undefined,
      to: query.to || undefined,
    }),
    [query],
  );

  const list = useApiList<AuditLog>(queryKeys.audit(params), '/audit', params);

  const columns: Column<AuditLog>[] = [
    {
      key: 'when',
      header: 'When',
      value: (row) => row.createdAt,
      width: '12rem',
      sticky: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px]">{dateTime(row.createdAt)}</p>
          <p className="truncate text-[12px] text-[var(--text-tertiary)]">{relativeTime(row.createdAt)}</p>
        </div>
      ),
    },
    { key: 'action', header: 'Action', value: (row) => row.action, width: '7rem', cell: (row) => <StatusBadge status={row.action} label={row.action.toLowerCase()} /> },
    { key: 'entityType', header: 'Record', value: (row) => row.entityType, cell: (row) => <span className="text-[var(--text-secondary)]">{row.entityLabel ?? row.entityType}</span> },
    { key: 'user', header: 'Who', value: (row) => row.userName, cell: (row) => row.userName ?? row.userEmail ?? 'System' },
    { key: 'branch', header: 'Branch', optional: true, value: (row) => row.branchName, cell: (row) => row.branchName ?? '—' },
    { key: 'ip', header: 'From', optional: true, value: (row) => row.ip, cell: (row) => <span className="font-mono text-[12px] text-[var(--text-tertiary)]">{row.ip ?? '—'}</span> },
  ];

  return (
    <Page>
      <PageHeader title="Audit log" description="Who changed what, and when. Entries cannot be edited or deleted." />
      <DataTable
        tableId="audit"
        columns={columns}
        rows={list.data?.rows ?? []}
        meta={list.data?.meta ?? { total: 0, page: 1, pageSize: 50, pageCount: 1 }}
        getRowId={(row) => row.id}
        isLoading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
        onPageChange={(page) => patch({ page })}
        onPageSizeChange={(pageSize) => patch({ pageSize })}
        exportName="audit-log"
        toolbar={
          <div className="flex items-end gap-2.5">
            <SearchInput value={query.search} onValueChange={(search) => patch({ search })} placeholder="Search user or record" className="w-full sm:w-64" />
            <DateRangePicker from={query.from} to={query.to} onChange={(range) => patch({ from: range.from, to: range.to })} />
          </div>
        }
        filters={
          <>
            <div className="w-[10rem]">
              <Select
                label="Action"
                placeholder="Any action"
                value={query.action}
                onChange={(event) => patch({ action: event.target.value })}
                options={['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'APPROVE', 'VOID', 'SYNC', 'EXPORT', 'STOCKTAKE'].map((value) => ({ value, label: value.toLowerCase() }))}
              />
            </div>
            <div className="w-[11rem]">
              <Select
                label="Record type"
                placeholder="Any type"
                value={query.entityType}
                onChange={(event) => patch({ entityType: event.target.value })}
                options={RESOURCES.map((value) => ({ value: value.replace(/s$/, ''), label: value }))}
              />
            </div>
          </>
        }
        emptyTitle="Nothing logged in this period"
      />
    </Page>
  );
}

export function SyncPage() {
  const { api, can } = useAuth();

  const query = useApiQuery<SyncOverview>(
    queryKeys.sync,
    (signal) => api.data<SyncOverview>('/sync/overview', { signal }),
    { enabled: can('sync:view'), refetchInterval: 30_000 },
  );

  if (!can('sync:view')) {
    return (
      <Page>
        <PageHeader title="Synchronisation" />
        <Alert tone="warning">You do not have permission to view synchronisation.</Alert>
      </Page>
    );
  }

  const data = query.data;
  const devices = data?.devices ?? [];
  const failures = data?.recentFailures ?? [];

  return (
    <Page>
      <PageHeader
        title="Synchronisation"
        description="Every device that takes sales, and anything still waiting to reach the server."
        actions={
          <Button variant="secondary" loading={query.isFetching} onClick={() => void query.refetch()}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <p className="text-[13px] font-medium text-[var(--text-secondary)]">Waiting to sync</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{data?.pendingTotal ?? 0}</p>
          <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
            Sales captured offline are held on the device until they are accepted by the server.
          </p>
        </Card>

        <Card flush className="lg:col-span-2">
          <CardHeader title="Needs attention" description="Operations the server refused or could not reconcile." />
          {failures.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-[var(--text-tertiary)]">
              Nothing needs attention. Every queued operation has been accepted.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {failures.map((failure) => (
                <li key={failure.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">{failure.type ?? 'Operation'}</p>
                    <p className="truncate text-[12px] text-[var(--text-tertiary)]">
                      {[failure.code, failure.note].filter(Boolean).join(' · ') || 'No reason recorded'}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-[var(--text-disabled)]">{failure.clientTxnId}</p>
                  </div>
                  <StatusBadge status="FAILED" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card flush>
        <CardHeader title="Devices" description="Tills, tablets and computers signed in to this business." />
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Device</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last sync</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.map((device) => (
              <TableRow key={device.id}>
                <TableCell className="font-medium">{device.name ?? device.id}</TableCell>
                <TableCell className="text-[var(--text-secondary)]">{device.platform ?? '—'}</TableCell>
                <TableCell className="text-[var(--text-secondary)]">{device.appVersion ?? '—'}</TableCell>
                <TableCell className="text-[var(--text-secondary)]">{relativeTime(device.lastSyncedAt ?? null)}</TableCell>
                <TableCell>
                  <StatusBadge status={device.status} />
                </TableCell>
              </TableRow>
            ))}
            {query.isPending && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-[var(--text-tertiary)]">
                  Loading devices…
                </TableCell>
              </TableRow>
            )}
            {!query.isPending && devices.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-[var(--text-tertiary)]">
                  No other devices have signed in yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Settings shell
// ---------------------------------------------------------------------------

type SettingValue = string | number | boolean | null;

export function SettingsPage() {
  const { api, can, business, user } = useAuth();
  const [tab, setTab] = useTabs('general');

  const settings = useApiQuery<Record<string, SettingValue>>(
    queryKeys.settings,
    (signal) => api.data<Record<string, SettingValue>>('/settings', { signal }),
    { enabled: can('setting:view') || can('setting:manage') },
  );

  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const current = { ...(settings.data ?? {}), ...draft };

  const save = useApiMutation<Array<{ key: string; value: SettingValue }>, unknown>({
    invalidate: [queryKeys.settings],
    mutationFn: (entries) =>
      Promise.all(entries.map((entry) => api.patch('/settings', entry))),
    successMessage: 'Settings saved',
    onSuccess: () => setDraft({}),
  });

  const set = (key: string, value: SettingValue) => setDraft((state) => ({ ...state, [key]: value }));

  const dirty = Object.keys(draft).length > 0;

  const saveAll = () => {
    const entries = Object.entries(draft).map(([key, value]) => ({ key, value }));
    if (entries.length > 0) save.mutate(entries);
  };

  const tabs = [
    { value: 'general', label: 'General' },
    { value: 'business', label: 'Business' },
    { value: 'branches', label: 'Branches' },
    { value: 'numbering', label: 'Numbering' },
    { value: 'languages', label: 'Languages' },
    { value: 'taxes', label: 'Taxes' },
    ...(can('user:view') ? [{ value: 'users', label: 'Users' }] : []),
    ...(can('role:view') ? [{ value: 'roles', label: 'Roles' }] : []),
    ...(can('audit:view') ? [{ value: 'audit', label: 'Audit log' }] : []),
    ...(can('sync:view') ? [{ value: 'sync', label: 'Sync' }] : []),
  ];

  return (
    <Page>
      <PageHeader
        title="Settings"
        description={business ? `${business.name} · ${business.currency}` : undefined}
        actions={
          dirty ? (
            <Button variant="primary" icon={<Save size={15} strokeWidth={1.75} />} loading={save.isPending} onClick={saveAll}>
              Save changes
            </Button>
          ) : undefined
        }
      />

      <Tabs label="Settings sections" value={tab} onValueChange={setTab} items={tabs} className="mb-4" />

      <TabPanel value="general" active={tab}>
        <div className="max-w-2xl space-y-4">
          <Card>
            <CardHeader title="Appearance" description="Applies to this browser only." />
            <div className="space-y-3 p-4">
              <Select
                label="Date format"
                value={String(current.dateFormat ?? 'medium')}
                onChange={(event) => set('dateFormat', event.target.value)}
                options={[
                  { value: 'short', label: 'Short (12 Mar)' },
                  { value: 'medium', label: 'Medium (12 Mar 2026)' },
                  { value: 'long', label: 'Long (12 March 2026)' },
                ]}
              />
              <Select
                label="Low stock alerts"
                value={String(current.lowStockAlerts ?? 'true')}
                onChange={(event) => set('lowStockAlerts', event.target.value === 'true')}
                options={[
                  { value: 'true', label: 'Show on the dashboard' },
                  { value: 'false', label: 'Hide' },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Your account" />
            <div className="space-y-2 p-4 text-[13px]">
              <p className="text-[var(--text-secondary)]">Signed in as {user?.email}</p>
              <p className="text-[var(--text-tertiary)]">
                Change your password from the account menu in the top bar.
              </p>
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="business" active={tab}>
        <div className="max-w-2xl space-y-4">
          <Card>
            <CardHeader title="Business details" description="Printed on every invoice and receipt." />
            <div className="space-y-4 p-4">
              <Textarea
                label="Business name"
                rows={2}
                value={String(current.businessName ?? business?.name ?? '')}
                onChange={(event) => set('businessName', event.target.value)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Tax number"
                  value={String(current.taxNumber ?? '')}
                  onChange={(event) => set('taxNumber', event.target.value)}
                />
                <Input
                  label="Phone"
                  type="tel"
                  value={String(current.phone ?? '')}
                  onChange={(event) => set('phone', event.target.value)}
                />
              </div>
              <Textarea
                label="Address"
                rows={2}
                value={String(current.address ?? '')}
                onChange={(event) => set('address', event.target.value)}
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Currency and timezone" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Input label="Currency" value={business?.currency ?? 'USD'} readOnly hint="Set at signup; changing it would restate every historical amount." />
              <Input label="Timezone" value={business?.timezone ?? 'UTC'} readOnly />
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="branches" active={tab}>
        <Card flush>
          <CardHeader title="Branches" description="Manage locations, warehouses and registers." actions={<BranchSettingsLink />} />
          <BranchSettingsTable />
        </Card>
      </TabPanel>

      <TabPanel value="numbering" active={tab}>
        <div className="max-w-2xl">
          <Card>
            <CardHeader title="Document numbering" description="Prefixes and the next number for each document series." />
            <div className="space-y-4 p-4">
              {(['sale', 'invoice', 'purchase', 'return', 'expense', 'journal'] as const).map((series) => (
                <div key={series} className="grid gap-3 sm:grid-cols-[9rem_1fr_7rem]">
                  <Input
                    label={series.charAt(0).toUpperCase() + series.slice(1)}
                    value={String(current[`numbering.${series}.prefix`] ?? '')}
                    onChange={(event) => set(`numbering.${series}.prefix`, event.target.value)}
                    placeholder="INV-"
                  />
                  <div />
                  <Input
                    label="Next"
                    type="number"
                    value={String(current[`numbering.${series}.next`] ?? 1)}
                    onChange={(event) => set(`numbering.${series}.next`, Number(event.target.value))}
                  />
                </div>
              ))}
              <Alert tone="neutral">
                Changing a prefix affects new documents only. Existing numbers never change — a receipt number that
                moved would break reconciliation against the bank.
              </Alert>
            </div>
          </Card>
        </div>
      </TabPanel>

      <TabPanel value="languages" active={tab}>
        <LanguagesLink />
      </TabPanel>

      <TabPanel value="taxes" active={tab}>
        <div className="max-w-3xl">
          <TaxesSettingsLink />
        </div>
      </TabPanel>

      <TabPanel value="users" active={tab}>
        <SettingsLinkCard
          title="Users"
          description="Who can sign in, which roles they hold and which branches they can see."
          to="/users"
        />
      </TabPanel>

      <TabPanel value="roles" active={tab}>
        <SettingsLinkCard
          title="Roles"
          description="Named bundles of permissions, with a full permission matrix."
          to="/roles"
        />
      </TabPanel>

      <TabPanel value="audit" active={tab}>
        <SettingsLinkCard
          title="Audit log"
          description="Every change made in this business, who made it and when."
          to="/audit"
        />
      </TabPanel>

      <TabPanel value="sync" active={tab}>
        <SettingsLinkCard
          title="Synchronisation"
          description="Devices taking sales, and anything still waiting to reach the server."
          to="/sync"
        />
      </TabPanel>
    </Page>
  );
}

function BranchSettingsLink() {
  return (
    <a href="/branches" className="text-[13px] text-[var(--accent-text)] hover:underline">
      Manage branches
    </a>
  );
}

function TaxesSettingsLink() {
  return (
    <Card flush>
      <CardHeader title="Taxes" description="Rates applied to sales and purchases." actions={<a href="/taxes" className="text-[13px] text-[var(--accent-text)] hover:underline">Manage taxes</a>} />
      <p className="px-4 py-8 text-center text-[13px] text-[var(--text-tertiary)]">
        Taxes are managed on their own screen so the full list stays editable.
      </p>
    </Card>
  );
}

/** Branch list rendered inline inside the settings tab. */
function BranchSettingsTable() {
  const { api } = useAuth();
  const query = useApiQuery<Branch[]>(queryKeys.branches, (signal) => api.data<Branch[]>('/branches', { signal }));
  const rows = query.data ?? [];

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Branch</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Address</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((branch) => (
          <TableRow key={branch.id}>
            <TableCell className="font-medium">{branch.name}</TableCell>
            <TableCell className="text-[var(--text-secondary)]">{branch.code ?? '—'}</TableCell>
            <TableCell className="text-[var(--text-secondary)]">{branch.address ?? '—'}</TableCell>
            <TableCell>
              <ActiveBadge isActive={branch.isActive} />
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={4} className="py-8 text-center text-[var(--text-tertiary)]">
              No branches configured.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}


/**
 * A settings tab that is really a door to a dedicated screen.
 *
 * Users, roles, audit and sync each have enough of their own interface that
 * embedding them inside a tab would produce a page inside a page inside a tab.
 * The link card is honest about that: it says what is over there and why.
 */
function SettingsLinkCard({
  title,
  description,
  to,
}: {
  title: string;
  description: string;
  to: string;
}) {
  return (
    <a
      href={to}
      className="flex max-w-2xl items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-[var(--border-strong)]"
    >
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-[var(--text-primary)]">{title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-[var(--text-tertiary)]">{description}</p>
      </div>
    </a>
  );
}

/** The Languages tab points at the dedicated editor rather than duplicating it. */
function LanguagesLink() {
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
