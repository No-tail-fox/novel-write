import { useState } from 'react';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { Button, SelectField } from '../../ui';
import type { ShortVideoMaterials } from '../../shared/short-video-materials';
export function ShortVideoMaterialFields({ value, onChange, onAdd, templateControlsFit }: {
  templateControlsFit?: boolean;
  value: ShortVideoMaterials; onChange: (value: ShortVideoMaterials) => void; onAdd: () => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [addError, setAddError] = useState('');
  async function handleAdd() {
    if (picking) return;
    setPicking(true); setAddError('');
    try { await onAdd(); }
    catch (error) { setAddError(formatAppErrorMessage(normalizeAppError(error))); }
    finally { setPicking(false); }
  }
  return <section aria-label="素材混剪视频池">
    <Button onClick={handleAdd} disabled={picking || value.files.length >= 100}>{picking ? '正在选择素材…' : '添加混剪视频'}</Button>
    <p>可一次选择多个 MP4、MOV 或 WebM 视频（{value.files.length}/100）。</p>
    {addError ? <p role="alert">{addError}</p> : null}
    {value.files.length ? <ol>{value.files.map((file, index) => <li key={file}>
      <span style={{ overflowWrap: 'anywhere' }}>{file}</span>
      <Button variant="subtle" disabled={picking} onClick={() => onChange({ ...value, files: value.files.filter((_, i) => i !== index) })}>移除素材 {index + 1}</Button>
    </li>)}</ol> : <p role="status">请至少添加一个本地视频；不会用付费生图代替缺失素材。</p>}
    <SelectField disabled={templateControlsFit || picking} hint={templateControlsFit ? "Pixelle 原模板决定画幅裁切；此设置仅用于常规短片。" : undefined} label="混剪画幅适配" value={value.fit} options={[{ value: 'cover', label: '铺满画幅（居中裁切）' }, { value: 'contain', label: '完整显示（留边）' }]} onChange={event => onChange({ ...value, fit: event.target.value as ShortVideoMaterials['fit'] })} />
    <p>按添加顺序循环分配；常规短片长素材顺序选段，短素材减速匹配配音。Pixelle 视频使用原模板补齐策略。</p>
    <p>导入后复制到项目，MP4 与剪映草稿共用素材。素材原声静音，由程序统一配音和字幕；请确认素材使用授权。</p>
  </section>;
}
