import { useRef, useState } from 'react';
import { Button, Dialog } from '../ui';

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
  const guardRef = useRef(createConfirmSubmissionGuard());
  const [submitting, setSubmitting] = useState(false);

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
    <Dialog
      open={open}
      title={title}
      onOpenChange={(nextOpen) => { if (!nextOpen && !busy && !submitting) onCancel(); }}
      actions={<>
        <Button disabled={busy || submitting} onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={destructive ? 'danger' : 'primary'} disabled={busy || submitting} onClick={() => void submit()}>{confirmLabel}</Button>
      </>}
    >
      <p className="sd-confirm-description">{description}</p>
    </Dialog>
  );
}
