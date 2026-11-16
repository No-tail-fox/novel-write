import { useState } from 'react';
import { Images, Plus, X } from 'lucide-react';
import { Button, IconButton } from '../../ui';
import { toLocalImageUrl } from '../tasks/task-formatters';

/** Inputs for this generation only; removing one never removes an adopted output. */
export function MotionComicGenerationReferences({ paths, maxImages, onImport, onRemove, onLibrary }: {
  paths: readonly string[];
  maxImages: number;
  onImport: () => Promise<void>;
  onRemove: (path: string) => void;
  onLibrary: () => void;
}) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  return <section className="comic-generation-references" aria-label="生图参考图">
    <div className="comic-generation-references__heading"><strong>生图参考图 <small>{paths.length} 张</small></strong><div>
      <Button density="compact" variant="secondary" icon={<Plus size={13} />} disabled={importing || paths.length >= 20} onClick={() => {
        setImporting(true); setError('');
        void onImport().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '参考图导入失败，请重试。')).finally(() => setImporting(false));
      }}>{importing ? '导入中…' : '上传参考图'}</Button>
      <Button density="compact" variant="subtle" icon={<Images size={13} />} onClick={onLibrary}>素材库</Button>
    </div></div>
    {paths.length ? <div className="comic-generation-references__images">{paths.map((path, index) => <div key={path} className="comic-generation-references__image">
      <img src={toLocalImageUrl(path)} alt={`生图输入参考图 ${index + 1}`} />
      <IconButton label={`删除生图参考图 ${index + 1}`} density="compact" icon={<X size={13} />} onClick={() => onRemove(path)} />
    </div>)}</div> : <small>可上传图片辅助生图；不添加时按提示词生成。</small>}
    {paths.length > maxImages ? <small role="status">当前模型最多使用前 {maxImages} 张参考图，其余图片会保留。</small> : null}
    {error ? <small role="alert">{error}</small> : null}
  </section>;
}
