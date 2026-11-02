import { creativeStyleStatus } from '../../shared/creative-animation/status';
import { useEffect, useState } from 'react';
import { Button, CheckboxField, Dialog } from '../../ui';
import { AsyncActionFeedback } from '../../components/AsyncActionFeedback';
import type { AsyncActionFeedback as Feedback } from '../../ui/async-action';
import { voxProductionInputErrors, voxProductionSettings, voxProductionSettingsSchema, type VoxProductionSettings } from '../../shared/vox-production';
import type { EditorialCollagePipelineData } from '../../shared/editorial-collage';
import { CreativeProductionFields } from './CreativeProductionFields';
import { ProjectMusicFields } from './ProjectMusicFields';
import type { BgmItem } from '../../shared/types';
import type { StoryDreamApi } from '../../shared/storydream-api';

export function VoxProductionDialog({ document, open = true, busy, feedback, onClose, onStart, onSave, onApply, onOpenUrl, musicLibrary, api }: {
  document: EditorialCollagePipelineData; busy: boolean; onClose(): void;
  open?: boolean;
  feedback?: Feedback | null;
  onStart(settings: VoxProductionSettings): Promise<void>;
  onApply(settings: VoxProductionSettings): Promise<void>;
  onSave(settings: VoxProductionSettings): Promise<void>;
  onOpenUrl(url: string): Promise<void>;
  musicLibrary: readonly BgmItem[];
  api: Pick<StoryDreamApi, 'importBgmAudio'>;
}) {
  const [settings, setSettings] = useState(document.productionSettings ?? { ...voxProductionSettings(), authoring: { mode: 'ai-code' as const, styleId: 'auto' } });
  useEffect(() => {
    if (!open) setSettings(document.productionSettings ?? { ...voxProductionSettings(), authoring: { mode: 'ai-code', styleId: 'auto' } });
  }, [open, document.productionSettings]);
  const parsed = voxProductionSettingsSchema.safeParse(settings);
  const error = parsed.success ? voxProductionInputErrors(document, parsed.data).join(' ') : '请补齐名称、数值、来源和许可；坐标必须在有效范围内。';
  const nativeAuthoring = settings.authoring?.mode === 'ai-code';
  const shots = document.beats.flatMap(beat => beat.shots);
  const manualCode = shots.filter(shot => shot.animation && (shot.animation.mode === 'code' || shot.animation.code.source.trim()) && !shot.animation.authoring);
  const localError = parsed.success ? voxProductionInputErrors(document, { ...parsed.data, lockedShotIds: [...new Set([...parsed.data.lockedShotIds, ...manualCode.map(shot => shot.id)])] }).join(' ') : error;
  const applyUnavailable = document.productionRun?.status === 'running' ? '请先暂停自动制作，再应用镜头风格。' : document.productionRun?.nodes.some(node => node.status === 'unknown') ? '请先在制作进度中核对待确认的云端结果，再应用风格。' : localError;
  const visibleFeedback = busy ? null : error ? { tone: 'error' as const, message: error } : feedback ?? null;
  const protocolError = nativeAuthoring && visibleFeedback?.tone === 'error' && /LEMO_SDK_PROTOCOL|LEMO_CAPABILITY_|能力验证|(?:需要|选择)\s*Anthropic Messages/.test(visibleFeedback.message);
  return <Dialog open={open} title="自动制作设置" onOpenChange={open => { if (!open && !busy) onClose(); }} actions={<>
    {visibleFeedback ? <div className="vox-production-feedback">
      <AsyncActionFeedback feedback={visibleFeedback} />
      {protocolError ? <p className="vox-hint">请先保存设置，再在页面顶部“项目模型”中选择已通过 Lemo 能力验证的语言模型。可使用 Messages、Chat Completions 或 Responses；请到系统设置配置并验证同一模型。能力验证会调用所选服务商。</p> : null}
    </div> : null}
    <Button disabled={busy} onClick={onClose}>取消</Button>
    <Button disabled={busy || !parsed.success} disabledFocusable={busy} onClick={() => parsed.success && void onSave(parsed.data)}>保存设置</Button>
    {!nativeAuthoring && <Button disabled={busy || !parsed.success || Boolean(applyUnavailable)} disabledFocusable={busy} onClick={() => parsed.success && void onApply(parsed.data)}>应用风格到现有镜头</Button>}
    <Button variant="primary" aria-busy={busy} disabled={busy || !parsed.success || Boolean(error)} disabledFocusable={busy} onClick={() => parsed.success && void onStart(parsed.data)}>{busy ? '准备中…' : nativeAuthoring ? '按此风格创作全片' : '开始自动制作'}</Button>
  </>}>
    <div className="director-batch-dialog vox-production-form">
      <CreativeProductionFields settings={settings} onChange={setSettings} onOpenUrl={onOpenUrl} document={document} busy={busy} />
      <p className="vox-hint">{nativeAuthoring ? '保存设置只记录下一次制作的选择。点击“按此风格创作全片”，将用完整文案和所选风格重新编排画面、文字、材质与运动。已锁定镜头和手动代码会保留。' : '保存设置只记录下一次制作的选择。应用风格会更新现有镜头的构图、标题和运动，保留图片原材质；完整更新素材请开始自动制作。已锁定镜头和手动代码会保留。'}</p>
      {!nativeAuthoring && applyUnavailable && applyUnavailable !== error ? <p className="vox-hint" role="status">{applyUnavailable}</p> : null}
      <details className="vox-settings-disclosure"><summary>{nativeAuthoring ? '镜头实际风格与待创作状态' : '镜头实际风格与待应用状态'}</summary><ol>{shots.map((shot, index) => <li key={shot.id}>{shot.title || `镜头 ${index + 1}`} · {creativeStyleStatus(shot.animation, settings)}</li>)}</ol></details>
      <ProjectMusicFields value={settings.music} library={musicLibrary} api={api} busy={busy} onChange={music => setSettings({ ...settings, music })} />
      <details className="vox-settings-disclosure">
        <summary>保留指定镜头 · 已选 {settings.lockedShotIds.length} / {shots.length}</summary>
        <div className="vox-production-fields">
          <p className="vox-hint">保留选中镜头的画面、动画和旁白，其余镜头按当前设置重新制作。</p>
          {manualCode.length ? <Button disabled={busy} variant="secondary" onClick={() => setSettings({ ...settings, lockedShotIds: [...new Set([...settings.lockedShotIds, ...manualCode.map(shot => shot.id)])] })}>保留全部自定义代码镜头（{manualCode.length}）</Button> : null}
          {shots.map((shot, index) => <CheckboxField key={shot.id} label={`保留 ${index + 1} · ${shot.title || shot.id}`} checked={settings.lockedShotIds.includes(shot.id)} disabled={busy} onChange={(_, event) => setSettings({ ...settings, lockedShotIds: event.checked ? [...new Set([...settings.lockedShotIds, shot.id])] : settings.lockedShotIds.filter(id => id !== shot.id) })} />)}
        </div>
      </details>
      <p className="vox-hint">{nativeAuthoring ? 'Lemo 先完成创意大纲、素材规划和分段导演方案（每段最多 8 个镜头），校验后再准备素材、创作并检查连续影片。每步独立保存方案、源码与回执，成功步骤可复用；网络中断且结果不明的请求需先核对。' : 'Vox 使用现有文本、图片与配音模型，按已选素材流程制作独立图层。'}云端生成按服务商计费。应用保持打开时可离开页面继续制作。</p>
    </div>
  </Dialog>;
}
