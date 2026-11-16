import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ImageOff, ImagePlus, Images, Loader2, LockKeyhole, Pin, PinOff, RefreshCw } from 'lucide-react';
import type { ProductionAssetVersion } from '../../shared/production-workflow';
import { Button, CheckboxField, Dialog, IconButton, Toolbar } from '../../ui';
import './MotionComicReferenceEditor.css';
import type { AsyncActionFeedback } from '../../ui/async-action';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { toLocalImageUrl } from '../tasks/task-formatters';

export interface MotionComicReferenceJob {
  /** Authoritative stage reported by the background task, never a decorative timer. */
  label: string;
  detail?: string;
  /** 0..1 while a batch proves progress; omitted for unknown progress. */
  progress?: number;
}

export function MotionComicReferenceEditor({ label, versions, fixedVersionId, busy, active, job, feedback, importControl, generationHint, adoptionImpact, onSetFixed, onImageStatus }: {
  label: string;
  versions: readonly ProductionAssetVersion[];
  fixedVersionId?: string;
  busy: boolean;
  active: boolean;
  /** Background generation for this target; shown inline instead of a toast. */
  job?: MotionComicReferenceJob | null;
  feedback: AsyncActionFeedback | null;
  importControl: ReactElement;
  generationHint?: string;
  adoptionImpact?: string;
  onSetFixed: (versionId: string | null) => void;
  onImageStatus: (versionId: string, status: 'ready' | 'error') => void;
}) {
  const [selectedId, setSelectedId] = useState(fixedVersionId ?? '');
  const [fileStatus, setFileStatus] = useState<Record<string, 'ready' | 'error'>>({});
  const [retry, setRetry] = useState(0);
  const [adoption, setAdoption] = useState<{ id: string; previous?: string } | null>(null);
  const [checked, setChecked] = useState(false);
  const adoptionVersion = versions.find((version) => version.id === adoption?.id);
  const canAdopt = Boolean(adoptionVersion && checked && !busy && fileStatus[adoptionVersion.id] === 'ready' && adoption?.previous === fixedVersionId && adoptionVersion.id !== fixedVersionId);
  useEffect(() => { if (fixedVersionId) setSelectedId(fixedVersionId); }, [fixedVersionId]);
  const preview = versions.find((version) => version.id === selectedId)
    ?? versions.find((version) => version.id === fixedVersionId) ?? versions.at(-1);
  const previewNumber = preview ? versions.findIndex((version) => version.id === preview.id) + 1 : 0;
  const state = fixedVersionId ? 'fixed' : versions.length > 0 ? 'unfixed' : 'missing';
  const previewFixed = preview?.id === fixedVersionId;
  function reportStatus(id: string, status: 'ready' | 'error') {
    setFileStatus((current) => current[id] === status ? current : { ...current, [id]: status });
    onImageStatus(id, status);
  }
  return <div className={`motion-comic-reference is-${state}`} data-motion-comic-reference={state} aria-busy={active && busy}>
    <div className="motion-comic-reference-header">
      <span className="motion-comic-reference-title"><Images size={14} aria-hidden="true" /><span><strong>一致性参考图</strong><small>{fixedVersionId ? `已固定 · ${versions.length} 个版本` : versions.length > 0 ? `${versions.length} 个候选 · 待采用，尚未固定` : '缺少参考图'}</small></span></span>
      <span className={`comic-reference-chip${fixedVersionId ? ' is-fixed' : versions.length ? ' is-candidate' : ' is-missing'}`}>
        {fixedVersionId ? <LockKeyhole size={11} aria-hidden="true" /> : null}
        {fixedVersionId ? '已固定' : versions.length ? '待采用' : '待生成'}
      </span>
    </div>
    {preview ? <>
      <div className="comic-reference-preview" aria-label={`${label}参考图预览`}>
        {job ? <ReferenceJobOverlay job={job} /> : null}
        <ReferenceImagePreview key={`${preview.id}:${preview.localPath}:${retry}`} localPath={preview.localPath} alt={`${label}参考图版本 ${previewNumber}`} eager onStatusChange={(status) => reportStatus(preview.id, status)} />
        {fileStatus[preview.id] === 'error' ? <Button variant="subtle" density="compact" icon={<RefreshCw size={13} />} onClick={() => { setFileStatus({}); setRetry((value) => value + 1); }}>重新读取文件</Button> : null}
      </div>
      <div className="comic-reference-preview__meta"><span><strong>v{previewNumber}</strong><small>{formatReferenceDate(preview.createdAt)}</small></span>
        {previewFixed ? <><IconButton label="取消固定参考版本" icon={<PinOff size={13} />} disabled={busy} onClick={() => onSetFixed(null)} /></>
          : <Button variant="secondary" density="compact" icon={<Pin size={12} />} disabled={busy || fileStatus[preview.id] !== 'ready'} onClick={() => { setChecked(false); setAdoption({ id: preview.id, previous: fixedVersionId }); }}>采用并固定此版本</Button>}
      </div>
      <div className="comic-reference-candidates-heading"><strong>参考图版本</strong><small>预览与采用分别操作 · {versions.length} 个版本</small></div>
      <div className="comic-reference-version-strip" aria-label={`${label}参考图版本`}>
        {[...versions].reverse().map((version, index) => <Button key={version.id} variant="subtle" className="comic-reference-version" aria-label={`预览参考图版本 ${versions.length - index}${version.id === fixedVersionId ? '，当前固定' : ''}`} aria-pressed={version.id === preview.id} onClick={() => setSelectedId(version.id)}>
          <ReferenceImagePreview key={`${version.id}:${version.localPath}:${retry}`} localPath={version.localPath} alt={`${label}版本 ${versions.length - index}缩略图`} eager={version.id === fixedVersionId} onStatusChange={(status) => reportStatus(version.id, status)} />
          <span><strong>v{versions.length - index}</strong>{version.id === fixedVersionId ? <Pin size={11} aria-label="固定版本" /> : null}</span>
        </Button>)}
        {job ? <span className="comic-reference-version is-job" aria-hidden="true">
          <span className="motion-comic-reference-image is-loading"><Loader2 className="director-spin comic-reference-loading" size={20} /></span>
          <span><strong>生成中</strong></span>
        </span> : null}
      </div>
    </> : <div className="motion-comic-reference-empty">
      {job ? <Loader2 className="director-spin" size={20} /> : <ImagePlus size={20} />}
      <span><strong>{job ? job.label : '尚未生成参考图'}</strong><small>{job ? job.detail ?? '结果会作为候选出现，不会自动固定' : `${label}还没有视觉基准。生成与导入均新增候选，预览并核对后手动采用。`}</small></span>
      {!job && active && busy ? <small className="comic-reference-hint">已提交，等待服务返回候选。</small> : null}
    </div>}
    {job ? <p className="comic-reference-job" role="status" aria-live="polite">
      <Loader2 className="director-spin" size={12} aria-hidden="true" />
      <span><strong>{job.label}</strong>{job.detail ? <small>{job.detail}</small> : null}</span>
      {job.progress !== undefined ? <span className="comic-reference-job__bar" aria-hidden="true"><i style={{ inlineSize: `${Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%` }} /></span> : null}
    </p> : null}
    {fixedVersionId && fileStatus[fixedVersionId] === 'error' ? <small className="comic-reference-hint" role="status">固定参考文件不可用，请重新导入或固定可用版本。</small> : null}
    {versions.some((version) => version.id !== fixedVersionId) ? <small className="comic-reference-hint">其他版本与候选：点击缩略图预览，再点击“采用并固定此版本”。生成或导入候选不会替换当前固定版本。</small> : null}
    {generationHint ? <small className="comic-reference-hint" role="status">{generationHint}</small> : null}
    {active ? <InlineActionFeedback feedback={feedback} /> : null}
    <Dialog open={Boolean(adoption)} title="核对并采用参考图" onOpenChange={(open) => { if (!open) { setAdoption(null); setChecked(false); } }} surfaceClassName="comic-reference-adoption-dialog" actions={<>
      <Button onClick={() => { setAdoption(null); setChecked(false); }}>取消</Button>
      <Button variant="primary" disabled={!canAdopt} onClick={() => { if (canAdopt && adoptionVersion) { onSetFixed(adoptionVersion.id); setAdoption(null); setChecked(false); } }}>确认采用并固定</Button>
    </>}>
      <div className="comic-reference-adoption">
        <p><strong>{label}</strong> · 参考图 v{adoptionVersion ? versions.indexOf(adoptionVersion) + 1 : '—'}</p>
        {adoptionVersion?.localPath ? <img src={toLocalImageUrl(adoptionVersion.localPath)} alt={`${label}待采用参考图`} /> : null}
        <p>{adoptionImpact || '此版本将成为该资产的固定参考，后续生成使用新的视觉基准。已引用此资产的镜头需要检查一致性；其他历史参考版本仍保留。'}</p>
        {adoption && adoption.previous !== fixedVersionId ? <p role="alert">固定参考已变化，请取消后重新核对当前版本。</p> : null}
        <CheckboxField label="我已核对人物身份、造型或场景内容，并了解引用影响" checked={checked} onChange={(_, data) => setChecked(Boolean(data.checked))} />
      </div>
    </Dialog>
  </div>;
}

