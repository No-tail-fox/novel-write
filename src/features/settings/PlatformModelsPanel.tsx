import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import type { AppConfig } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { capabilities, formatCredits, type CommercialModelProfile, type CommercialProfiles, type CommercialSnapshot, type ModelCapability } from '../../shared/commercial-contract';
import { Button, Dialog, SelectField, Tabs, TextField } from '../../ui';
import { capabilityLabels, CommercialBoundary, CommercialNotice } from '../account/commercial-ui';
import { notifyCommercialChanged, useCommercialSnapshot } from '../account/useCommercialSnapshot';
import { useCommercialAction } from '../account/useCommercialAction';
import { getCommercialStore } from '../account/commercial-store';

export interface LocalModelChoice { id: string; name: string; model: string }
export function localModelChoices(config: AppConfig, capability: ModelCapability): LocalModelChoice[] {
  const valid = (items: { id?: string; name?: string; model?: string }[]) => items.filter((item) => Boolean(item.id)).map((item) => ({ id: item.id!, name: item.name || item.id!, model: item.model || '' }));
  switch (capability) {
    case 'text': return valid(config.llmProfiles);
    case 'image': return valid(config.imageProfiles.map((item) => ({ id: item.id, name: item.name, model: item.provider === 'gpt_image' ? item.gptImage?.model : item.provider === 'jimeng' ? item.jimeng?.model : item.customImage?.model })));
    case 'video': return valid(config.video.providers);
    case 'music': return valid(config.music.profiles);
    case 'tts': return valid(config.ttsProfiles.map((item) => ({ id: item.id, name: item.name, model: item.provider === 'minimax' ? item.minimax?.model : 'volcengine' })));
    case 'speechToText': return valid(config.speechToTextProfiles);
    case 'vision': return valid(config.viral.visionProfiles);
  }
}

export function PlatformModelsPanel({ api, config, capability }: { api: StoryDreamApi; config: AppConfig; capability?: ModelCapability }) {
  const view = useCommercialSnapshot(api);
  const [selectedCapability, setSelectedCapability] = useState<ModelCapability>(capability || 'text');
  useEffect(() => { if (capability) setSelectedCapability(capability); }, [capability]);
  return <section className="commercial-page" aria-label="平台模型与调用来源"><header className="commercial-heading"><div><h2>模型来源与多配置</h2><p>每类可保存多套配置，明确启用调用偏好。实际生效范围见下方入口说明。</p></div><Button density="compact" disabled={view.loading} icon={<RefreshCw size={15} />} onClick={() => void view.refresh()}>刷新目录</Button></header><CommercialBoundary {...view} onRetry={() => void view.refresh()}>
    {!capability && <Tabs className="commercial-tabs" label="模型能力" value={selectedCapability} onChange={(value) => setSelectedCapability(value as ModelCapability)} items={capabilities.map((item) => ({ value: item, label: capabilityLabels[item] }))} />}
    {view.snapshot?.authenticated && <ProfileEditor key={`${view.snapshot.user?.id}:${selectedCapability}`} api={api} config={config} capability={selectedCapability} snapshot={view.snapshot} />}
  </CommercialBoundary></section>;
}

