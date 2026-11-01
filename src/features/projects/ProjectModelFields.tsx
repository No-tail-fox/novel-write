import { useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { AppConfig, AppMutationResult, ProjectModels, Task, ProjectActivity } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { defaultProjectModels, projectRuntimeConfig, validateProjectModels } from '../../shared/project-models';
import { Button, Dialog, SelectField } from '../../ui';
import '../../styles/features/project-models.css';

type ModelProject = Pick<Task, 'id' | 'title' | 'status' | 'archivedAt' | 'llmProfileId' | 'projectModels'> & { projectActivity?: ProjectActivity };

export function ProjectModelFields({ config, value, onChange, disabled = false }: {
  config: AppConfig; value: ProjectModels; onChange: (value: ProjectModels) => void; disabled?: boolean;
}) {
  const missing = (id: string, options: { value: string; label: string }[]) =>
    options.some(option => option.value === id) ? options : [{ value: id, label: '配置已删除，请重新选择' }, ...options];
  const languages = config.llmProfiles.map(profile => ({ value: profile.id!, label: `${profile.name || profile.model} · ${profile.model}` }));
  const images = config.imageProfiles.map(profile => ({ value: profile.id!, label: `${profile.name} · ${profile.provider === 'gpt_image' ? profile.gptImage?.model : profile.provider === 'custom' ? profile.customImage?.model : profile.provider}` }));
  const videos = config.video.providers.map(profile => ({ value: profile.id!, label: `${profile.name} · ${profile.model}` }));
  return <section className="project-model-fields" aria-label="项目模型选择">
    <p>每个项目固定一组模型，所有创作步骤统一使用。全局默认模型的变化不会影响已创建的项目。</p>
    <div className="project-model-grid">
      <SelectField label="语言模型" value={value.llmProfileId} disabled={disabled} options={missing(value.llmProfileId, languages)} onChange={(_, data) => onChange({ ...value, llmProfileId: data.value })} />
      <SelectField label="生图模型" value={value.imageProfileId} disabled={disabled} options={missing(value.imageProfileId, images)} onChange={(_, data) => onChange({ ...value, imageProfileId: data.value })} />
      <SelectField label="视频模型" value={value.videoProviderId ?? ''} disabled={disabled} options={[{ value: '', label: '不使用视频模型' }, ...missing(value.videoProviderId ?? '', [{ value: '', label: '' }, ...videos]).filter(option => option.value)]} onChange={(_, data) => onChange({ ...value, videoProviderId: data.value || null })} />
    </div>
  </section>;
}

export function ProjectModelsDialog({ task, config, api, onUpdated, onClose }: {
  task: ModelProject; config: AppConfig; api: StoryDreamApi; onUpdated: (result: AppMutationResult) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(() => task.projectModels ?? defaultProjectModels(config, task.llmProfileId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = Boolean(task.archivedAt || task.status === 'running' || task.status === 'paused' || task.projectActivity?.status === 'running' || task.projectActivity?.status === 'pending');
  async function saveModels() {
    setError(''); setBusy(true);
    try { validateProjectModels(config, value); onUpdated(await api.setProjectModels(task.id, value)); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <Dialog open title={`项目模型 · ${task.title || '未命名项目'}`} onOpenChange={open => { if (!open && !busy) onClose(); }}
    actions={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || locked} onClick={() => void saveModels()}>{busy ? '保存中…' : '保存项目模型'}</Button></>}>
    <ProjectModelFields config={config} value={value} onChange={setValue} disabled={busy || locked} />
    <p className="project-model-note">修改后，后续生成统一使用新选择；已有素材会保留。渠道地址、密钥及模型参数在系统设置中管理。</p>
    {locked ? <p role="status">项目正在生成、暂停中或已归档，当前仅可查看模型。</p> : null}
    {error ? <p role="alert" className="project-model-error">{error}</p> : null}
  </Dialog>;
}

export function ProjectModelBar({ task, config, api, onUpdated, disabled }: {
  task?: ModelProject; config: AppConfig; api: StoryDreamApi; onUpdated: (result: AppMutationResult) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!task) return null;
  const models = task.projectModels;
  const language = config.llmProfiles.find(profile => profile.id === models?.llmProfileId);
  const image = config.imageProfiles.find(profile => profile.id === models?.imageProfileId);
  const video = config.video.providers.find(profile => profile.id === models?.videoProviderId);
  return <div className="project-model-bar">
    <Button density="compact" variant="subtle" icon={<Settings2 size={14} />} disabled={disabled} onClick={() => setOpen(true)}>项目模型</Button>
    <span title="此项目所有创作步骤统一使用">语言：{language?.name || language?.model || '配置缺失'}　生图：{image?.name || '配置缺失'}　视频：{models?.videoProviderId ? video?.name || '配置缺失' : '未选择'}</span>
    {open ? <ProjectModelsDialog key={task.id} task={task} config={config} api={api} onUpdated={onUpdated} onClose={() => setOpen(false)} /> : null}
  </div>;
}

/** Resolve the public UI view from the same project selection used by the main process. */
export function useProjectModelConfig(config: AppConfig, models: ProjectModels) {
  return useMemo(() => {
    try { return projectRuntimeConfig(config, models); }
    catch {
      // Missing profiles are reported by project settings and by the authoritative runtime.
      return { ...config, activeLlmProfileId: models.llmProfileId, activeImageProfileId: models.imageProfileId,
        imageProfiles: config.imageProfiles.filter(profile => profile.id === models.imageProfileId),
        video: { ...config.video, activeProviderId: models.videoProviderId ?? '', providers: [] } };
    }
  }, [config, models]);
}