/** Busy state sits on the preview so the canvas reads as processing, not as a broken image. */
function ReferenceJobOverlay({ job }: { job: MotionComicReferenceJob }) {
  return <div className="comic-reference-job-overlay" role="status" aria-live="polite">
    <Loader2 className="director-spin" size={20} aria-hidden="true" />
    <strong>{job.label}</strong>
    {job.detail ? <small>{job.detail}</small> : null}
    {job.progress !== undefined ? <span className="comic-reference-job__bar" aria-hidden="true"><i style={{ inlineSize: `${Math.round(Math.max(0, Math.min(1, job.progress)) * 100)}%` }} /></span> : null}
  </div>;
}

function ReferenceImagePreview({ localPath, alt, eager, onStatusChange }: { localPath?: string; alt: string; eager?: boolean; onStatusChange: (status: 'ready' | 'error') => void }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(localPath ? 'loading' : 'error');
  const statusCallback = useRef(onStatusChange);
  useEffect(() => { statusCallback.current = onStatusChange; });
  useEffect(() => { if (!localPath) statusCallback.current('error'); }, [localPath]);
  return <span className={`motion-comic-reference-image is-${status}`} aria-busy={status === 'loading'}>
    {status === 'error' ? <span role="img" aria-label={`${alt}加载失败`}><ImageOff size={22} /><small>文件不可用</small></span> : <>
      {status === 'loading' ? <Loader2 className="director-spin comic-reference-loading" size={20} aria-label="正在读取参考图" /> : null}
      <img src={toLocalImageUrl(localPath!)} alt={alt} loading={eager ? 'eager' : 'lazy'} onLoad={() => { setStatus('ready'); onStatusChange('ready'); }} onError={() => { setStatus('error'); onStatusChange('error'); }} />
    </>}
  </span>;
}

function formatReferenceDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
