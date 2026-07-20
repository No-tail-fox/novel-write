import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export type DialogFocusDirection = 'forward' | 'backward';

export function nextDialogFocusIndex(current: number, length: number, direction: DialogFocusDirection): number {
  if (length <= 0) return -1;
  if (current < 0 || current >= length) return direction === 'backward' ? length - 1 : 0;
  if (direction === 'backward') return (current - 1 + length) % length;
  return (current + 1 + length) % length;
}

export function createConfirmSubmissionGuard() {
  let active = false;
  return {
    isActive: () => active,
    async run<T>(submit: () => Promise<T> | T): Promise<T | undefined> {
      if (active) return undefined;
      active = true;
      try {
        return await submit();
      } finally {
        active = false;
      }
    },
  };
}

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  busy = false,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const dialogRef = useRef<HTMLElement>(null);
  const guardRef = useRef(createConfirmSubmissionGuard());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    queueMicrotask(() => {
      if (cancelled) return;
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-focus]:not([disabled])');
      if (firstFocusable) firstFocusable.focus();
      else dialogRef.current?.focus();
    });
    return () => {
      cancelled = true;
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open && (busy || submitting)) dialogRef.current?.focus();
  }, [busy, open, submitting]);

  if (!open) return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !busy && !submitting) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('[data-dialog-focus]:not([disabled])') ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = nextDialogFocusIndex(current, focusable.length, event.shiftKey ? 'backward' : 'forward');
    if (next >= 0) {
      event.preventDefault();
      focusable[next]?.focus();
    }
  }

  async function submit() {
    if (busy || guardRef.current.isActive()) return;
    setSubmitting(true);
    try {
      await guardRef.current.run(onConfirm);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="error-dialog-backdrop confirm-dialog-backdrop" onClick={(event) => {
      if (event.target === event.currentTarget && !busy && !submitting) onCancel();
    }}>
      <section
        ref={dialogRef}
        className="error-dialog confirm-dialog"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleKeyDown}
      >
        <div className="error-dialog-head">
          <strong id={titleId}>{title}</strong>
        </div>
        <p id={descriptionId}>{description}</p>
        <div className="confirm-dialog-actions">
          <button data-dialog-focus className="ghost-action" type="button" disabled={busy || submitting} onClick={onCancel}>{cancelLabel}</button>
          <button data-dialog-focus className={destructive ? 'danger-action' : 'primary-action'} type="button" disabled={busy || submitting} onClick={() => void submit()}>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
