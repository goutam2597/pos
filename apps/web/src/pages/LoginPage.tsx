import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, Store } from 'lucide-react';

import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LanguageSwitcher, ThemeToggle } from '../components/ui/ThemeToggle';

/**
 * Sign in.
 *
 * Centred, unbranded-noise-free, and honest about failure. The three failure
 * modes a shop actually hits are handled explicitly and differently:
 * wrong credentials, a locked account after too many tries, and no connection —
 * each says what to do next rather than "login failed".
 */
export function LoginPage() {
  const { status, signIn } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerId, setRegisterId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field?: 'email' | 'password' | 'registerId'; message: string } | null>(null);

  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={from} replace />;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError({ message: 'Enter your email and password.' });
      return;
    }

    setPending(true);
    try {
      await signIn(email.trim(), password, registerId.trim() || undefined);
      navigate('/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'LOCKED' || caught.code === 'ACCOUNT_LOCKED' || caught.status === 423) {
          setError({ message: t('auth.locked') });
        } else if (caught.code === 'INVALID_CREDENTIALS' || caught.code === 'UNAUTHENTICATED') {
          setError({ message: t('auth.invalid') });
        } else if (caught.code === 'VALIDATION_FAILED' && caught.details) {
          const details = caught.details;
          const field = details.email ? 'email' : details.password ? 'password' : undefined;
          const first = Object.values(details)[0];
          setError({
            field,
            message: Array.isArray(first) ? (first[0] ?? 'Check this field.') : String(first ?? 'Check this field.'),
          });
        } else if (caught.isOffline) {
          setError({ message: 'Cannot reach the server. Check the connection and try again.' });
        } else {
          setError({ message: caught.message });
        }
      } else {
        setError({ message: 'Something went wrong. Try again.' });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg-canvas)]">
      <header className="flex items-center justify-end gap-1 p-3">
        <LanguageSwitcher />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-[var(--radius-lg)] bg-[var(--accent)] text-base font-semibold text-[var(--accent-contrast)]"
            >
              M
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight text-[var(--text-primary)]">MonoPOS</p>
              <p className="text-[13px] text-[var(--text-tertiary)]">{t('app.tagline')}</p>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-surface)] p-5">
            <h1 className="mb-1 text-base font-semibold text-[var(--text-primary)]">{t('auth.signIn')}</h1>
            <p className="mb-5 text-[13px] text-[var(--text-tertiary)]">
              Use the account your business owner set up for you.
            </p>

            <form onSubmit={submit} noValidate className="space-y-4">
              {error && !error.field && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--danger-subtle)] bg-[var(--danger-subtle)] px-3 py-2.5 text-[13px] text-[var(--danger-text)]"
                >
                  <AlertCircle size={16} strokeWidth={1.75} aria-hidden="true" className="mt-[1px] shrink-0" />
                  <span>{error.message}</span>
                </div>
              )}

              <Input
                type="email"
                label={t('auth.email')}
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={error?.field === 'email' ? error.message : undefined}
                disabled={pending}
                required
                autoFocus
              />

              <Input
                type="password"
                label={t('auth.password')}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                error={error?.field === 'password' ? error.message : undefined}
                disabled={pending}
                required
              />

              <details className="group">
                <summary className="cursor-pointer list-none text-[13px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                  Using a till register?
                </summary>
                <div className="pt-3">
                  <Input
                    label="Register ID"
                    value={registerId}
                    onChange={(event) => setRegisterId(event.target.value)}
                    error={error?.field === 'registerId' ? error.message : undefined}
                    hint="Printed on the till's settings sheet. Leave blank on other devices."
                    disabled={pending}
                  />
                </div>
              </details>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                loading={pending}
              >
                {t('auth.signIn')}
              </Button>
            </form>
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-[12px] text-[var(--text-tertiary)]">
            <Store size={13} strokeWidth={1.75} aria-hidden="true" />
            Sessions end when you sign out. Nothing is stored on this device.
          </p>
        </div>
      </main>
    </div>
  );
}
