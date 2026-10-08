import type { ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Confirmation dialog.
 *
 * Focus starts on Cancel and the confirm button never receives it, so a stray
 * Enter cannot delete a customer's record. The destructive action is stated
 * concretely ("Delete 4 products?") rather than as "Are you sure?".
 */

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'brand';
  /** Shows the pending state and blocks dismissal mid-flight. */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      autoFocus={false}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        {tone === 'danger' && (
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--danger-subtle)] text-[var(--danger-text)]"
          >
            <AlertTriangle size={18} strokeWidth={1.75} />
          </span>
        )}
        <div className="min-w-0 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {description}
        </div>
      </div>
    </Modal>
  );
}

/**
 * Confirmation state for a page that deletes several kinds of record.
 *
 * Pages keep the *request* (which record, what wording) rather than a boolean,
 * so the dialog can say "Delete Acme Ltd?" instead of a generic prompt, and so
 * the handler is registered next to the copy it belongs to.
 */
export interface ConfirmRequest {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'brand';
  onConfirm: () => void;
}

export function ConfirmRequestDialog({
  request,
  onClose,
  pending,
  cancelLabel,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
  pending?: boolean;
  cancelLabel?: string;
}) {
  return (
    <ConfirmDialog
      open={request !== null}
      onClose={onClose}
      onConfirm={() => request?.onConfirm()}
      title={request?.title ?? ''}
      description={request?.description}
      confirmLabel={request?.confirmLabel ?? 'Confirm'}
      cancelLabel={cancelLabel}
      loading={pending}
      tone={request?.tone ?? 'danger'}
    />
  );
}
