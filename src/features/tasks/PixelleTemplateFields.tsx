import { useState } from 'react';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import { Button, CheckboxField, SelectField, TextField } from '../../ui';
import type { PixelleCatalog, PixelleTaskOptions, PixelleVisualTemplateRef } from '../../shared/pixelle';
import { pixelleParameterLabel, pixelleTemplateLabel } from './pixelle-presentation';
import { pixelleUsesVideo } from '../../shared/pixelle-task';
const names = { image: '图片', static: '静态排版', video: '视频', asset: '图片 / 视频' };
export function PixelleTemplateFields({ catalog, selected, options, error, onChange, onSelectVideo, materialPoolCount }: {
  materialPoolCount?: number;
  catalog?: PixelleCatalog; selected?: PixelleVisualTemplateRef; options: PixelleTaskOptions; error?: string;
  onChange: (ref: PixelleVisualTemplateRef | undefined, options: PixelleTaskOptions) => void;
  onSelectVideo: () => Promise<void>;
}) {
  const [pickingVideo, setPickingVideo] = useState(false);
  const [videoSelectionError, setVideoSelectionError] = useState('');
  async function handleSelectVideo() {
    if (pickingVideo) return;
    setPickingVideo(true); setVideoSelectionError('');
    try { await onSelectVideo(); }
    catch (error) { setVideoSelectionError(formatAppErrorMessage(normalizeAppError(error))); }
    finally { setPickingVideo(false); }
  }
  const template = catalog?.templates.find(item => item.ref.path === selected?.path);
  const update = (patch: Partial<PixelleTaskOptions>) => onChange(selected, { ...options, ...patch });
  return <section aria-label="Pixelle 原版视觉模板">
    <SelectField label="画面模板引擎" hint="画面模板与剪映草稿样式独立；两种输出复用同一套素材和配音。" value={selected?.path ?? ''} options={[
      { value: '', label: 'StoryDream 常规短片' },
      ...(catalog?.templates ?? []).map(item => ({ value: item.ref.path, label: `${pixelleTemplateLabel(item)} · ${names[item.type]} · ${item.size}`, group: `Pixelle 原版 · ${item.orientation === 'portrait' ? '竖屏' : item.orientation === 'landscape' ? '横屏' : '方形'}` })),
    ]} onChange={event => {
      const next = catalog?.templates.find(item => item.ref.path === event.target.value);
      onChange(next?.ref, { subtitleMode: 'template', parameters: {}, mediaKind: next?.type === 'video' ? 'video' : 'image', padStrategy: 'freeze' });
    }} />
    {error ? <p role="alert">{error}</p> : null}
    {!catalog && !error ? <p role="status">正在读取本地原版模板目录…</p> : null}
    {template ? <>
      <p>{template.width} × {template.height} · 原版 {template.ref.path}。{template.type === 'static' ? '静态模板不调用生图模型。' : pixelleUsesVideo(template, options) ? '复用本地视频，不调用生图模型。' : '使用短片流程生成或导入的图片。'}</p>
      <div className="new-task-field-grid">
        <SelectField label="字幕方式" value={options.subtitleMode} options={[{ value: 'template', label: '原模板文字（整镜头显示）' }, { value: 'timed-overlay', label: '程序时间轴字幕' }, { value: 'off', label: '关闭正文字幕' }]} onChange={event => update({ subtitleMode: event.target.value as PixelleTaskOptions['subtitleMode'] })} />
        {template.type === 'asset' ? <SelectField label="模板素材类型" value={options.mediaKind ?? 'image'} options={[{ value: 'image', label: '图片' }, { value: 'video', label: '本地视频' }]} onChange={event => update({ mediaKind: event.target.value as 'image' | 'video' })} /> : null}
        {Object.entries(template.parameters).map(([key, parameter]) => {
          const value = options.parameters?.[key] ?? parameter.default;
          const set = (next: string | number | boolean) => update({ parameters: { ...options.parameters, [key]: next } });
          return parameter.type === 'bool' ? <CheckboxField key={key} label={pixelleParameterLabel(key, parameter)} checked={value === true} onChange={(_, data) => set(data.checked === true)} />
            : <TextField key={key} label={pixelleParameterLabel(key, parameter)} hint={`原模板参数：${key}`} type={parameter.type === 'number' ? 'number' : 'text'} value={String(value)} onChange={event => set(parameter.type === 'number' ? Number(event.target.value) : event.target.value)} />;
        })}
      </div>
      {pixelleUsesVideo(template, options) ? <div>
        {materialPoolCount !== undefined ? <p>复用素材混剪视频池：{materialPoolCount} 个视频，无需重复上传。</p> : <>
          <Button onClick={handleSelectVideo} disabled={pickingVideo}>{pickingVideo ? '正在选择视频…' : '选择本地视频'}</Button>
          {videoSelectionError ? <p role="alert">{videoSelectionError}</p> : null}
          <p style={{ overflowWrap: 'anywhere' }}>{options.videoPath || '尚未选择；不能将透明模板叠层作为成片。'}</p>
        </>}
        <SelectField label="视频短于配音时" value={options.padStrategy ?? 'freeze'} options={[{ value: 'freeze', label: '冻结最后一帧' }, { value: 'black', label: '黑屏补齐' }]} onChange={event => update({ padStrategy: event.target.value as 'freeze' | 'black' })} />
      </div> : null}
      <p>原模板标题保留；程序字幕模式会清空原模板正文，避免字幕叠加。配音、背景音乐仍由短片流程统一处理。</p>
    </> : null}
  </section>;
}
