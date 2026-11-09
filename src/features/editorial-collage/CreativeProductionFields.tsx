import { CheckboxField, PreviewSelectField, SelectField, TextAreaField, TextField, Button } from '../../ui';
import { CREATIVE_STYLES, resolveCreativeStyle } from '../../shared/creative-animation/styles';
import { VOX_PRODUCTION_PRESETS, type VoxProductionSettings } from '../../shared/vox-production';
import type { EditorialCollagePipelineData } from '../../shared/editorial-collage';
import { CreativeStyleCover, CreativeStyleFilm } from './CreativeStylePreview';

/** Creation and project settings deliberately edit the same persisted inputs. */
export function CreativeProductionFields({ settings, onChange, onOpenUrl, document, busy = false, showNarration = true }: {
  settings: VoxProductionSettings;
  onChange(settings: VoxProductionSettings): void;
  onOpenUrl(url: string): Promise<void>;
  document?: EditorialCollagePipelineData;
  busy?: boolean;
  showNarration?: boolean;
}) {
  const preset = VOX_PRODUCTION_PRESETS.find(item => item.id === settings.presetId)!;
  const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId);
  const autoStyle = resolveCreativeStyle('auto', settings.presetId)!;
  const authoring = settings.authoring ?? { mode: 'template' as const, styleId: 'auto' };
  const previewMode = authoring.mode === 'ai-code' ? 'ai-code' : 'template';
  const coordinates = settings.data.some(row => row.lat !== undefined || row.lng !== undefined);
  const images = document?.assets.filter(asset => asset.kind === 'image' && asset.localPath) ?? [];
  const updateRow = (index: number, patch: Partial<VoxProductionSettings['data'][number]>) => onChange({ ...settings, data: settings.data.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const updateArchive = (index: number, patch: Partial<VoxProductionSettings['archives'][number]>) => onChange({ ...settings, archives: settings.archives.map((row, i) => i === index ? { ...row, ...patch } : row) });
  return <div className="vox-production-fields">
    <SelectField label="制作方式" value={authoring.mode} disabled={busy}
      options={[{ value: 'ai-code', label: 'Lemo 风格动画（推荐）' }, { value: 'template', label: 'Vox 分层动画' }]}
      hint={authoring.mode === 'ai-code' ? 'Lemo：导演方案 → 素材准备 → 公共绘图与连续场景 → 样片检查 → 整片调度。每步单独保存，失败可从对应步骤继续；最终输出一部连续影片。' : 'Vox：画面规划 → 背景与主体分层 → 去底 → 跟随旁白编排图文、图表与运动。使用本地动效编排，不调用 Lemo 全片创作。'}
      onChange={(_, event) => onChange({ ...settings, authoring: { ...authoring, mode: event.value as 'ai-code' | 'template' } })} />
    <CheckboxField label="自动生成图片" checked={settings.generateImages} disabled={busy} onChange={(_, event) => onChange({ ...settings, generateImages: event.checked === true })} />
    {authoring.mode === 'ai-code' ? <p className="vox-hint">按导演方案准备插画和已有图片，再与代码绘制画面组合。真实证据需导入并填写出处与许可；生成插画不能替代真实资料。</p> : null}
    <PreviewSelectField label="视觉风格" value={authoring.styleId} disabled={busy} detailLabel="播放样片" showSelectedPreview selectedPreviewHint="LemoLab 官方封面 · 点击播放样片"
      options={[
        { value: 'auto', label: '自动匹配（推荐）', description: `当前素材流程匹配：${autoStyle.cn}`, preview: () => <CreativeStyleCover key={autoStyle.slug} style={autoStyle} />, thumbnail: () => <CreativeStyleCover key={autoStyle.slug} style={autoStyle} thumbnail />, detailPreview: () => <CreativeStyleFilm style={autoStyle} mode={previewMode} automatic onOpenUrl={onOpenUrl} /> },
        ...CREATIVE_STYLES.filter(item => item.adapter || item.slug === authoring.styleId).map(item => ({ value: item.slug, label: item.cn, group: item.category_cn, description: item.description ?? item.line_cn, disabled: !item.adapter, preview: () => <CreativeStyleCover key={item.slug} style={item} />, thumbnail: () => <CreativeStyleCover key={item.slug} style={item} thumbnail />, detailPreview: () => <CreativeStyleFilm style={item} mode={previewMode} automatic={false} onOpenUrl={onOpenUrl} /> })),
      ]}
      hint={`${style?.description ?? '请选择已适配的风格。'} 封面可离线预览，播放官方样片需要联网。`}
      onChange={value => onChange({ ...settings, authoring: { ...authoring, styleId: value } })} />
    <SelectField label="素材流程" value={settings.presetId} disabled={busy}
      options={VOX_PRODUCTION_PRESETS.map(item => ({ value: item.id, label: item.id === 'paper-explainer' ? '图文与图形动画（推荐）' : item.label }))}
      hint={authoring.mode === 'ai-code' ? '选择文案所需的素材来源；完整风格决定画面与镜头编排。' : settings.presetId === 'paper-explainer' ? settings.generateImages ? '自动生成背景与主体，完成去底；构图和动效跟随所选风格。' : '使用已有图片或代码图形制作画面；保留画面规划、动画创作和旁白设置。' : preset.description}
      onChange={(_, event) => onChange({ ...settings, presetId: event.value as VoxProductionSettings['presetId'] })} />
    {authoring.mode === 'ai-code' ? <TextAreaField label="动画创作要求" value={authoring.brief ?? ''} rows={3} maxLength={2000} resize="vertical" disabled={busy}
      placeholder="选填，例如：大字开场，三个观点依次展开，节奏克制，避免快速闪烁。"
      hint="留空则按风格自动编排；这里只描述画面和动效，旁白仍使用原文。"
      onChange={(_, event) => onChange({ ...settings, authoring: { ...authoring, brief: event.value } })} /> : null}
    {showNarration ? <CheckboxField label="自动生成旁白与字幕" checked={settings.narration} disabled={busy} onChange={(_, event) => onChange({ ...settings, narration: event.checked === true })} /> : null}
    {settings.presetId === 'data-map' ? <section className="vox-production-fields" aria-label="真实数据输入">
      <TextField label="数据单位" value={settings.dataUnit ?? ''} disabled={busy} hint="例如 ℃、万元、%；所有数据使用同一单位。" onChange={(_, event) => onChange({ ...settings, dataUnit: event.value })} />
      <CheckboxField label="使用地点坐标绘制路线" checked={coordinates} disabled={busy} onChange={(_, event) => onChange({ ...settings, data: settings.data.length ? settings.data.map(row => ({ ...row, lat: event.checked ? row.lat ?? 0 : undefined, lng: event.checked ? row.lng ?? 0 : undefined })) : event.checked ? [{ label: '', value: 0, source: '', lat: 0, lng: 0 }] : [] })} />
      {settings.data.map((row, index) => <fieldset key={index} className="vox-production-source-row"><legend>数据 {index + 1}</legend>
        <TextField label="名称" value={row.label} disabled={busy} onChange={(_, event) => updateRow(index, { label: event.value })} />
        <TextField label="数值" type="number" value={Number.isFinite(row.value) ? String(row.value) : ''} disabled={busy} onChange={(_, event) => updateRow(index, { value: event.value.trim() ? Number(event.value) : NaN })} />
        <TextField label="出处或链接" value={row.source} disabled={busy} onChange={(_, event) => updateRow(index, { source: event.value })} />
        {coordinates ? <>
          <TextField label="纬度" type="number" value={String(row.lat ?? '')} disabled={busy} onChange={(_, event) => updateRow(index, { lat: event.value ? Number(event.value) : undefined })} />
          <TextField label="经度" type="number" value={String(row.lng ?? '')} disabled={busy} onChange={(_, event) => updateRow(index, { lng: event.value ? Number(event.value) : undefined })} />
        </> : null}
        <Button variant="subtle" disabled={busy} onClick={() => onChange({ ...settings, data: settings.data.filter((_, i) => i !== index) })}>删除数据 {index + 1}</Button>
      </fieldset>)}
      <Button disabled={busy || settings.data.length >= (coordinates ? 24 : 12)} onClick={() => onChange({ ...settings, data: [...settings.data, { label: '', value: 0, source: '', ...(coordinates ? { lat: 0, lng: 0 } : {}) }] })}>添加有来源的数据</Button>
      {!settings.data.length ? <p className="vox-hint">自动制作前需填写至少两条有来源的数据，可先创建项目。</p> : null}
    </section> : null}
    {settings.presetId === 'archival-story' || authoring.mode === 'ai-code' ? <section className="vox-production-fields" aria-label="真实档案输入">
      {settings.archives.map((row, index) => <fieldset key={index} className="vox-production-source-row"><legend>档案 {index + 1}</legend>
        <SelectField label="已导入的图片" value={row.assetVersionId} disabled={busy} options={[{ value: '', label: '请选择真实资料图片' }, ...images.map(asset => ({ value: asset.id, label: asset.prompt?.slice(0, 60) || asset.assetId }))]} onChange={(_, event) => updateArchive(index, { assetVersionId: event.value })} />
        <TextField label="资料出处" value={row.source} disabled={busy} onChange={(_, event) => updateArchive(index, { source: event.value })} />
        <TextField label="许可或使用说明" value={row.license} disabled={busy} onChange={(_, event) => updateArchive(index, { license: event.value })} />
        <Button variant="subtle" disabled={busy} onClick={() => onChange({ ...settings, archives: settings.archives.filter((_, i) => i !== index) })}>删除档案 {index + 1}</Button>
      </fieldset>)}
      {images.length ? <Button disabled={busy || settings.archives.length >= 100} onClick={() => onChange({ ...settings, archives: [...settings.archives, { assetVersionId: images[0].id, source: '', license: '' }] })}>添加档案引用</Button> : <p className="vox-hint">创建项目后，在镜头设置中导入资料图片，再补充出处与许可。</p>}
    </section> : null}
  </div>;
}
