import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Film,
  Layers3,
  Loader2,
  MapPin,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  WandSparkles,
} from 'lucide-react';
import type { MotionComicPlanResult, MotionComicPlanRecovery, MotionComicScriptFailure, MotionComicScriptDraft, MotionComicScriptBeat } from '../../shared/motion-comic-planning';
import { Button, CheckboxField, Dialog, SelectField, TextAreaField, TextField } from '../../ui';
import { beatSelection, speakerOptions, updateFailedBeat } from './motion-comic-script-repair';
import '../../styles/features/motion-comic.css';
import { MotionComicScriptReview } from './MotionComicScriptReview';

export interface MotionComicPlanDialogProps {
  open: boolean;
  sourceText: string;
  instructions: string;
  targetDurationSec: string;
  episodeNumber: number;
  result: MotionComicPlanResult | null;
  recovery?: MotionComicPlanRecovery | null;
  scriptFailure?: MotionComicScriptFailure | null;
  busy: boolean;
  applying: boolean;
  applyingMode: 'append' | 'replace';
  canReplaceStarter: boolean;
  replaceStarterByDefault?: boolean;
  canCreateBlankEpisode?: boolean;
  errorMessage?: string;
  onOpenChange: (open: boolean) => void;
  onSourceTextChange: (value: string) => void;
  onInstructionsChange: (value: string) => void;
  onTargetDurationSecChange: (value: string) => void;
  onGenerate: () => void;
  onResume?: () => void;
  onReviewScriptChange?: (draft: MotionComicScriptDraft) => void;
  onRepairScript?: (draft: MotionComicScriptDraft) => void;
  onScriptDraftChange: (draft: MotionComicScriptDraft) => void;
  onApply: (reviewedAdjustments: boolean) => void;
  onReplaceStarter: (reviewedAdjustments: boolean) => void;
  onEdit: () => void;
  onEditScript?: () => void;
  onCreateBlankEpisode: () => void;
}

