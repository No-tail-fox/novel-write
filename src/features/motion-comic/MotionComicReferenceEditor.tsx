import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ImageOff, ImagePlus, Images, Loader2, LockKeyhole, Pin, PinOff, RefreshCw } from 'lucide-react';
import type { ProductionAssetVersion } from '../../shared/production-workflow';
import { Button, IconButton, Toolbar } from '../../ui';
import type { AsyncActionFeedback } from '../../ui/async-action';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { toLocalImageUrl } from '../tasks/task-formatters';

export function MotionComicReferenceEditor({ label, versions, fixedVersionId, busy, active, feedback, importControl, generationHint, onSetFixed, onImageStatus }: {
  label: string;
  versions: readonly ProductionAssetVersion[];
  fixedVersionId?: string;
  busy: boolean;
  active: boolean;
  feedback: AsyncActionFeedback | null;
  importControl: ReactElement;
  generationHint?: string;
  onSetFixed: (versionId: string | null) => void;
  onImageStatus: (versionId: string, status: 'ready' | 'error') => void;
}) {
  const [selectedId, setSelectedId] = useState(fixedVersionId ?? '');
  const [fileStatus, setFileStatus] = useState<Record<string, 'ready' | 'error'>>({});
  const [retry, setRetry] = useState(0);
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
      <span className="motion-comic-reference-title"><Images size={15} /><span><strong>一致性参考图</strong><small>{fixedVersionId ? `已固定 · ${versions.length} 个版本` : versions.length > 0 ? `${versions.length} 个版本 · 尚未固定` : '缺少参考图'}</small></span></span>
      <Toolbar aria-label={`${label}参考图操作`}>{importControl}</Toolbar>
    </div>
    {preview ? <>
      <div className="comic-reference-preview" aria-label={`${label}参考图预览`}>
        <ReferenceImagePreview key={`${preview.id}:${preview.localPath}:${retry}`} localPath={preview.localPath} alt={`${label}参考图版本 ${previewNumber}`} eager onStatusChange={(status) => reportStatus(preview.id, status)} />
        {fileStatus[preview.id] === 'error' ? <Button variant="subtle" density="compact" icon={<RefreshCw size={13} />} onClick={() => { setFileStatus({}); setRetry((value) => value + 1); }}>重新读取文件</Button> : null}
      </div>
      <div className="comic-reference-preview__meta"><span><strong>v{previewNumber}</strong><small>{formatReferenceDate(preview.createdAt)}</small></span>
        {previewFixed ? <><span className="motion-comic-reference-fixed"><LockKeyhole size={12} />当前固定</span><IconButton label="取消固定参考版本" icon={<PinOff size={13} />} disabled={busy} onClick={() => onSetFixed(null)} /></>
          : <Button variant="secondary" density="compact" icon={<Pin size={12} />} disabled={busy || fileStatus[preview.id] !== 'ready'} onClick={() => onSetFixed(preview.id)}>固定此版本</Button>}
      </div>
      <div className="comic-reference-version-strip" aria-label={`${label}参考图版本`}>
        {[...versions].reverse().map((version, index) => <Button key={version.id} variant="subtle" className="comic-reference-version" aria-label={`预览参考图版本 ${versions.length - index}${version.id === fixedVersionId ? '，当前固定' : ''}`} aria-pressed={version.id === preview.id} onClick={() => setSelectedId(version.id)}>
          <ReferenceImagePreview key={`${version.id}:${version.localPath}:${retry}`} localPath={version.localPath} alt={`${label}版本 ${versions.length - index}缩略图`} eager={version.id === fixedVersionId} onStatusChange={(status) => reportStatus(version.id, status)} />
          <span><strong>v{versions.length - index}</strong>{version.id === fixedVersionId ? <Pin size={11} aria-label="固定版本" /> : null}</span>
        </Button>)}
      </div>
    </> : <div className="motion-comic-reference-empty">
      {active && busy ? <Loader2 className="director-spin" size={22} /> : <ImagePlus size={22} />}
      <span><strong>{active && busy ? '正在处理参考图' : '缺少参考图'}</strong><small>{active && busy ? '完成后会自动固定为当前版本' : `${label}尚未建立视觉基准`}</small></span>
    </div>}
    {fixedVersionId && fileStatus[fixedVersionId] === 'error' ? <small className="comic-reference-hint" role="status">固定参考文件不可用，请重新导入或固定可用版本。</small> : null}
    {generationHint ? <small className="comic-reference-hint" role="status">{generationHint}</small> : null}
    {active ? <InlineActionFeedback feedback={feedback} /> : null}
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
