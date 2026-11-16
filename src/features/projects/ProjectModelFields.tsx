import { useMemo, useState } from 'react';
import { Settings2 } from 'lucide-react';
import type { AppConfig, AppMutationResult, ProjectModels, Task, ProjectActivity } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { defaultProjectModels, projectRuntimeConfig, validateProjectModels } from '../../shared/project-models';
import { Button, Dialog, SelectField } from '../../ui';
import { MOTION_COMIC_TASK_TYPE } from '../../shared/motion-comic';
import { recommendProductionRoute, type ProductionRouteKind } from '../../shared/model-capabilities';
import '../../styles/features/project-models.css';

type ModelProject = Pick<Task, 'id' | 'title' | 'status' | 'archivedAt' | 'llmProfileId' | 'projectModels'> & { projectActivity?: ProjectActivity; taskType?: Task['taskType'] };

function modelsLocked(task: ModelProject, disabled = false) {
  return Boolean(task.archivedAt || (task.taskType !== MOTION_COMIC_TASK_TYPE && (disabled || task.status === 'running' || task.status === 'paused' || task.projectActivity?.status === 'running' || task.projectActivity?.status === 'pending')));
}

export function ProjectModelFields({ config, value, onChange, disabled = false, route }: {
  config: AppConfig; value: ProjectModels; onChange: (value: ProjectModels) => void; disabled?: boolean;
  /** U-6: when set, warn (never block) if the chosen language model is too weak for this route. */
  route?: ProductionRouteKind;
}) {
  const missing = (id: string, options: { value: string; label: string }[]) =>
    options.some(option => option.value === id) ? options : [{ value: id, label: '配置已删除，请重新选择' }, ...options];
  const languages = config.llmProfiles.map(profile => ({ value: profile.id!, label: `${profile.name || profile.model} · ${profile.model}` }));
  const images = config.imageProfiles.map(profile => ({ value: profile.id!, label: `${profile.name} · ${profile.provider === 'gpt_image' ? profile.gptImage?.model : profile.provider === 'custom' ? profile.customImage?.model : profile.provider}` }));
  const videos = config.video.providers.map(profile => ({ value: profile.id!, label: `${profile.name} · ${profile.model}` }));
  return <section className="project-model-fields" aria-label="项目模型选择">
    <p>每个项目固定一组模型，所有创作步骤统一使用。全局默认模型的变化不会影响已创建的项目。</p>
    <div className="project-model-grid">
      <SelectField label="LLM 模型" value={value.llmProfileId} disabled={disabled} options={missing(value.llmProfileId, languages)} onChange={(_, data) => onChange({ ...value, llmProfileId: data.value })} />
      <SelectField label="生图模型" value={value.imageProfileId} disabled={disabled} options={missing(value.imageProfileId, images)} onChange={(_, data) => onChange({ ...value, imageProfileId: data.value })} />
      <SelectField label="视频模型" value={value.videoProviderId ?? ''} disabled={disabled} options={[{ value: '', label: '不使用视频模型' }, ...missing(value.videoProviderId ?? '', [{ value: '', label: '' }, ...videos]).filter(option => option.value)]} onChange={(_, data) => onChange({ ...value, videoProviderId: data.value || null })} />
    </div>
    {route ? <RouteFitHint config={config} llmProfileId={value.llmProfileId} route={route} /> : null}
  </section>;
}

function RouteFitHint({ config, llmProfileId, route }: { config: AppConfig; llmProfileId: string; route: ProductionRouteKind }) {
  const model = config.llmProfiles.find(profile => profile.id === llmProfileId)?.model ?? '';
  const fit = model ? recommendProductionRoute(model, route) : null;
  return fit?.warning ? <p className="project-model-route-hint" role="note">{fit.warning}</p> : null;
}

