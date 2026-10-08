import { createContext, useContext, useId, type FormHTMLAttributes, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import type { Permission } from '@monopos/shared';
import { useAuth } from '../../lib/auth';
import { FieldFoot, FieldLabel } from './Input';

/**
 * Form scaffolding.
 *
 * Deliberately uncontrolled-friendly: pages own their field state, so the same
 * form works whether the values came from a create dialog, an edit dialog, or a
 * row-level action. What this adds is layout and the one thing forms get wrong:
 * a group of related fields needs a legend, not just bold text.
 */

export function Form({
  children,
  className,
  ...props
}: FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  return (
    <form className={cn('space-y-4', className)} {...props}>
      {children}
    </form>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {title && (
        <div>
          <h3 className="text-[13px] font-semibold text-[var(--text-primary)]">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-[var(--text-tertiary)]">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function FormGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  return (
    <div
      className={cn(
        'grid gap-4',
        columns === 1 && 'grid-cols-1',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
      )}
    >
      {children}
    </div>
  );
}

/** A field that spans the full form width regardless of the grid. */
export function FormFull({ children }: { children: ReactNode }) {
  return <div className="sm:col-span-2 lg:col-span-3">{children}</div>;
}

export interface FormFieldProps {
  label: ReactNode;
  /** Bound to the control's `id`; generates one when omitted. */
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode | ((id: string) => ReactNode);
  className?: string;
}

/**
 * Field wrapper.
 *
 * Passing a function as `children` gives the control a guaranteed-unique id
 * without the caller threading `useId` through every dialog — the id is what
 * links the label, the hint and the error message to the control for a screen
 * reader.
 */
export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: FormFieldProps) {
  const generatedId = useId();
  const fieldId = htmlFor ?? generatedId;

  return (
    <div className={cn('min-w-0', className)}>
      <FieldLabel htmlFor={fieldId} required={required}>
        {label}
      </FieldLabel>
      {typeof children === 'function' ? children(fieldId) : children}
      <FieldFoot hint={hint} error={error} id={fieldId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

type GateMode = 'hide' | 'disable' | 'readonly';

const GateContext = createContext<GateMode>('hide');

/**
 * Permission gate.
 *
 * Wraps a subtree in a permission decision so every page makes the same one the
 * same way. `hide` is the default: an action the user cannot perform should not
 * be offered at all, because a permanently dead button trains people to ignore
 * the row actions.
 */
export function PermissionGate({
  permission,
  mode = 'hide',
  anyOf,
  children,
  fallback,
}: {
  permission?: Permission;
  /** Allow any of these instead of a single permission. */
  anyOf?: Permission[];
  mode?: GateMode;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, canAny } = useAuth();
  const allowed = anyOf ? canAny(...anyOf) : permission ? can(permission) : true;

  if (allowed) return <>{children}</>;
  if (fallback !== undefined) return <>{fallback}</>;
  if (mode === 'disable') {
    return (
      <GateContext.Provider value="disable">
        <fieldset disabled className="contents">
          {children}
        </fieldset>
      </GateContext.Provider>
    );
  }
  if (mode === 'readonly') return <GateContext.Provider value="readonly">{children}</GateContext.Provider>;
  return null;
}

/** True when the surrounding PermissionGate is in `disable` mode. */
export function useGateMode(): GateMode {
  return useContext(GateContext);
}
