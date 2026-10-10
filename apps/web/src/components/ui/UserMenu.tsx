import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut, Settings, UserCog } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '../../lib/cn';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { ApiError } from '../../lib/api';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { DropdownMenu, type MenuItem } from './DropdownMenu';
import { Input } from './Input';
import { Modal } from './Modal';

/**
 * User menu: identity, password change, sign out.
 *
 * The password change lives here rather than on a settings page because it is
 * the one account action a user needs without hunting for Settings — and the
 * most common reason a session ends badly.
 */

export function UserMenu() {
  const { user, business, signOut } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [passwordOpen, setPasswordOpen] = useState(false);

  const items: MenuItem[] = [
    {
      key: 'profile',
      label: user?.email ?? '',
      disabled: true,
      icon: <UserCog size={16} strokeWidth={1.75} />,
    },
    { key: 'sep-1', label: '', hidden: true, separated: true },
    {
      key: 'password',
      label: 'Change password',
      icon: <KeyRound size={16} strokeWidth={1.75} />,
      onSelect: () => setPasswordOpen(true),
    },
    {
      key: 'settings',
      label: t('nav.settings'),
      icon: <Settings size={16} strokeWidth={1.75} />,
      onSelect: () => navigate('/settings'),
    },
    { key: 'sep-2', label: '', hidden: true, separated: true },
    {
      key: 'signout',
      label: t('auth.signOut'),
      tone: 'danger',
      separated: true,
      icon: <LogOut size={16} strokeWidth={1.75} />,
      onSelect: () => {
        void signOut();
      },
    },
  ];

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';

  return (
    <>
      <DropdownMenu
        label={t('auth.signOut')}
        items={items}
        trigger={({ open, ref, onToggle }) => (
          <button
            ref={ref}
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="User menu"
            onClick={onToggle}
            className={cn(
              'flex items-center gap-2 rounded-[var(--radius-md)] ps-1 pe-2 py-1 transition-colors hover:bg-[var(--bg-sunken)]',
              open && 'bg-[var(--bg-sunken)]',
            )}
          >
            <Avatar name={name} size="sm" />
            <span className="hidden max-w-[9rem] truncate text-[13px] font-medium text-[var(--text-primary)] sm:block">
              {user?.firstName || user?.email}
            </span>
          </button>
        )}
      />
      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </>
  );
}

export function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setErrors({});
  };

  const submit = async () => {
    if (next !== confirm) {
      setErrors({ confirm: 'The two passwords do not match.' });
      return;
    }
    if (next.length < 8) {
      setErrors({ newPassword: 'Use at least 8 characters.' });
      return;
    }

    setPending(true);
    setErrors({});
    try {
      await api.post('/auth/password', { currentPassword: current, newPassword: next });
      toast.success('Password changed');
      reset();
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'VALIDATION_FAILED' && error.details) {
          const mapped: Record<string, string> = {};
          for (const [key, value] of Object.entries(error.details)) {
            mapped[key] = Array.isArray(value) ? (value[0] ?? '') : value;
          }
          setErrors(mapped);
        } else if (error.code === 'INVALID_CREDENTIALS') {
          setErrors({ currentPassword: 'That is not your current password.' });
        } else {
          setErrors({ form: error.message });
        }
      } else {
        setErrors({ form: 'Could not change the password.' });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      description="You will stay signed in on this device."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={pending}>
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger-text)]">
            {errors.form}
          </p>
        )}
        <Input
          type="password"
          label="Current password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          error={errors.currentPassword}
          required
        />
        <Input
          type="password"
          label="New password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          error={errors.newPassword}
          hint="At least 8 characters."
          required
        />
        <Input
          type="password"
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors.confirm}
          required
        />
      </div>
    </Modal>
  );
}
