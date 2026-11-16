import { useEffect, useRef, useState } from 'react';
import { ImageOff, Images, Loader2, Pin, PinOff, Plus, RefreshCw, RotateCcw, X } from 'lucide-react';
import type { ProductionAssetVersion } from '../../shared/production-workflow';
import { Button, CheckboxField, Dialog, IconButton, SegmentedControl, SwitchField } from '../../ui';
import type { AsyncActionFeedback } from '../../ui/async-action';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { toLocalImageUrl } from '../tasks/task-formatters';
import {
  MOTION_COMIC_REFERENCE_ROLE_LABELS, MOTION_COMIC_REFERENCE_ROLE_ORDER, motionComicReferenceRole,
  type MotionComicReferenceRole,
} from './motion-comic-consistency';
import type { MotionComicReferenceJob } from './MotionComicReferenceEditor';
import './MotionComicReferenceEditor.css';

export interface MotionComicReferenceCard {
  /** Stable server-verified SHA-256; the card identity used for every role guess. */
  sha256: string;
  /** Reference asset version already attached as a candidate; fixed when the user picks a role. */
  versionId: string;
  paths: string[];
  size: number;
}

export interface MotionComicReferenceSlot {
  role: MotionComicReferenceRole;
  versionId: string;
}

export interface MotionComicReferenceBoardProps {
  /** Focus presents one inspectable image; board preserves the multi-role layout. */
  layout?: 'board' | 'focus';
  /** Optional parent-owned selection, independent of adopted reference roles. */
  selectedVersionId?: string | null;
  onSelectVersion?: (versionId: string) => void;
  label: string;
  versions: readonly ProductionAssetVersion[];
  /** One pinned image per role, in provider order. */
  slots: readonly MotionComicReferenceSlot[];
  /** Confirmed local files waiting for the user to assign roles. Not project data yet. */
  pending: readonly MotionComicReferenceCard[];
  importing: number;
  busy: boolean;
  active: boolean;
  job?: MotionComicReferenceJob | null;
  feedback: AsyncActionFeedback | null;
  generationHint?: string;
  maxImages: number;
  composeMultiple: boolean;
  /** Roles shown as labelled empty slots until fixed (e.g. 正面/侧面/背面 for a character turnaround). */
  suggestedRoles?: readonly MotionComicReferenceRole[];
  /** Output boards use separate generation input controls owned by the caller. */
  hideImport?: boolean;
  onImport: () => void;
  onComposeChange: (value: boolean) => void;
  onSetRole: (versionId: string, role: MotionComicReferenceRole) => void;
  onUnpin: (versionId: string) => void;
  onRemove: (versionId: string) => void;
  /** Drop a just-imported card without ever fixing it. */
  onDiscard: (versionId: string) => void;
  onImageStatus: (versionId: string, status: 'ready' | 'error') => void;
}

