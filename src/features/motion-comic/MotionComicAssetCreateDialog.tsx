import { useId, useRef, useState } from 'react';
import { Button, Dialog } from '../../ui';
import './MotionComicAssetCreateDialog.css';

export type MotionComicAssetCreateKind = 'character' | 'scene' | 'prop' | 'look';
export interface MotionComicAssetCreateInput {
  kind: MotionComicAssetCreateKind;
  name: string;
  description: string;
  characterId?: string;
}
export interface MotionComicAssetCreateDialogProps {
  open: boolean;
  kind: MotionComicAssetCreateKind;
  characterId?: string;
  characterName?: string;
  busy?: boolean;
  error?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: MotionComicAssetCreateInput) => void | Promise<void>;
}
const labels = { character: '人物', scene: '场景', prop: '道具', look: '造型' };

export function normalizeMotionComicAssetCreateInput(input: MotionComicAssetCreateInput): MotionComicAssetCreateInput {
  const name = input.name.trim();
  if (!name) throw new Error('请填写名称。');
  if (input.kind === 'look' && !input.characterId?.trim()) throw new Error('人物已不可用，请返回人物详情后重新新增造型。');
  return { kind: input.kind, name, description: input.description.trim(), ...(input.kind === 'look' ? { characterId: input.characterId } : {}) };
}

/** Unmount the form on close so cancelled values never create an asset or leak into another target. */
export function MotionComicAssetCreateDialog(props: MotionComicAssetCreateDialogProps) {
  return props.open ? <AssetCreateForm key={`${props.kind}:${props.characterId ?? ''}`} {...props} /> : null;
}
function AssetCreateForm({ kind, characterId, characterName, busy = false, error, onOpenChange, onSubmit }: MotionComicAssetCreateDialogProps) {
  const id = useId();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState('');
  const [nameError, setNameError] = useState(false);
  const lock = useRef(false);
  const nameField = useRef<HTMLInputElement>(null);
  const blocked = busy || pending;
  const label = labels[kind];
  async function submit() {
    if (busy || lock.current) return;
    setFailure('');
    let input: MotionComicAssetCreateInput;
    try { input = normalizeMotionComicAssetCreateInput({ kind, name, description, characterId }); }
    catch (cause) {
      setNameError(!name.trim());
      setFailure(cause instanceof Error ? cause.message : '请检查输入。');
      if (!name.trim()) nameField.current?.focus();
      return;
    }
    lock.current = true; setPending(true);
    try { await onSubmit(input); onOpenChange(false); }
    catch (cause) { setFailure(cause instanceof Error ? cause.message : '新增未完成，请检查后重试。'); }
    finally { lock.current = false; setPending(false); }
  }
  return <Dialog open title={`新增${label}`} onOpenChange={(open) => { if (!blocked) onOpenChange(open); }} surfaceClassName="comic-asset-create-dialog" actions={<>
    <Button disabled={blocked} onClick={() => onOpenChange(false)}>取消</Button>
    <Button type="submit" form={id} variant="primary" disabled={blocked}>{pending ? '正在新增…' : `新增${label}`}</Button>
  </>}>
    <form id={id} className="comic-asset-create-form" aria-busy={blocked} noValidate onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p>{kind === 'look' ? `为「${characterName || '当前人物'}」新增造型，沿用同一人物身份。` : `先建立${label}名称和设定，再在详情中导入参考或生成候选图。`}</p>
      <label htmlFor={`${id}-name`}>{label}名称 <span>（必填）</span></label>
      <input ref={nameField} id={`${id}-name`} name="name" value={name} required disabled={blocked} aria-invalid={nameError || undefined} aria-describedby={nameError ? `${id}-error` : undefined} onChange={(event) => { setName(event.target.value); setNameError(false); if (nameError) setFailure(''); }} />
      <label htmlFor={`${id}-description`}>{kind === 'look' ? '造型设定' : `${label}设定`} <span>（选填）</span></label>
      <textarea id={`${id}-description`} name="description" value={description} rows={5} disabled={blocked} onChange={(event) => setDescription(event.target.value)} />
      <p className="comic-asset-create-hint">新增后可继续完善。此操作不会生成图片或提交模型任务。</p>
      {failure || error ? <p id={`${id}-error`} role="alert">{failure || error}</p> : null}
    </form>
  </Dialog>;
}
