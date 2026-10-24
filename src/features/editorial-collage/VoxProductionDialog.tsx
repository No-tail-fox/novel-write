import { useState } from 'react';
import { Button, CheckboxField, Dialog, SelectField, TextField } from '../../ui';
import { VOX_PRODUCTION_PRESETS, voxProductionInputErrors, voxProductionSettings, voxProductionSettingsSchema, type VoxProductionSettings } from '../../shared/vox-production';
import type { EditorialCollagePipelineData } from '../../shared/editorial-collage';
import { CREATIVE_STYLES, resolveCreativeStyle } from '../../shared/creative-animation/styles';

export function VoxProductionDialog({ document, busy, onClose, onStart }: {
  document: EditorialCollagePipelineData; busy: boolean; onClose(): void;
  onStart(settings: VoxProductionSettings): Promise<void>;
}) {
  const [settings, setSettings] = useState(document.productionSettings ?? { ...voxProductionSettings(), authoring: { mode: 'ai-code' as const, styleId: 'auto' } });
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [coordinates, setCoordinates] = useState(settings.data.some(r => r.lat !== undefined));
  const preset = VOX_PRODUCTION_PRESETS.find(p => p.id === settings.presetId)!;
  const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId);
  const filteredStyles = CREATIVE_STYLES.filter(s => (category === 'all' || category === s.category_cn) && `${s.slug} ${s.cn} ${s.en} ${s.line_cn} ${s.uses.join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const parsed = voxProductionSettingsSchema.safeParse(settings);
  const error = parsed.success ? voxProductionInputErrors(document, parsed.data).join(' ') : '请补齐名称、数值、来源和许可；坐标必须在有效范围内。';
  const images = document.assets.filter(a => a.kind === 'image' && a.localPath);
  const updateRow = (index: number, change: Partial<VoxProductionSettings['data'][number]>) => setSettings({ ...settings, data: settings.data.map((r, i) => i === index ? { ...r, ...change } : r) });
  const updateArchive = (index: number, change: Partial<VoxProductionSettings['archives'][number]>) => setSettings({ ...settings, archives: settings.archives.map((r, i) => i === index ? { ...r, ...change } : r) });
  return <Dialog open title="自动制作设置" onOpenChange={open => { if (!open && !busy) onClose(); }} actions={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || !parsed.success || Boolean(error)} onClick={() => parsed.success && void onStart(parsed.data)}>{busy ? '准备中…' : '开始自动制作'}</Button></>}>
    <div className="director-batch-dialog vox-production-form">
      <SelectField label="制作预设" value={settings.presetId} options={VOX_PRODUCTION_PRESETS.map(p => ({ value: p.id, label: p.label }))} hint={preset.description} disabled={busy} onChange={(_, event) => setSettings({ ...settings, presetId: event.value as VoxProductionSettings['presetId'] })} />
      <p>影片类型：解释叙事 · 风格：{style?.cn ?? '自动匹配'} · {settings.authoring?.mode === 'ai-code' ? '模板打底，AI 按风格创作镜头；检查失败时稳定回退。' : '使用现有模板装配。'}</p>
      <CheckboxField label="自动生成旁白并按真实音频时长排字幕" checked={settings.narration} disabled={busy} onChange={(_, event) => setSettings({ ...settings, narration: event.checked === true })} />
      <p>使用系统设置中的文本、图片与配音模型。运行后可离开页面；暂停会等待当前请求保存。云端生成按已配置服务商计费。关闭旁白会移除未锁定镜头的旧人声。</p>
      {settings.presetId === 'data-map' ? <>
        <TextField label="数据单位" hint="例如 ℃、万元、%；所有数据使用同一单位。" value={settings.dataUnit ?? ''} disabled={busy} onChange={(_, event) => setSettings({ ...settings, dataUnit: event.value })} />
        <CheckboxField label="使用地点坐标绘制路线" checked={coordinates} disabled={busy} onChange={(_, event) => { const enabled = event.checked === true; setCoordinates(enabled); setSettings({ ...settings, data: settings.data.map(r => ({ ...r, lat: enabled ? 0 : undefined, lng: enabled ? 0 : undefined })) }); }} />
        {settings.data.map((r, i) => <fieldset key={i} className="vox-production-source-row"><legend>数据 {i + 1}</legend>
          <TextField label="名称" value={r.label} disabled={busy} onChange={(_, e) => updateRow(i, { label: e.value })} />
          <TextField label="数值" type="number" value={Number.isFinite(r.value) ? String(r.value) : ''} disabled={busy} onChange={(_, e) => updateRow(i, { value: e.value.trim() ? Number(e.value) : NaN })} />
          <TextField label="出处或链接" value={r.source} disabled={busy} onChange={(_, e) => updateRow(i, { source: e.value })} />
          {coordinates ? <><TextField label="纬度" type="number" value={String(r.lat ?? '')} disabled={busy} onChange={(_, e) => updateRow(i, { lat: e.value ? Number(e.value) : undefined })} /><TextField label="经度" type="number" value={String(r.lng ?? '')} disabled={busy} onChange={(_, e) => updateRow(i, { lng: e.value ? Number(e.value) : undefined })} /></> : null}
          <Button variant="subtle" disabled={busy} onClick={() => setSettings({ ...settings, data: settings.data.filter((_, j) => j !== i) })}>删除数据 {i + 1}</Button>
        </fieldset>)}
        <Button disabled={busy || settings.data.length >= (coordinates ? 24 : 12)} onClick={() => setSettings({ ...settings, data: [...settings.data, { label: '', value: 0, source: '', ...(coordinates ? { lat: 0, lng: 0 } : {}) }] })}>添加有来源的数据</Button>
      </> : null}
      {settings.presetId === 'archival-story' ? <>
        {settings.archives.map((r, i) => <fieldset key={i} className="vox-production-source-row"><legend>档案 {i + 1}</legend>
          <SelectField label="已导入的图片" value={r.assetVersionId} disabled={busy} options={[{ value: '', label: '请选择真实资料图片' }, ...images.map(a => ({ value: a.id, label: a.prompt?.slice(0, 60) || a.assetId }))]} onChange={(_, e) => updateArchive(i, { assetVersionId: e.value })} />
          <TextField label="资料出处" value={r.source} disabled={busy} onChange={(_, e) => updateArchive(i, { source: e.value })} />
          <TextField label="许可或使用说明" value={r.license} disabled={busy} onChange={(_, e) => updateArchive(i, { license: e.value })} />
          <Button variant="subtle" disabled={busy} onClick={() => setSettings({ ...settings, archives: settings.archives.filter((_, j) => j !== i) })}>删除档案 {i + 1}</Button>
        </fieldset>)}
        <Button disabled={busy || settings.archives.length >= 100} onClick={() => setSettings({ ...settings, archives: [...settings.archives, { assetVersionId: images[0]?.id ?? '', source: '', license: '' }] })}>添加档案引用</Button>
        {!images.length ? <p>请先在镜头高级设置中导入真实资料图片，再选择档案叙事。</p> : null}
      </> : null}
      <Button variant="subtle" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>高级：风格、创作方式与镜头锁定</Button>
      {advanced ? <section className="vox-creative-settings">
        <SelectField label="镜头创作方式" value={settings.authoring?.mode ?? 'template'} disabled={busy} options={[{ value: 'ai-code', label: 'AI 创作 · 模板打底与有界修复' }, { value: 'template', label: '模板装配 · 不调用代码模型' }]} onChange={(_, e) => setSettings({ ...settings, authoring: { mode: e.value as 'template' | 'ai-code', styleId: settings.authoring?.styleId ?? 'auto' } })} />
        <TextField label="搜索风格" value={query} placeholder="名称或用途，如数据、纸张、新闻" disabled={busy} onChange={(_, e) => setQuery(e.value)} />
        <SelectField label="风格分类" value={category} disabled={busy} options={[{ value: 'all', label: '全部分类' }, ...[...new Set(CREATIVE_STYLES.map(s => s.category_cn))].map(value => ({ value, label: value }))]} onChange={(_, e) => setCategory(e.value)} />
        <SelectField label="视觉风格" value={settings.authoring?.styleId ?? 'auto'} disabled={busy} hint="59 种资料已收录，6 种已适配；适配表示可进入生成链路，仍需逐片检查效果。" options={[{ value: 'auto', label: '自动匹配制作预设（推荐）' }, ...CREATIVE_STYLES.filter(s => filteredStyles.includes(s) || s.slug === settings.authoring?.styleId).map(s => ({ value: s.slug, label: `${s.cn} · ${s.readiness === 'adapted' ? '已适配' : '资料已收录 / 待适配'}`, disabled: !s.adapter }))]} onChange={(_, e) => setSettings({ ...settings, authoring: { mode: settings.authoring?.mode ?? 'ai-code', styleId: e.value } })} />
        <p>{style?.description} 可检索 {filteredStyles.length} / {CREATIVE_STYLES.length} 种。代码检查包含执行、布局与抽帧，不代表完成视觉审美审查。</p>
        <strong>保留自定义镜头</strong>
        {document.beats.flatMap(b => b.shots).map((shot, index) => <CheckboxField key={shot.id} label={`锁定 ${index + 1} · ${shot.title || shot.id}`} checked={settings.lockedShotIds.includes(shot.id)} disabled={busy} onChange={(_, event) => setSettings({ ...settings, lockedShotIds: event.checked ? [...settings.lockedShotIds, shot.id] : settings.lockedShotIds.filter(id => id !== shot.id) })} />)}
      </section> : null}
      <p role={error ? 'alert' : undefined}>{error || '依次执行：画面规划、素材与去底、配音、字幕排时、动画创作与检查、整片渲染和媒体检查。AI 代码每个镜头最多生成和修复各一次，按文本模型实际用量计费。'}</p>
    </div>
  </Dialog>;
}