function ProfileEditor({ api, config, capability, snapshot }: { api: StoryDreamApi; config: AppConfig; capability: ModelCapability; snapshot: CommercialSnapshot }) {
  const profiles = snapshot.profiles.profiles.filter((profile) => profile.capability === capability);
  const activeId = snapshot.profiles.active[capability];
  const catalog = snapshot.catalog.filter((model) => model.capability === capability);
  const locals = useMemo(() => localModelChoices(config, capability), [config, capability]);
  const newDraft = (): CommercialModelProfile => ({ id: crypto.randomUUID(), name: '', capability, source: 'platform', modelId: catalog.find((model) => model.status === 'available')?.id || '' });
  const initial = profiles.find((profile) => profile.id === activeId) || profiles[0];
  const [draft, setDraft] = useState<CommercialModelProfile>(() => initial ? { ...initial } : newDraft());
  const [activateTarget, setActivateTarget] = useState<CommercialModelProfile | null>(null);
  const [pendingDraft, setPendingDraft] = useState<CommercialModelProfile | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [checkMessage, setCheckMessage] = useState('');
  const action = useCommercialAction(api);
  const saved = profiles.find((profile) => profile.id === draft.id);
  const dirty = !saved || JSON.stringify(saved) !== JSON.stringify(draft);
  const editingActive = Boolean(saved) && saved?.id === activeId && dirty;
  const selectedModel = catalog.find((model) => model.id === draft.modelId);
  const valid = Boolean(draft.name.trim() && (draft.source === 'platform' ? selectedModel : locals.some((item) => item.id === draft.localProfileId)));
  function commitProfiles(next: CommercialProfiles) {
    const current = getCommercialStore(api.commercial).getState().snapshot;
    if (current && current.user?.id === snapshot.user?.id) notifyCommercialChanged(api, { ...current, profiles: next });
  }
  function select(profile: CommercialModelProfile) { setDraft({ ...profile }); setCheckMessage(''); action.clear(); }
  function requestSelect(profile: CommercialModelProfile) {
    if (profile.id === draft.id) return;
    if (dirty && (Boolean(saved) || Boolean(draft.name.trim()) || Boolean(draft.localProfileId))) setPendingDraft(profile);
    else select(profile);
  }
  function save() {
    const next = { ...draft, name: draft.name.trim(), ...(editingActive ? { id: crypto.randomUUID() } : {}) };
    void action.run(() => api.commercial.saveModelProfile(next), (result) => { commitProfiles(result); setDraft(next); }, editingActive ? '已保存为备用配置，当前启用项保持原设置。' : '配置已保存；点击启用后才会切换。');
  }
  function check() {
    setCheckMessage('');
    void action.run(() => api.commercial.getSnapshot(), (next) => {
      notifyCommercialChanged(api, next);
      if (draft.source === 'byok') setCheckMessage(locals.some((item) => item.id === draft.localProfileId) ? '本机配置引用有效。服务连通性请在对应自有 API 配置页测试；本次未生成内容或扣积分。' : '该本机配置已不存在，请重新选择。');
      else { const model = next.catalog.find((item) => item.id === draft.modelId && item.capability === capability); setCheckMessage(model?.status === 'available' ? '平台目录显示该模型可用。本次仅检查目录，未生成内容或扣积分。' : '当前目录中此模型不可用，请选择其他模型。'); }
    });
  }
  return <>
    <p className="commercial-muted">{capability === 'music' ? '已接入入口：音乐创作的普通生成。其他音乐操作以各入口的来源提示为准。' : '此能力当前可管理账号调用偏好；对应创作入口尚未接入统一平台计费，启用偏好不会改变旧工作流的调用路径。'}</p>
    <CommercialNotice>{activeId ? `当前启用：${profiles.find((profile) => profile.id === activeId)?.name || '已保存配置'}` : '尚未为此账号选择来源。使用自有 API 前，请明确关联允许此账号使用的本机配置'}。平台模型按积分计费，自有 API 由你的服务商收费。</CommercialNotice>
    <div className="commercial-model-layout"><div className="commercial-model-list"><div className="commercial-section-heading"><h3>{capabilityLabels[capability]}配置</h3><Button density="compact" icon={<Plus size={14} />} disabled={action.busy} onClick={() => requestSelect(newDraft())}>新增</Button></div>{profiles.length ? profiles.map((profile) => <Button className="commercial-model-choice" key={profile.id} aria-pressed={draft.id === profile.id} disabled={action.busy} onClick={() => requestSelect(profile)}><strong>{profile.name} {activeId === profile.id ? '· 已启用' : ''}</strong><small>{profile.source === 'platform' ? '平台积分' : '自有 API'} · {profile.source === 'platform' ? catalog.find((model) => model.id === profile.modelId)?.name || profile.modelId : locals.find((item) => item.id === profile.localProfileId)?.name || '本机配置不可用'}</small></Button>) : <p className="commercial-muted">还没有关联到此账号的配置。添加平台模型或选择本机自有 API。</p>}</div>
    <form className="commercial-form" onSubmit={(event) => { event.preventDefault(); save(); }}><h3>{saved ? '编辑配置' : '添加备用配置'}</h3><TextField label="配置名称" value={draft.name} maxLength={100} disabled={action.busy} onChange={(_, data) => setDraft({ ...draft, name: data.value })} /><SelectField label="调用来源" value={draft.source} disabled={action.busy} options={[{ value: 'platform', label: '平台模型 · 使用积分' }, { value: 'byok', label: '自有 API · 使用本机配置' }]} onChange={(_, data) => { const source = data.value as 'platform' | 'byok'; setDraft({ ...draft, source, modelId: source === 'platform' ? catalog.find((model) => model.status === 'available')?.id || '' : locals[0]?.model || '', localProfileId: source === 'byok' ? locals[0]?.id : undefined }); setCheckMessage(''); }} />
      {draft.source === 'platform' ? <><SelectField label="平台模型" disabled={action.busy} value={draft.modelId} options={[{ value: '', label: '请选择模型' }, ...catalog.map((model) => ({ value: model.id, label: `${model.name} · ${formatCredits(model.priceUnits)} 积分 / ${model.unit}${model.status !== 'available' ? ' · 暂不可用' : ''}` }))]} onChange={(_, data) => { setDraft({ ...draft, modelId: data.value }); setCheckMessage(''); }} />{selectedModel ? <p className="commercial-muted">{selectedModel.description} · 目录版本 {selectedModel.version}。任务提交前按实际参数确认报价。</p> : <p className="commercial-muted">此能力暂无可选择的平台模型，请刷新目录或关联自有 API。</p>}</> : <><SelectField label="本机自有 API 配置" value={draft.localProfileId || ''} disabled={action.busy} options={[{ value: '', label: '请选择已有配置' }, ...locals.map((item) => ({ value: item.id, label: `${item.name}${item.model ? ` · ${item.model}` : ''}` }))]} onChange={(_, data) => { const local = locals.find((item) => item.id === data.value); setDraft({ ...draft, localProfileId: data.value, modelId: local?.model || '' }); setCheckMessage(''); }} /><p className="commercial-muted">仅关联本机配置 ID，不上传密钥。关联前确认这份本机配置允许当前账号使用。编辑地址、密钥或测试连通性请前往对应模型的自有 API 设置。</p></>}
      {editingActive && <CommercialNotice>正在修改启用中的配置。保存会生成备用项，需要再次明确启用才能影响后续请求。</CommercialNotice>}
      <div className="commercial-actions"><Button type="submit" variant="primary" icon={<Save size={15} />} disabled={action.busy || !valid || !dirty}>{editingActive ? '保存为备用配置' : '保存配置'}</Button><Button type="button" disabled={action.busy || !valid} onClick={check}>检查可用性</Button></div>
      <div className="commercial-actions"><Button type="button" icon={<CheckCircle2 size={15} />} disabled={action.busy || !saved || dirty || activeId === draft.id || (draft.source === 'platform' && selectedModel?.status !== 'available')} onClick={() => setActivateTarget(saved!)}>{activeId === draft.id && !dirty ? '当前已启用' : '启用此配置'}</Button><Button type="button" icon={<Trash2 size={15} />} disabled={action.busy || !saved || activeId === draft.id} onClick={() => setDeleteOpen(true)}>删除备用项</Button></div>
      {dirty && saved && <p className="commercial-muted">有未保存的修改，保存后才能启用。</p>}{checkMessage && <CommercialNotice>{checkMessage}</CommercialNotice>}{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}{action.message && <p role="status" className="commercial-muted">{action.message}</p>}
    </form></div>
    <Dialog open={Boolean(pendingDraft)} onOpenChange={(open) => { if (!open) setPendingDraft(null); }} title="放弃未保存的配置修改？" actions={<><Button onClick={() => setPendingDraft(null)}>继续编辑</Button><Button variant="danger" onClick={() => { if (pendingDraft) select(pendingDraft); setPendingDraft(null); }}>放弃修改并切换</Button></>}><p>当前配置有未保存的修改。可先返回编辑并保存备用项，再切换选择。</p></Dialog>
    <Dialog open={Boolean(activateTarget)} onOpenChange={(open) => { if (!action.busy && !open) setActivateTarget(null); }} title="启用当前账号的模型来源？" actions={<><Button disabled={action.busy} onClick={() => setActivateTarget(null)}>取消</Button><Button variant="primary" disabled={action.busy || !activateTarget} onClick={() => { if (activateTarget) void action.run(() => api.commercial.activateModelProfile(activateTarget.id), (result) => { commitProfiles(result); setActivateTarget(null); }, '账号调用偏好已启用；已接入的创作入口使用此来源。'); }}>确认启用</Button></>}><p>{activateTarget?.name}：{activateTarget?.source === 'platform' ? '已接入的平台入口会先显示报价，再预留和结算账号积分。' : '已接入的入口使用关联本机配置时，由对应 API 服务商收取费用。'} 旧版创作流程尚未全面接入，启用此偏好不会改写未接入入口的调用路径。已提交的任务保持原来源。</p>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
    <Dialog open={deleteOpen} onOpenChange={(open) => { if (!action.busy) setDeleteOpen(open); }} title="删除备用配置？" actions={<><Button disabled={action.busy} onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" disabled={action.busy || !saved} onClick={() => void action.run(() => api.commercial.deleteModelProfile(draft.id), (result) => { commitProfiles(result); setDraft(newDraft()); setDeleteOpen(false); }, '备用配置已删除。')}>删除备用项</Button></>}><p>删除当前账号关联的“{draft.name}”。关联的本机 API 配置与密钥保留。</p>{action.error && <CommercialNotice error>{action.error}</CommercialNotice>}</Dialog>
  </>;
}
