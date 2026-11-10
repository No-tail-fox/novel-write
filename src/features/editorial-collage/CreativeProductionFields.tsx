import { useState } from 'react';
import { CheckboxField, PreviewSelectField, SelectField, TextAreaField, TextField, Button } from '../../ui';
import { CREATIVE_STYLES, LEMO_LIBRARY_STYLES, OPUSCAR98_STYLES, creativeStyleSupportsMode, resolveCreativeStyle } from '../../shared/creative-animation/styles';
import { VOX_PRODUCTION_PRESETS, type VoxProductionSettings } from '../../shared/vox-production';
import { LEMO_AGENT_ASSET_LIMIT, LEMO_AGENT_IMAGE_DEFAULT, LEMO_AGENT_IMAGE_MAX, LEMO_ASSET_VIDEO_MAX_SECONDS, lemoStyleRequiresRealMaterial } from '../../shared/creative-animation/agent-assets';
import type { EditorialCollagePipelineData } from '../../shared/editorial-collage';
import { LEMO_AGENT_MAX_TURNS, LEMO_AGENT_TURNS_LIMIT, lemoAgentMaxTurns } from '../../shared/creative-animation/upstream-agent';
import { CreativeStyleCover, CreativeStyleFilm } from './CreativeStylePreview';

/** Creation and project settings deliberately edit the same persisted inputs. */
export function CreativeProductionFields({ settings, onChange, onOpenUrl, document, busy = false, showNarration = true, onImportAsset }: {
  settings: VoxProductionSettings;
  onChange(settings: VoxProductionSettings): void;
  onOpenUrl(url: string): Promise<void>;
  document?: EditorialCollagePipelineData;
  busy?: boolean;
  showNarration?: boolean;
  /** Lemo material channel: import a local image/video into the project; resolves with the new asset id. */
  onImportAsset?(kind: 'image' | 'video'): Promise<string | undefined>;
}) {
  const preset = VOX_PRODUCTION_PRESETS.find(item => item.id === settings.presetId)!;
  const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId);
  const autoStyle = resolveCreativeStyle('auto', settings.presetId)!;
  const authoring = settings.authoring ?? { mode: 'template' as const, styleId: 'auto' };
  const previewMode = authoring.mode === 'ai-code' ? 'ai-code' : 'template';
  const coordinates = settings.data.some(row => row.lat !== undefined || row.lng !== undefined);
  const lemo = authoring.mode === 'ai-code';
  const images = document?.assets.filter(asset => (asset.kind === 'image' || lemo && asset.kind === 'video') && asset.localPath) ?? [];
  const evidenceStyle = lemo && lemoStyleRequiresRealMaterial(authoring.styleId, settings.presetId);
  const agentImages = settings.agentImages ?? { enabled: false, maxImages: LEMO_AGENT_IMAGE_DEFAULT };
  const maxTurns = lemoAgentMaxTurns(settings.agentMaxTurns);
  const [importing, setImporting] = useState<'image' | 'video' | null>(null);
  const [importError, setImportError] = useState('');
  const importAsset = async (kind: 'image' | 'video') => {
    setImporting(kind); setImportError('');
    try {
      const id = await onImportAsset?.(kind);
      if (id) onChange({ ...settings, archives: [...settings.archives, { assetVersionId: id, source: '', license: '' }] });
    } catch (error) { setImportError(error instanceof Error ? error.message : String(error)); }
    finally { setImporting(null); }
  };
  const updateRow = (index: number, patch: Partial<VoxProductionSettings['data'][number]>) => onChange({ ...settings, data: settings.data.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const updateArchive = (index: number, patch: Partial<VoxProductionSettings['archives'][number]>) => onChange({ ...settings, archives: settings.archives.map((row, i) => i === index ? { ...row, ...patch } : row) });
  return <div className="vox-production-fields">
    {/* 创意动画 and 模板动画 are separate project types: the route is fixed at creation and never switched here. */}
    <p className="vox-hint" data-production-route={authoring.mode === 'ai-code' ? 'lemo' : 'template'}>{authoring.mode === 'ai-code'
      ? 'Lemo 创意动画：导演型 AI 按上游 Lemo 文档整片创作，自己读风格、写代码、看静帧、修改；66 种完整风格 + OPUSCAR 98 的 98 种轻量风格。最终输出一部连续影片。'
      : 'Remotion 模板动画：画面规划 → 背景与主体分层 → 去底 → 跟随旁白编排图文、图表与运动。用已适配的 59 种风格和模板，稳定、可批量。'}</p>
    {lemo ? <>
      <CheckboxField label="允许 AI 生成插画" checked={agentImages.enabled && !evidenceStyle} disabled={busy || evidenceStyle} onChange={(_, event) => onChange({ ...settings, agentImages: { ...agentImages, enabled: event.checked === true } })} />
      {agentImages.enabled && !evidenceStyle ? <TextField label="插画数量上限" type="number" value={String(agentImages.maxImages)} disabled={busy} hint={`整片最多 ${LEMO_AGENT_IMAGE_MAX} 张；每张按生图服务商计费，恢复和续跑不会重复收费。`}
        onChange={(_, event) => onChange({ ...settings, agentImages: { ...agentImages, maxImages: Math.min(LEMO_AGENT_IMAGE_MAX, Math.max(1, Math.round(Number(event.value) || 1))) } })} /> : null}
      <p className="vox-hint">{evidenceStyle ? '纪实/证据类风格只使用导入的真实素材，不生成插画；成片会在素材出现时标注来源，并在片尾列出每份素材的出处与许可（未署名时 Agent 不能交片）。' : agentImages.enabled ? 'Agent 只在代码画不好的地方（复杂人物、手绘质感等）申请插画；文字、数据和图章仍用代码绘制。生成插画不会被当作真实资料。' : '默认全部用代码绘制，不调用生图。可以导入真实图片或视频作为素材。'}</p>
      <SelectField label="Agent 轮数上限" value={String(maxTurns)} disabled={busy}
        options={[...new Set([16, 32, 48, LEMO_AGENT_MAX_TURNS, 96, 128, LEMO_AGENT_TURNS_LIMIT, maxTurns])].sort((a, b) => a - b).map(value => ({ value: String(value), label: value === LEMO_AGENT_MAX_TURNS ? `${value} 轮（默认）` : `${value} 轮` }))}
        hint="每轮是一次付费模型调用。达到上限仍未完成时会停止并保留工程；调高后保存设置，再点“重试失败步骤”即可从下一轮继续。"
        onChange={(_, event) => { const value = Number(event.value); const { agentMaxTurns: _turns, ...rest } = settings; onChange(value === LEMO_AGENT_MAX_TURNS ? rest : { ...rest, agentMaxTurns: value }); }} />
      <SelectField label="Token 预算" value={String(settings.agentMaxTokens ?? '')} disabled={busy}
        options={[{ value: '', label: '不限（仅受轮数上限约束）' }, ...[...new Set([500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, ...(settings.agentMaxTokens ? [settings.agentMaxTokens] : [])])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${(value / 1_000_000).toLocaleString('zh-CN')}M tokens` }))]}
        hint="按服务商返回的输入+输出 token 累计；服务商不返回用量时无法计入。达到预算会停止并可续跑，不估算费用。"
        onChange={(_, event) => { const { agentMaxTokens: _tokens, ...rest } = settings; onChange(event.value ? { ...rest, agentMaxTokens: Number(event.value) } : rest); }} />
    </> : <CheckboxField label="自动生成图片" checked={settings.generateImages} disabled={busy} onChange={(_, event) => onChange({ ...settings, generateImages: event.checked === true })} />}
    <PreviewSelectField label="视觉风格" value={authoring.styleId} disabled={busy} detailLabel="播放样片" showSelectedPreview selectedPreviewHint="LemoLab 官方封面 · 点击播放样片"
      options={[
        { value: 'auto', label: '自动匹配（推荐）', description: `当前素材流程匹配：${autoStyle.cn}`, preview: () => <CreativeStyleCover key={autoStyle.slug} style={autoStyle} />, thumbnail: () => <CreativeStyleCover key={autoStyle.slug} style={autoStyle} thumbnail />, detailPreview: () => <CreativeStyleFilm style={autoStyle} mode={previewMode} automatic onOpenUrl={onOpenUrl} /> },
        ...(authoring.mode === 'ai-code' ? [...LEMO_LIBRARY_STYLES, ...OPUSCAR98_STYLES] : CREATIVE_STYLES).filter(item => creativeStyleSupportsMode(item, previewMode) || item.slug === authoring.styleId).map(item => ({ value: item.slug, label: item.family === 'opuscar98' ? `${item.cn} · ${item.opuscar98?.zh ?? ''}` : item.cn, group: item.category_cn, description: item.description ?? item.line_cn, disabled: !creativeStyleSupportsMode(item, previewMode), preview: () => <CreativeStyleCover key={item.slug} style={item} />, thumbnail: () => <CreativeStyleCover key={item.slug} style={item} thumbnail />, detailPreview: () => <CreativeStyleFilm style={item} mode={previewMode} automatic={false} onOpenUrl={onOpenUrl} /> })),
      ]}
      hint={`${style?.description ?? '请选择风格。'}${style?.family === 'opuscar98' ? ' OPUSCAR 98 轻量风格：只有风格提示词，制作时 AI 会先按上游 MY-STYLES 流程写出这部片自己的 STYLE.md。' : ''} 封面可离线预览，播放官方样片需要联网。`}
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
    {settings.presetId === 'archival-story' || lemo ? <section className="vox-production-fields" aria-label={lemo ? '导入素材' : '真实档案输入'}>
      {lemo ? <p className="vox-hint">{`导入的图片或视频会复制进影片工程，Agent 可以查看并直接使用；视频最长 ${LEMO_ASSET_VIDEO_MAX_SECONDS} 秒，会转成 24 fps 图片序列。每份素材需填写出处与许可，最多 ${LEMO_AGENT_ASSET_LIMIT} 份。`}</p> : null}
      {settings.archives.map((row, index) => <fieldset key={index} className="vox-production-source-row"><legend>{lemo ? '素材' : '档案'} {index + 1}</legend>
        <SelectField label={lemo ? '已导入的图片或视频' : '已导入的图片'} value={row.assetVersionId} disabled={busy} options={[{ value: '', label: lemo ? '请选择素材' : '请选择真实资料图片' }, ...images.map(asset => ({ value: asset.id, label: (asset.kind === 'video' ? '视频 · ' : '') + (asset.prompt?.slice(0, 60) || asset.assetId) }))]} onChange={(_, event) => updateArchive(index, { assetVersionId: event.value })} />
        <TextField label="资料出处" value={row.source} disabled={busy} onChange={(_, event) => updateArchive(index, { source: event.value })} />
        <TextField label="许可或使用说明" value={row.license} disabled={busy} onChange={(_, event) => updateArchive(index, { license: event.value })} />
        {lemo ? <TextField label="画面说明（选填）" value={row.description ?? ''} disabled={busy} hint="告诉 Agent 这份素材是什么、适合放在哪一段。" onChange={(_, event) => updateArchive(index, { description: event.value || undefined })} /> : null}
        <Button variant="subtle" disabled={busy} onClick={() => onChange({ ...settings, archives: settings.archives.filter((_, i) => i !== index) })}>{lemo ? '删除素材' : '删除档案'} {index + 1}</Button>
      </fieldset>)}
      {lemo && onImportAsset ? <div className="vox-production-actions">
        <Button disabled={busy || importing !== null || settings.archives.length >= LEMO_AGENT_ASSET_LIMIT} onClick={() => void importAsset('image')}>导入图片</Button>
        <Button disabled={busy || importing !== null || settings.archives.length >= LEMO_AGENT_ASSET_LIMIT} onClick={() => void importAsset('video')}>导入视频</Button>
        {importing ? <span className="vox-hint" role="status">正在导入素材…</span> : null}
      </div> : null}
      {importError ? <p role="alert">{importError}</p> : null}
      {images.length ? <Button disabled={busy || settings.archives.length >= (lemo ? LEMO_AGENT_ASSET_LIMIT : 100)} onClick={() => onChange({ ...settings, archives: [...settings.archives, { assetVersionId: (images.find(asset => !settings.archives.some(ref => ref.assetVersionId === asset.id)) ?? images[0]).id, source: '', license: '' }] })}>{lemo ? '引用已导入的素材' : '添加档案引用'}</Button>
        : lemo && onImportAsset ? null : <p className="vox-hint">{lemo ? '创建项目后，在“自动制作设置”中导入图片或视频，再补充出处与许可。' : '创建项目后，在镜头设置中导入资料图片，再补充出处与许可。'}</p>}
    </section> : null}
  </div>;
}