export function MotionComicReferenceBoard({
  label, versions, slots, pending, importing, busy, active, job, feedback, generationHint, maxImages, composeMultiple, suggestedRoles = [], hideImport = false,
  layout = 'board', selectedVersionId, onSelectVersion,
  onImport, onComposeChange, onSetRole, onUnpin, onRemove, onDiscard, onImageStatus,
}: MotionComicReferenceBoardProps) {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(slots.find((slot) => versions.some((version) => version.id === slot.versionId))?.versionId ?? versions.at(-1)?.id ?? pending.at(-1)?.versionId ?? null);
  const [fileStatus, setFileStatus] = useState<Record<string, 'ready' | 'error'>>({});
  const [retry, setRetry] = useState(0);
  const [adoption, setAdoption] = useState<{ slot: MotionComicReferenceSlot; previous: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ProductionAssetVersion | null>(null);
  // The pin dialog picks a role before it can confirm; the compose switch reads project data.
  const [adoptionRole, setAdoptionRole] = useState<MotionComicReferenceRole>('design');
  const slotByVersion = new Map(slots.map((slot) => [slot.versionId, slot.role]));
  const fixedIds = new Set(slots.map((slot) => slot.versionId));
  const candidates = [...versions].reverse().filter((version) => !fixedIds.has(version.id));
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const canCompose = slots.length > 1;
  const pendingIds = new Set(pending.map((card) => card.versionId));
  const visibleCandidates = candidates.filter((version) => !pendingIds.has(version.id));
  const persistentRoles = [...new Set(suggestedRoles)];
  const otherSlots = slots.filter((slot) => !persistentRoles.includes(slot.role));
  const otherCandidates = visibleCandidates.filter((version) => !persistentRoles.includes(motionComicReferenceRole(version)));
  const state = slots.length > 0 ? 'fixed' : versions.length > 0 ? 'candidate' : 'missing';
  const ready = (id: string) => fileStatus[id] === 'ready';
  function reportStatus(id: string, status: 'ready' | 'error') {
    setFileStatus((current) => (current[id] === status ? current : { ...current, [id]: status }));
    onImageStatus(id, status);
  }
  function openAdoption(slot: MotionComicReferenceSlot) {
    setChecked(false);
    setAdoptionRole(slot.role);
    setAdoption({ slot, previous: slots.map((item) => item.versionId).join('|') });
  }
  const focusItems = [
    ...[...versions].reverse().map((version) => ({
      id: version.id, localPath: pending.find((card) => card.versionId === version.id)?.paths[0] ?? version.localPath,
      version, pending: pendingIds.has(version.id),
    })),
    ...pending.filter((card) => !versionById.has(card.versionId)).map((card) => ({
      id: card.versionId, localPath: card.paths[0], version: undefined, pending: true,
    })),
  ];
  const focusSelection = selectedVersionId !== undefined ? selectedVersionId : localSelectedId;
  const focusPreview = focusItems.find((item) => item.id === focusSelection)
    ?? focusItems.find((item) => fixedIds.has(item.id)) ?? focusItems[0];
  const focusRole = focusPreview ? slotByVersion.get(focusPreview.id) : undefined;
  const focusNumber = focusPreview?.version ? versions.indexOf(focusPreview.version) + 1 : undefined;
  function selectVersion(id: string) {
    if (selectedVersionId === undefined) setLocalSelectedId(id);
    onSelectVersion?.(id);
  }
  const adoptionVersion = adoption ? versionById.get(adoption.slot.versionId) : undefined;
  const adoptionPending = layout === 'focus' && adoption ? pending.find((card) => card.versionId === adoption.slot.versionId) : undefined;
  const adoptionPath = adoptionPending?.paths[0] ?? adoptionVersion?.localPath;
  const pendingRoleTaken = Boolean(adoption && slots.some((slot) => slot.role === adoptionRole && slot.versionId !== adoption.slot.versionId));
  const canAdopt = Boolean(adoption && (adoptionVersion || adoptionPending) && checked && !busy && ready(adoption.slot.versionId) && !pendingRoleTaken
    && adoption.previous === slots.map((item) => item.versionId).join('|'));
  return <div className={`motion-comic-reference is-${state}${layout === 'focus' ? ' motion-comic-reference-focus' : ''}`} data-motion-comic-reference={state} data-reference-layout={layout} aria-busy={active && busy}>
    <div className="motion-comic-reference-header">
      <span className="motion-comic-reference-title"><Images size={14} aria-hidden="true" /><span><strong>参考图</strong>
        <small>{slots.length > 0 ? `已固定 ${slots.length} 张 · 共 ${versions.length} 个版本` : versions.length > 0 ? `${versions.length} 个候选 · 待采用` : '还没有参考图'}</small></span></span>
      <div className="comic-reference-header__actions">
        <span className={`comic-reference-chip${slots.length ? ' is-fixed' : versions.length ? ' is-candidate' : ' is-missing'}`}>
          {slots.length ? <Pin size={11} aria-hidden="true" /> : null}
          {slots.length ? `已固定 ${slots.length}` : versions.length ? '待采用' : '待添加'}
        </span>
        {!hideImport ? <Button density="compact" variant="secondary" icon={<Plus size={14} />} disabled={busy} onClick={onImport}>上传参考图（可多选）</Button> : null}
      </div>
    </div>

    {persistentRoles.length > 0 ? <div className="comic-reference-role-board" role="list" aria-label={`${label}三视图`}>
      {persistentRoles.map((role) => {
        const fixedSlot = slots.find((slot) => slot.role === role);
        const fixed = fixedSlot ? versionById.get(fixedSlot.versionId) : undefined;
        const roleCandidates = visibleCandidates.filter((version) => motionComicReferenceRole(version) === role);
        return <section key={role} className="comic-reference-role-column" role="listitem" aria-label={`${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}视图`}>
          <div className="comic-reference-role-heading"><strong>{MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}</strong><small>{fixed ? '已固定' : roleCandidates.length ? `${roleCandidates.length} 个候选` : '待生成'}</small></div>
          {fixed ? <div className="comic-reference-slot is-fixed">
            <div className="comic-reference-slot__frame">
              <ReferenceImagePreview key={`${fixed.id}:${fixed.localPath}:${retry}`} localPath={fixed.localPath} alt={`${label}${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}参考图`} eager onStatusChange={(status) => reportStatus(fixed.id, status)} />
            </div>
            <div className="comic-reference-slot__bar"><strong>已固定</strong>
              {fileStatus[fixed.id] === 'error' ? <IconButton label={`${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}重新读取文件`} icon={<RefreshCw size={12} />} density="compact" variant="subtle" onClick={() => { setFileStatus({}); setRetry((value) => value + 1); }} /> : null}
              <IconButton label={`取消固定${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}`} icon={<PinOff size={12} />} density="compact" variant="subtle" disabled={busy} onClick={() => onUnpin(fixed.id)} />
              <IconButton label={`移除${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}参考图`} icon={<X size={12} />} density="compact" variant="subtle" disabled={busy} onClick={() => setRemoveTarget(fixed)} />
            </div>
          </div> : roleCandidates.length === 0 ? <div className="comic-reference-slot is-empty">
            <div className="comic-reference-slot__frame"><span className="comic-reference-role-empty"><Images size={22} aria-hidden="true" /><strong>{MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}</strong><small>生成后在这里核对并固定</small></span></div>
          </div> : null}
          {roleCandidates.map((version) => <CandidateCard key={version.id} version={version} number={versions.findIndex((item) => item.id === version.id) + 1}
            label={`${label}${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}`} retry={retry} ready={ready(version.id)} busy={busy} role={role}
            onStatus={(status) => reportStatus(version.id, status)} onSetRole={() => openAdoption({ versionId: version.id, role })} onRemove={() => setRemoveTarget(version)} />)}
        </section>;
      })}
    </div> : null}

    <div className="comic-reference-slots" role="list" aria-label={`${label}固定参考图`}>
      {otherSlots.map((slot) => {
        const version = versionById.get(slot.versionId);
        if (!version) return null;
        return <div key={slot.role} className="comic-reference-slot is-fixed" role="listitem">
          <div className="comic-reference-slot__frame">
            <ReferenceImagePreview key={`${version.id}:${version.localPath}:${retry}`} localPath={version.localPath} alt={`${label}${MOTION_COMIC_REFERENCE_ROLE_LABELS[slot.role]}参考图`} eager onStatusChange={(status) => reportStatus(version.id, status)} />
            <span className="comic-reference-slot__role">{MOTION_COMIC_REFERENCE_ROLE_LABELS[slot.role]}</span>
            {ready(version.id) ? null : <span className="comic-reference-slot__pending">{fileStatus[version.id] === 'error' ? '文件不可用' : '读取中'}</span>}
          </div>
          <div className="comic-reference-slot__bar">
            <strong>{version.prompt?.includes('导入') ? '导入' : '生成'}</strong>
            {fileStatus[version.id] === 'error' ? <IconButton label={`${MOTION_COMIC_REFERENCE_ROLE_LABELS[slot.role]}重新读取文件`} icon={<RefreshCw size={12} />} density="compact" variant="subtle" onClick={() => { setFileStatus({}); setRetry((value) => value + 1); }} /> : null}
            <IconButton label={`取消固定${MOTION_COMIC_REFERENCE_ROLE_LABELS[slot.role]}`} icon={<PinOff size={12} />} density="compact" variant="subtle" disabled={busy} onClick={() => onUnpin(version.id)} />
            <IconButton label={`移除${MOTION_COMIC_REFERENCE_ROLE_LABELS[slot.role]}参考图`} icon={<X size={12} />} density="compact" variant="subtle" disabled={busy} onClick={() => setRemoveTarget(version)} />
          </div>
        </div>;
      })}
      {Array.from({ length: importing }).map((_, index) => <div key={`importing-${index}`} className="comic-reference-slot is-loading" role="listitem" aria-label="正在导入参考图">
        <div className="comic-reference-slot__frame"><Loader2 className="director-spin" size={18} aria-hidden="true" /></div>
        <span className="comic-reference-slot__bar"><strong>导入中</strong></span>
      </div>)}
      {job && persistentRoles.length === 0 ? <div className="comic-reference-slot is-job" role="listitem" aria-label="正在生成参考图候选">
        <div className="comic-reference-slot__frame"><Loader2 className="director-spin" size={18} aria-hidden="true" /></div>
        <span className="comic-reference-slot__bar"><strong>生成中</strong></span>
      </div> : null}
      {persistentRoles.length === 0 && slots.length === 0 && !job && !importing ? <div className="comic-reference-empty-state"><strong>还没有固定参考图</strong><small>上传多张图片，或填写下方提示词生成候选。核对后固定为参考图，供后续分镜保持一致。</small></div> : null}
    </div>

    {/* Six roles cannot fit inside a 132px tile, so pending imports get a full-width row each. */}
    {pending.length > 0 ? <div className="comic-reference-pending" role="group" aria-label="待设定用途的参考图">
      {pending.map((card) => <div key={card.sha256} className="comic-reference-pending__row">
        <span className="comic-reference-pending__thumb"><ReferenceImagePreview localPath={card.paths[0]} alt={`${label}待设定用途的参考图`} eager onStatusChange={() => undefined} /></span>
        <span className="comic-reference-pending__text"><strong>这张图是什么？</strong><small>选一个用途后才会成为固定参考；同一用途只能固定一张。</small></span>
        <span className="comic-reference-pending__roles" role="group" aria-label="选择这张图的用途">
          {MOTION_COMIC_REFERENCE_ROLE_ORDER.map((role) => <Button key={role} density="compact" variant="subtle" disabled={busy || slots.some((slot) => slot.role === role)} onClick={() => onSetRole(card.versionId, role)}>{MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}</Button>)}
        </span>
        <IconButton label={`放弃这张导入的参考图`} icon={<X size={12} />} density="compact" variant="subtle" disabled={busy} onClick={() => onDiscard(card.versionId)} />
      </div>)}
    </div> : null}

    {canCompose && !hideImport ? <div className="comic-reference-compose">
      {canCompose ? <SwitchField checked={composeMultiple} onChange={(_, data) => onComposeChange(Boolean(data.checked))}
        label={`生成候选时使用全部 ${Math.min(slots.length, maxImages)} 张固定参考图`} /> : null}
      <small>{canCompose
        ? (slots.length > maxImages ? `当前图片模型每次最多 ${maxImages} 张；超出的参考图仍会保留，但不会进入本次请求。` : '只影响“生成候选”；分镜出画始终按你固定的参考图，不受此开关影响。')
        : '固定两张以上参考图后可多图合成；在此之前生成候选只使用固定好的那一张。'}</small>
    </div> : null}

    {job ? <p className="comic-reference-job" role="status" aria-live="polite">
      <Loader2 className="director-spin" size={12} aria-hidden="true" />
      <span><strong>{job.label}</strong>{job.detail ? <small>{job.detail}</small> : null}</span>
      {job.progress !== undefined ? <span className="comic-reference-job__bar" aria-hidden="true"><i style={{ inlineSize: `${Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%` }} /></span> : null}
    </p> : null}

    {otherCandidates.length > 0 ? <><div className="comic-reference-candidates-heading"><strong>待采用的图片</strong><small>先核对图片，再选择用途并固定</small></div>
    <div className="comic-reference-version-strip" aria-label={`${label}候选参考图`}>
      {otherCandidates.map((version) => <CandidateCard key={version.id} version={version} number={versions.findIndex((item) => item.id === version.id) + 1}
        label={label} retry={retry} ready={ready(version.id)} busy={busy}
        onStatus={(status) => reportStatus(version.id, status)} onSetRole={(role) => onSetRole(version.id, role)} onRemove={() => setRemoveTarget(version)} />)}
    </div></> : null}

    {slots.length > 0 && slots.every((slot) => fileStatus[slot.versionId] === 'error') ? <small className="comic-reference-hint" role="status">固定参考文件不可用，请重新导入或改固定其他版本。</small> : null}
    {generationHint ? <small className="comic-reference-hint" role="status">{generationHint}</small> : null}
    {active ? <InlineActionFeedback feedback={feedback} /> : null}

    <Dialog open={Boolean(adoption)} title="核对并固定这张参考图" onOpenChange={(open) => { if (!open) { setAdoption(null); setChecked(false); } }} surfaceClassName="comic-reference-adoption-dialog" actions={<>
      <Button onClick={() => { setAdoption(null); setChecked(false); }}>取消</Button>
      <Button variant="primary" disabled={!canAdopt} onClick={() => { if (canAdopt && adoption) { onSetRole(adoption.slot.versionId, adoptionRole); setAdoption(null); setChecked(false); } }}>确认固定为{MOTION_COMIC_REFERENCE_ROLE_LABELS[adoptionRole]}</Button>
    </>}>
      <div className="comic-reference-adoption">
        <p><strong>{label}</strong> · 这张图固定为什么用途？</p>
        {adoptionVersion?.localPath ? <img src={toLocalImageUrl(adoptionVersion.localPath)} alt={`${label}待固定参考图`} /> : null}
        <SegmentedControl label="参考图用途" value={adoptionRole} onChange={(role) => { setAdoptionRole(role); setChecked(false); }}
          options={MOTION_COMIC_REFERENCE_ROLE_ORDER.map((role) => ({ value: role, label: MOTION_COMIC_REFERENCE_ROLE_LABELS[role] }))} />
        <p>{pendingRoleTaken
          ? `“${MOTION_COMIC_REFERENCE_ROLE_LABELS[adoptionRole]}”已有固定版本，请选择其他用途；如需替换，先取消该用途的固定。`
          : slots.length > 0 ? '这张图会和已固定的其他参考图一起作为后续生成与分镜出画的视觉基准。' : '固定后即成为该资产的视觉基准；之后仍可增加其他角度的参考图。'}</p>
        {adoption && adoption.previous !== slots.map((item) => item.versionId).join('|') ? <p role="alert">固定参考已变化，请取消后重新核对当前候选。</p> : null}
        <CheckboxField label="我已核对人物身份、造型或场景内容，并了解引用影响" checked={checked} onChange={(_, data) => setChecked(Boolean(data.checked))} />
      </div>
    </Dialog>

    <Dialog open={Boolean(removeTarget)} title={`移除参考图 v${removeTarget ? versions.findIndex((item) => item.id === removeTarget.id) + 1 : '—'}`} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }} surfaceClassName="comic-reference-adoption-dialog" actions={<>
      <Button onClick={() => setRemoveTarget(null)}>取消</Button>
      <Button variant="danger" onClick={() => { if (removeTarget) onRemove(removeTarget.id); setRemoveTarget(null); }}>移除出列表</Button>
    </>}>
      <div className="comic-reference-adoption">
        {removeTarget?.localPath ? <img src={toLocalImageUrl(removeTarget.localPath)} alt="待移除参考图" /> : null}
        <p>参考图与图片历史仍保留在素材中；只从本造型的参考图列表移除。已使用该参考图的分镜会提示检查一致性。</p>
      </div>
    </Dialog>
  </div>;
}
function CandidateCard({ version, number, label, retry, ready, busy, role, onStatus, onSetRole, onRemove }: {
  version: ProductionAssetVersion; number: number; label: string; retry: number; ready: boolean; busy: boolean; role?: MotionComicReferenceRole;
  onStatus: (status: 'ready' | 'error') => void; onSetRole: (role: MotionComicReferenceRole) => void; onRemove: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  return <div className="comic-reference-candidate">
    <Button variant="subtle" className="comic-reference-candidate__preview" aria-label={`${label}候选 v${number}`} onClick={() => role ? onSetRole(role) : setChoosing((value) => !value)}>
      <ReferenceImagePreview key={`${version.id}:${version.localPath}:${retry}`} localPath={version.localPath} alt={`${label}候选版本 ${number}缩略图`} onStatusChange={onStatus} />
    </Button>
    <span className="comic-reference-candidate__meta"><strong>v{number}</strong><small>{formatReferenceDate(version.createdAt)}</small></span>
    {choosing ? <span className="comic-reference-candidate__roles" role="group" aria-label={`固定 v${number} 为`}>
      {MOTION_COMIC_REFERENCE_ROLE_ORDER.map((role) => <Button key={role} density="compact" variant="subtle" disabled={busy || !ready} onClick={() => { onSetRole(role); setChoosing(false); }}>{MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}</Button>)}
    </span> : <span className="comic-reference-candidate__actions">
      <Button density="compact" variant="subtle" icon={<Pin size={12} />} disabled={busy || !ready} onClick={() => role ? onSetRole(role) : setChoosing(true)}>{role ? `固定为${MOTION_COMIC_REFERENCE_ROLE_LABELS[role]}` : '固定为…'}</Button>
      <IconButton label={`移除候选 v${number}`} icon={<X size={12} />} density="compact" variant="subtle" disabled={busy} onClick={onRemove} />
    </span>}
  </div>;
}

function ReferenceImagePreview({ localPath, alt, eager, onStatusChange }: { localPath?: string; alt: string; eager?: boolean; onStatusChange: (status: 'ready' | 'error') => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(localPath ? 'loading' : 'error');
  const statusCallback = useRef(onStatusChange);
  useEffect(() => { statusCallback.current = onStatusChange; });
  useEffect(() => { if (!localPath) statusCallback.current('error'); }, [localPath]);
  return <span className={`motion-comic-reference-image is-${status}`} aria-busy={status === 'loading'}>
    {status === 'error' ? <span role="img" aria-label={`${alt}加载失败`}><ImageOff size={20} /><small>文件不可用</small></span> : <>
      {status === 'loading' ? <Loader2 className="director-spin comic-reference-loading" size={18} aria-label="正在读取参考图" /> : null}
      <img src={toLocalImageUrl(localPath!)} alt={alt} loading={eager ? 'eager' : 'lazy'} onLoad={() => { setStatus('ready'); onStatusChange('ready'); }} onError={() => { setStatus('error'); onStatusChange('error'); }} />
    </>}
  </span>;
}

function formatReferenceDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
