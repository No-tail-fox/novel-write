import { Trash2 } from 'lucide-react';
import { Button, Dialog } from '../../ui';
import './MotionComicAssetRemoveDialog.css';

export interface MotionComicAssetRemoveDialogProps {
  open: boolean;
  /** 被删除对象的中文类别，例如“人物”“造型”。 */
  label: string;
  name: string;
  /** 说明删除后的影响，例如被引用情况。 */
  impact: string;
  notes?: string[];
  blockedReason?: string;
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Destructive confirmation lives beside the asset it removes; it never auto-adopts a
 * replacement so existing shots keep their authored continuity inputs.
 */
export function MotionComicAssetRemoveDialog({ open, label, name, impact, notes = [], blockedReason, busy = false, onOpenChange, onConfirm }: MotionComicAssetRemoveDialogProps) {
  if (!open) return null;
  return <Dialog
    open
    title={`删除${label}“${name}”`}
    surfaceClassName="comic-asset-remove-dialog"
    onOpenChange={(value) => { if (!busy) onOpenChange(value); }}
    actions={<>
      <Button disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
      <Button variant="danger" icon={<Trash2 size={13} />} disabled={busy || Boolean(blockedReason)} onClick={onConfirm}>{busy ? '正在删除…' : `删除${label}`}</Button>
    </>}
  >
    <div className="comic-asset-remove">
      {blockedReason
        ? <p role="alert" className="comic-asset-remove__blocked">{blockedReason}</p>
        : <p>{impact}</p>}
      {notes.length > 0 ? <ul>{notes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
      <small>删除只作用于当前项目。已生成的参考图、图片与视频历史不会被删除。</small>
    </div>
  </Dialog>;
}