export function ProjectModelsDialog({ task, config, api, onUpdated, onClose, editingLocked = false }: {
  task: ModelProject; config: AppConfig; api: StoryDreamApi; onUpdated: (result: AppMutationResult) => void; onClose: () => void; editingLocked?: boolean;
}) {
  const [value, setValue] = useState(() => task.projectModels ?? defaultProjectModels(config, task.llmProfileId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locked = modelsLocked(task, editingLocked);
  async function saveModels() {
    if (locked || busy) return;
    setError(''); setBusy(true);
    try { validateProjectModels(config, value); onUpdated(await api.setProjectModels(task.id, value)); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <Dialog open title={`项目模型 · ${task.title || '未命名项目'}`} onOpenChange={open => { if (!open && !busy) onClose(); }}
    actions={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" disabled={busy || locked} onClick={() => void saveModels()}>{busy ? '保存中…' : '保存项目模型'}</Button></>}>
    <ProjectModelFields config={config} value={value} onChange={setValue} disabled={busy || locked} />
    <p className="project-model-note">修改只影响之后新提交的任务，不改变已发送请求或已有素材。渠道地址、密钥及模型参数在系统设置中管理。</p>
    {locked ? <p role="status">项目有运行、排队或暂停任务，或已归档，当前仅可查看模型。暂停任务不会解除模型锁定。</p> : null}
    {error ? <p role="alert" className="project-model-error">{error}</p> : null}
  </Dialog>;
}

export function ProjectModelBar({ task, config, api, onUpdated, disabled, compact = false, inline = false, confirmLlmChange }: {
  task?: ModelProject; config: AppConfig; api: StoryDreamApi; onUpdated: (result: AppMutationResult) => void; disabled?: boolean;
  /** Header placement: one button; the model summary moves to its tooltip. */
  compact?: boolean;
  /** Header placement: three direct selects that save on change (no dialog). */
  inline?: boolean;
  /** Optional gate: return false to abort an inline LLM change after the caller showed its own confirmation. */
  confirmLlmChange?: (nextProfileId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  if (!task) return null;
  if (inline) return <ProjectModelInline key={task.id} task={task} config={config} api={api} onUpdated={onUpdated} disabled={disabled} confirmLlmChange={confirmLlmChange} />;
  const models = task.projectModels;
  const language = config.llmProfiles.find(profile => profile.id === models?.llmProfileId);
  const image = config.imageProfiles.find(profile => profile.id === models?.imageProfileId);
  const video = config.video.providers.find(profile => profile.id === models?.videoProviderId);
  const summary = `LLM：${language?.name || language?.model || '配置缺失'}　生图：${image?.name || '配置缺失'}　视频：${models?.videoProviderId ? video?.name || '配置缺失' : '未选择'}`;
  return <div className={compact ? 'project-model-bar is-compact' : 'project-model-bar'}>
    <Button density="compact" variant="subtle" icon={<Settings2 size={14} />} title={compact ? `${summary}${disabled ? '（有任务进行中，仅可查看）' : ''}` : undefined} onClick={() => setOpen(true)}>项目模型</Button>
    {compact ? null : <span title="此项目所有创作步骤统一使用">{summary}</span>}
    {open ? <ProjectModelsDialog key={task.id} task={task} config={config} api={api} onUpdated={onUpdated} editingLocked={disabled} onClose={() => setOpen(false)} /> : null}
  </div>;
}

/** Direct per-project model choice. Each change is validated and saved immediately; it only
 * applies to tasks submitted afterwards. Comic defaults remain editable during background work. */
function ProjectModelInline({ task, config, api, onUpdated, disabled, confirmLlmChange }: {
  task: ModelProject; config: AppConfig; api: StoryDreamApi; onUpdated: (result: AppMutationResult) => void; disabled?: boolean;
  confirmLlmChange?: (nextProfileId: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const value = task.projectModels ?? defaultProjectModels(config, task.llmProfileId);
  const locked = modelsLocked(task, disabled);
  const missing = (id: string, options: { value: string; label: string }[]) =>
    !id || options.some(option => option.value === id) ? options : [{ value: id, label: '配置已删除' }, ...options];
  const languages = missing(value.llmProfileId, config.llmProfiles.map(profile => ({ value: profile.id!, label: profile.name || profile.model })));
  const images = missing(value.imageProfileId, config.imageProfiles.map(profile => ({ value: profile.id!, label: profile.name || profile.provider })));
  const videos = [{ value: '', label: '不使用' }, ...missing(value.videoProviderId ?? '', config.video.providers.map(profile => ({ value: profile.id!, label: profile.name || profile.model })))];
  async function change(next: ProjectModels, label: string) {
    if (locked || busy) return;
    // Ask before persisting an LLM change so the caller can explain downstream effects.
    if (confirmLlmChange && next.llmProfileId !== value.llmProfileId && !(await confirmLlmChange(next.llmProfileId))) return;
    setError(''); setSaved(''); setBusy(true);
    try { validateProjectModels(config, next); onUpdated(await api.setProjectModels(task.id, next)); setSaved(`${label}已切换，仅影响之后提交的任务`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const lockReason = locked ? '项目有运行、排队或暂停任务，或已归档，当前仅可查看模型' : '';
  const field = (key: 'llm' | 'image' | 'video', label: string, current: string, options: { value: string; label: string }[], apply: (id: string) => ProjectModels) =>
    <div className="project-model-inline__field" data-model={key} title={lockReason || `${label}模型：${options.find(option => option.value === current)?.label ?? '未选择'}`}>
      <SelectField label={label} aria-label={`${label}模型`} value={current} options={options} disabled={locked || busy} onChange={(_, data) => void change(apply(data.value), `${label}模型`)} />
    </div>;
  return <div className="project-model-inline" role="group" aria-label="项目模型" aria-busy={busy || undefined} data-locked={locked || undefined}>
    {field('llm', 'LLM', value.llmProfileId, languages, id => ({ ...value, llmProfileId: id }))}
    {field('image', '生图', value.imageProfileId, images, id => ({ ...value, imageProfileId: id }))}
    {field('video', '视频', value.videoProviderId ?? '', videos, id => ({ ...value, videoProviderId: id || null }))}
    {error ? <span className="project-model-inline__error" role="alert" title={error}>{error}</span> : saved ? <span className="project-model-inline__status" role="status" title={saved}>已切换</span> : null}
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