export function MotionComicPlanDialog({
  open,
  sourceText,
  instructions,
  targetDurationSec,
  episodeNumber,
  result,
  recovery,
  scriptFailure,
  busy,
  applying,
  applyingMode,
  canReplaceStarter,
  replaceStarterByDefault = false,
  canCreateBlankEpisode = true,
  errorMessage,
  onOpenChange,
  onSourceTextChange,
  onInstructionsChange,
  onTargetDurationSecChange,
  onGenerate,
  onResume,
  onReviewScriptChange,
  onRepairScript,
  onScriptDraftChange,
  onApply,
  onReplaceStarter,
  onEdit,
  onEditScript,
  onCreateBlankEpisode,
}: MotionComicPlanDialogProps) {
  const [reviewedScript, setReviewedScript] = useState(false);
  useEffect(() => { setReviewedScript(false); }, [recovery]);
  const [selectedSceneKey, setSelectedSceneKey] = useState('');
  const [reviewedAdjustments, setReviewedAdjustments] = useState(false);
  const scriptDraft = scriptFailure?.draft ?? null;
  const [reviewTab, setReviewTab] = useState<'shots' | 'adjustments'>('shots');
  const plan = result?.plan;
  const adjustments = plan?.adjustments ?? [];
  useEffect(() => { setReviewedAdjustments(false); setReviewTab(plan?.adjustments?.length ? 'adjustments' : 'shots'); }, [plan]);

  const scenes = plan?.script.scenes ?? [];

  useEffect(() => {
    if (!plan) {
      setSelectedSceneKey('');
      return;
    }
    setSelectedSceneKey((current) => scenes.some((scene) => scene.key === current) ? current : scenes[0]?.key ?? '');
  }, [plan, scenes]);

  const selectedScene = useMemo(
    () => scenes.find((scene) => scene.key === selectedSceneKey) ?? scenes[0],
    [scenes, selectedSceneKey],
  );
  const selectedShots = selectedScene ? plan?.shots.filter((shot) => shot.sceneKey === selectedScene.key) ?? [] : [];
  const previewReady = Boolean(result && plan && scenes.length > 0);
  const repairReady = Boolean(scriptFailure && scriptDraft);
  const locked = busy || applying;
  const hasManualEdits = adjustments.some((item) => item.kind === 'manual');
  const adjustmentHeading = hasManualEdits ? '整理与修改记录' : '自动整理与补齐';
  const applyLocked = locked || (adjustments.length > 0 && !reviewedAdjustments);
  const sourceLength = sourceText.trim().length;
  const targetDuration = targetDurationSec.trim() ? Number(targetDurationSec) : undefined;
  const targetDurationInvalid = targetDuration !== undefined && (!Number.isFinite(targetDuration) || targetDuration < 5 || targetDuration > 1_800);

  const reviewTextInvalid = Boolean(recovery?.script.scenes.some((scene) => scene.beats.some((beat) => !beat.text.trim())));
  const actions = previewReady ? <>
    {recovery && onEditScript ? <Button variant="subtle" disabled={locked} onClick={onEditScript}>返回修改剧本</Button> : null}
    <Button type="button" variant="subtle" icon={<ArrowLeft size={14} />} disabled={locked} onClick={onEdit}>修改原文</Button>
    <Button type="button" variant="secondary" icon={busy ? <Loader2 className="director-spin" size={14} /> : <RefreshCw size={14} />} disabled={locked} onClick={onGenerate}>{busy ? '正在重新规划' : '重新规划'}</Button>
    {canReplaceStarter && !replaceStarterByDefault ? <Button type="button" variant="secondary" icon={applying && applyingMode === 'replace' ? <Loader2 className="director-spin" size={14} /> : <ShieldCheck size={14} />} disabled={applyLocked} onClick={() => onReplaceStarter(reviewedAdjustments)}>{applying && applyingMode === 'replace' ? '正在替换默认模板' : '替换默认空模板'}</Button> : null}
    {replaceStarterByDefault ? <Button type="button" variant="primary" icon={applying && applyingMode === 'replace' ? <Loader2 className="director-spin" size={14} /> : <ShieldCheck size={14} />} disabled={applyLocked} onClick={() => onReplaceStarter(reviewedAdjustments)}>{applying && applyingMode === 'replace' ? '正在写入首集' : `确认并写入第 ${episodeNumber} 集`}</Button>
      : <Button type="button" variant="primary" icon={applying && applyingMode === 'append' ? <Loader2 className="director-spin" size={14} /> : <Plus size={14} />} disabled={applyLocked} onClick={() => onApply(reviewedAdjustments)}>{applying && applyingMode === 'append' ? '正在追加新集' : `追加为第 ${episodeNumber} 集`}</Button>}
  </> : <>
    {canCreateBlankEpisode && !recovery ? <Button type="button" variant="subtle" disabled={locked} onClick={onCreateBlankEpisode}>追加空白集</Button> : null}
    <Button type="button" variant="secondary" disabled={locked} onClick={() => onOpenChange(false)}>取消</Button>
    {recovery && onResume ? <Button type="button" variant="primary" disabled={locked || reviewTextInvalid || (!recovery.needsValidation && !reviewedScript)} onClick={onResume}>{busy ? '正在处理' : recovery.needsValidation ? '保存修改并重新校验' : recovery.phase === 'storyboard-failed' || !recovery.phase ? '保留剧本，仅重试分镜' : '确认剧本，生成分镜'}</Button> : null}
    {repairReady && onRepairScript ? <Button type="button" variant="primary" icon={busy ? <Loader2 className="director-spin" size={14} /> : <ShieldCheck size={14} />} disabled={locked} onClick={() => onRepairScript(scriptDraft!)}>{busy ? '正在重新校验剧本' : '保存修正并重新校验'}</Button> : null}
    <Button type="button" variant={recovery || repairReady ? 'secondary' : 'primary'} icon={busy ? <Loader2 className="director-spin" size={14} /> : <WandSparkles size={14} />} disabled={locked || sourceLength === 0 || sourceLength > 30_000 || targetDurationInvalid} onClick={onGenerate}>{busy ? '正在生成规划' : recovery ? '从剧本重新规划' : repairReady ? '放弃草稿重新生成' : '生成剧本，进入审核'}</Button>
  </>;

  return <Dialog
    open={open}
    title={previewReady ? `第 ${episodeNumber} 集 · AI 规划预览` : recovery ? `第 ${episodeNumber} 集 · 剧本审核` : 'AI 规划新集'}
    onOpenChange={(next) => { if (!locked) onOpenChange(next); }}
    actions={actions}
  >
    <div className="motion-comic-plan-dialog" data-view={previewReady ? 'preview' : recovery ? 'script-review' : 'source'} aria-busy={locked}>
      {errorMessage ? <div className="motion-comic-plan-error" role="alert"><CircleAlert size={16} /><span>{errorMessage}</span></div> : null}
      {!previewReady ? <div className="motion-comic-plan-source">
        {scriptFailure ? <>
          <div className="motion-comic-plan-error" role="status"><CircleAlert size={16} /><span><strong>剧本已暂存，但未通过实体校验</strong><small>下面只列出有问题的节拍。选择明确的说话角色；确属旁白才选择旁白，未知说话人不能直接绕过为旁白。修正只会重新校验当前剧本，通过后进入审核，不会自动生成分镜，也不会重跑整集剧本。</small></span></div>
          <section className="motion-comic-script-issues" aria-label="剧本校验问题">
            <div className="motion-comic-plan-pane-heading"><strong>剧本校验问题</strong><span>{scriptFailure.issues.length} 条</span></div>
            {scriptFailure.issues.map((issue) => {
              const target = locateBeat(scriptDraft, issue.path);
              if (!target) return <div key={issue.path} className="motion-comic-script-issue"><strong>{issue.path}</strong><small>{issue.message}</small></div>;
              const { scene, beat } = target;
              return <div key={issue.path} className="motion-comic-script-issue">
                <div><strong>第 {scene.actIndex} 幕 · {scene.title} · {beat.kind === 'dialogue' ? '对白' : beat.kind === 'narration' ? '旁白' : '动作'}</strong><small>{issue.message}</small><p>{beat.text}</p></div>
                <SelectField label="修正类型与说话人" value={beatSelection(beat)} options={speakerOptions(scriptDraft!, beat)} disabled={locked} onChange={(event) => onScriptDraftChange(updateFailedBeat(scriptDraft!, beat.key, event.target.value))} />
              </div>;
            })}
          </section>
          <div className="motion-comic-plan-warnings" role="status"><CheckCircle2 size={16} /><span><strong>失败草稿保留 7 天</strong><small>关闭后再次打开本集规划仍会显示这份草稿；修正前不会写入正式分集，也不会调用图片、视频或配音服务。</small></span></div>
        </> : null}
        {recovery ? <>
          <MotionComicScriptReview recovery={recovery} episodeNumber={episodeNumber} locked={locked} reviewed={reviewedScript} onReviewed={setReviewedScript} onChange={onReviewScriptChange} />
          <Button variant="subtle" disabled={locked} onClick={onEdit}>返回修改原文与要求</Button>
        </> : <>
        <div className="motion-comic-plan-lead">
          <span className="motion-comic-plan-lead-icon"><WandSparkles size={18} /></span>
          <span><strong>从故事原文生成可审阅的新集</strong><small>先生成本集角色、分幕、分场与剧情节拍；审核确认后才生成分镜。</small></span>
        </div>
        <TextAreaField
          label="故事原文"
          value={sourceText}
          rows={11}
          disabled={locked}
          resize="vertical"
          placeholder="粘贴本集故事、小说片段或完整剧情梗概"
          hint={`${sourceLength.toLocaleString('zh-CN')} / 30,000 字`}
          validationMessage={sourceLength > 30_000 ? '原文超过 30,000 字，请按集拆分后再生成。' : undefined}
          onChange={(_, data) => onSourceTextChange(data.value)}
        />
        <div className="motion-comic-plan-source-options">
          <TextField
            label="目标时长（秒）"
            type="number"
            min={5}
            max={1_800}
            step={5}
            value={targetDurationSec}
            disabled={locked}
            hint="留空时由故事密度决定"
            validationMessage={targetDurationInvalid ? '请填写 5 到 1800 秒。' : undefined}
            onChange={(_, data) => onTargetDurationSecChange(data.value)}
          />
          <TextAreaField
            label="补充要求（可选）"
            value={instructions}
            rows={3}
            maxLength={4_000}
            disabled={locked}
            resize="vertical"
            placeholder="例如：前 3 秒出现冲突；结尾保留悬念"
            onChange={(_, data) => onInstructionsChange(data.value)}
          />
        </div>
        {busy ? <div className="motion-comic-plan-running" role="status" aria-live="polite">
          <Loader2 className="director-spin" size={18} />
          <span><strong>正在生成并校验剧本</strong><small>完成后先审核剧本，确认后才生成分镜，不会直接改动项目。</small></span>
        </div> : null}
        </>}
      </div> : <div className="motion-comic-plan-preview">
        <div className="motion-comic-plan-safety" role="status">
          <ShieldCheck size={17} />
          {replaceStarterByDefault
            ? <span><strong>写入已确认的首个分集</strong><small>主操作会移除未编辑的占位集，并写入当前分幕、场次、人物和分镜；不会调用图片或视频服务。</small></span>
            : <span><strong>默认追加新集</strong><small>主操作会新增第 {episodeNumber} 集；现有分集、镜头和素材不会被覆盖。</small></span>}
        </div>
        {canReplaceStarter && !replaceStarterByDefault ? <div className="motion-comic-plan-starter-option" role="status">
          <ShieldCheck size={15} />
          <span><strong>当前首集仍是默认空模板</strong><small>“替换默认空模板”只会移除未修改的占位内容并写入本次规划；一旦首集被编辑或生成过素材，该操作就不会出现。</small></span>
        </div> : null}

        <div className="motion-comic-plan-metrics" aria-label="规划摘要">
          <span><Users size={14} /><strong>{result!.summary.characters}</strong><small>角色</small></span>
          <span><Layers3 size={14} /><strong>{result!.summary.acts}</strong><small>幕</small></span>
          <span><MapPin size={14} /><strong>{result!.summary.scenes}</strong><small>场次</small></span>
          <span><Film size={14} /><strong>{result!.summary.shots}</strong><small>镜头</small></span>
          <span><MessageSquareText size={14} /><strong>{result!.summary.dialogueLines}</strong><small>对白/旁白</small></span>
          <span><Clock3 size={14} /><strong>{formatDuration(result!.summary.durationSec)}</strong><small>预计时长</small></span>
        </div>

        {result!.repaired || result!.warnings.length > 0 ? <div className="motion-comic-plan-warnings" role="status">
          <CircleAlert size={15} />
          <span><strong>{result!.repaired ? (hasManualEdits ? '规划已修改并重新校验' : '规划已自动修复并重新校验') : '规划提醒'}</strong><small>{result!.warnings.length > 0 ? result!.warnings.join('；') : '结构已通过完整性检查。'}</small></span>
        </div> : <div className="motion-comic-plan-valid"><CheckCircle2 size={15} /><span>原文 {result!.summary.coveredSourceUnits}/{result!.summary.sourceUnits} 句段已覆盖，镜头顺序与对白时长校验通过</span></div>}

        {adjustments.length > 0 ? <div className="motion-comic-plan-review-tabs" aria-label="预览内容">
          <Button variant="secondary" aria-pressed={reviewTab === 'shots'} onClick={() => setReviewTab('shots')}>分幕与分镜</Button>
          <Button variant="secondary" aria-pressed={reviewTab === 'adjustments'} onClick={() => setReviewTab('adjustments')}>{adjustmentHeading}（{adjustments.length}）</Button>
        </div> : null}
        {adjustments.length > 0 && reviewTab === 'adjustments' ? <section className="motion-comic-plan-adjustments" aria-label={`${adjustmentHeading}审核`}>
          <p>{hasManualEdits ? '以下分别标明你的人工修改与系统整理，不会把人工改写视为 AI 自动修复。' : '以下是本地对 AI 返回内容的调整。'}补齐项是暂定创作设定，请结合原文审核；不合适时可返回修改剧本。</p>
          <ol>{adjustments.map((item, index) => <li key={`${item.path}-${index}`}>
            <strong>{adjustmentLabel(item.path)} · {item.kind === 'manual' ? '人工修改' : item.kind === 'filled' ? '补齐' : item.kind === 'duration' ? '时长调整' : '格式整理'}</strong>
            <small>{item.path}</small><p><span>原始：</span>{item.before}</p><p><span>调整后：</span>{item.after}</p>
          </li>)}</ol>
        </section> : <div className="motion-comic-plan-review">
          <aside className="motion-comic-plan-scenes" aria-label="规划场次">
            <div className="motion-comic-plan-pane-heading"><strong>分场</strong><span>{scenes.length} 场</span></div>
            <div className="motion-comic-plan-scene-list">
              {scenes.map((scene, index) => {
                const count = plan!.shots.filter((shot) => shot.sceneKey === scene.key).length;
                return <Button
                  key={scene.key}
                  type="button"
                  variant="subtle"
                  density="compact"
                  className="motion-comic-plan-scene"
                  aria-pressed={scene.key === selectedScene?.key}
                  onClick={() => setSelectedSceneKey(scene.key)}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span><strong>{scene.title}</strong><small>第 {scene.actIndex} 幕 · {scene.actTitle} · {count} 镜头</small></span>
                </Button>;
              })}
            </div>
            <div className="motion-comic-plan-entities">
              <span><Users size={13} /><strong>系列资产</strong></span>
              <small>{plan!.script.characters.map((character) => character.name).join('、') || '无新增角色'}</small>
              <small>{plan!.script.sceneAssets.map((asset) => asset.label).join('、') || '无新增场景'}</small>
              {plan!.script.props.length > 0 ? <small>{plan!.script.props.map((prop) => prop.label).join('、')}</small> : null}
            </div>
          </aside>

          <section className="motion-comic-plan-shots" aria-label={selectedScene ? `${selectedScene.title}镜头规划` : '镜头规划'}>
            {selectedScene ? <>
              <div className="motion-comic-plan-pane-heading"><span><strong>{selectedScene.title}</strong><small>第 {selectedScene.actIndex} 幕 · {selectedScene.actTitle} · {selectedScene.summary}</small></span><span>{selectedShots.length} 镜头</span></div>
              <div className="motion-comic-plan-act-evidence"><Layers3 size={14} /><span><strong>幕边界依据</strong><small>{selectedScene.actBoundaryReason}</small></span></div>
              {selectedShots.length > 0 ? <ol>
                {selectedShots.map((shot, index) => <li key={shot.key}>
                  <span className="motion-comic-plan-shot-index">{String(index + 1).padStart(2, '0')}</span>
                  <div>
                    <header><strong>{shot.title}</strong><span>{shot.framing} · {formatDuration(shot.durationSec)}</span></header>
                    <p>{shot.prompt}</p>
                    <small><strong>运动</strong>{shot.motionPrompt}</small>
                    <small><strong>连续性</strong>{shot.continuity.startState} 到 {shot.continuity.endState}</small>
                  </div>
                </li>)}
              </ol> : <div className="motion-comic-plan-empty"><Film size={18} /><span>这个场次没有可应用的镜头，请重新规划。</span></div>}
            </> : <div className="motion-comic-plan-empty"><Film size={18} /><span>规划没有可审阅的场次，请重新生成。</span></div>}
          </section>
        </div>}
        {adjustments.length > 0 ? <CheckboxField label={hasManualEdits ? '我已核对人工修改与系统整理，同意写入本集' : '我已核对自动整理与补齐项，同意写入本集'} checked={reviewedAdjustments} disabled={locked} onChange={(_, data) => setReviewedAdjustments(data.checked === true)} /> : null}
      </div>}
    </div>
  </Dialog>;
}

function locateBeat(draft: MotionComicScriptDraft | null, path: string): { scene: MotionComicScriptDraft['scenes'][number]; beat: MotionComicScriptBeat } | undefined {
  const match = path.match(/scenes\[(\d+)\]\.beats\[(\d+)\]/u);
  if (!match || !draft) return undefined;
  const scene = draft.scenes[Number(match[1])];
  const beat = scene?.beats[Number(match[2])];
  return scene && beat ? { scene, beat } : undefined;
}

function adjustmentLabel(path: string): string {
  const fields: Record<string, string> = { personality: '性格', wardrobe: '服饰', voiceNotes: '声线', role: '角色定位', identityPrompt: '人物设定', appearancePrompt: '造型描述', continuityNotes: '连续性要求', durationSec: '镜头秒数', label: '名称', sourceUnitIds: '原文引用', prompt: '画面描述', motionPrompt: '运动描述', framing: '景别', text: '剧情内容', kind: '节拍类型', title: '标题', key: '编号' };
  const field = path.split('.').at(-1) ?? path;
  return fields[field] ?? '内容字段';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return remainder ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`;
}
