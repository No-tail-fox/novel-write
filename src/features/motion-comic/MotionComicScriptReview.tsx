import { useEffect, useMemo, useState } from 'react';
import { splitMotionComicSource, type MotionComicPlanRecovery, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import { Button, CheckboxField, SelectField, Tabs, TextAreaField } from '../../ui';
import { MotionComicScriptAssets } from './MotionComicScriptAssets';
import { beatSelection, speakerOptions, updateFailedBeat } from './motion-comic-script-repair';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { motionComicScriptAssetSummary } from '../../shared/motion-comic-script-assets';

interface Props {
  recovery: MotionComicPlanRecovery;
  episodeNumber: number;
  locked: boolean;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  onChange?: (script: MotionComicScriptDraft) => void;
  approvalLabel?: string;
  statusLabel?: string;
  workflowNote?: string;
  project?: MotionComicPipelineData;
  onOpenProjectAssets?: () => void;
}

/** The retained token identifies the server revision; edits must be revalidated before confirmation. */
export function MotionComicScriptReview({ recovery, project, onOpenProjectAssets, episodeNumber, locked, reviewed, onReviewed, onChange, approvalLabel = '我已核对本集剧情、角色及修改记录，确认后生成分镜', statusLabel, workflowNote = '确认前不会生成分镜，也不会写入正式分集。' }: Props) {
  const script = recovery.script;
  const [sceneKey, setSceneKey] = useState(script.scenes[0]?.key ?? '');
  const [view, setView] = useState('scenes');
  useEffect(() => { setSceneKey(script.scenes[0]?.key ?? ''); setView('scenes'); }, [recovery.token]);
  const scene = script.scenes.find((item) => item.key === sceneKey) ?? script.scenes[0];
  const acts = new Set(script.scenes.map((item) => item.actIndex)).size;
  const units = useMemo(() => new Map(splitMotionComicSource(recovery.sourceText).map((unit) => [unit.id, unit.text])), [recovery.sourceText]);
  const adjustments = recovery.adjustments ?? [];
  const assets = project && motionComicScriptAssetSummary(project, script);
  return <section className="motion-comic-script-review" aria-label="当前集剧本审核">
    <div className="motion-comic-script-overview">
      <div role="status" title={workflowNote}><strong>{recovery.needsValidation ? '修改待校验' : statusLabel ?? '等待确认剧本'}</strong><small>第 {episodeNumber} 集 · {acts} 幕 · {script.scenes.length} 场</small></div>
      <details><summary>本集梗概</summary><div><strong>{script.title}</strong><p>{script.logline}</p><small>{workflowNote}</small></div></details>
    </div>
    <Tabs label="剧本拆解内容" value={view} onChange={setView} items={[
      { value: 'scenes', label: '分幕分场' },
      { value: 'characters', label: `人物 (${script.characters.length})` },
      { value: 'locations', label: `场景 (${script.sceneAssets.length})` },
      { value: 'props', label: `道具 (${script.props.length})` },
    ]} />
    {assets ? <div className="comic-script-asset-summary" data-unresolved={assets.unresolved > 0} role="status"><small>项目资产 · {assets.reused} 项复用 · {assets.created} 项新建 · {assets.unresolved} 项待选择</small></div> : null}
    {view === 'scenes' ? <div className="motion-comic-plan-review motion-comic-script-scenes">
      <aside className="motion-comic-plan-scenes" aria-label="本集分幕与场次">
        <div className="motion-comic-plan-pane-heading"><strong>{acts} 幕 / {script.scenes.length} 场</strong></div>
        <div className="motion-comic-plan-scene-list">
          {script.scenes.map((item, index) => <div className="motion-comic-script-scene-entry" key={item.key}>
            {index === 0 || script.scenes[index - 1].actIndex !== item.actIndex ? <h3>第 {item.actIndex} 幕 · {item.actTitle}</h3> : null}
            <Button variant="subtle" className="motion-comic-plan-scene" title={item.title} aria-pressed={item.key === scene?.key} onClick={() => setSceneKey(item.key)}>
              <span>{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>{script.sceneAssets.find((location) => location.key === item.locationKey)?.label ?? '场景待核对'} · {item.beats.length} 条</small></span>
            </Button>
          </div>)}
        </div>
      </aside>
      <section className="motion-comic-script-beats" aria-label="剧情节拍与原文证据" key={scene?.key}>
        {scene ? <>
          <div className="motion-comic-plan-pane-heading"><span><strong>{scene.title}</strong><small>{scene.summary}</small><small>幕边界依据：{scene.actBoundaryReason}</small></span></div>
          {scene.beats.map((beat, index) => <article className="motion-comic-script-beat" key={beat.key}>
            <strong>第 {index + 1} 条 · {beat.kind === 'dialogue' ? '对白' : beat.kind === 'narration' ? '旁白 / 内心独白' : '动作'}</strong>
            <SelectField label="类型与说话人" value={beatSelection(beat)} options={speakerOptions(script, beat)} disabled={locked || !onChange} onChange={(event) => onChange?.(updateFailedBeat(script, beat.key, event.target.value))} />
            <TextAreaField label="剧情内容" value={beat.text} rows={2} maxLength={2_000} validationMessage={!beat.text.trim() ? '剧情内容不能为空，请补全后再校验。' : undefined} resize="vertical" disabled={locked || !onChange} onChange={(_, data) => onChange?.({ ...script, scenes: script.scenes.map((item) => item.key === scene.key ? { ...item, beats: item.beats.map((entry) => entry.key === beat.key ? { ...entry, text: data.value } : entry) } : item) })} />
            <details><summary>原文证据 · {beat.sourceUnitIds.join('、')}</summary>{beat.sourceUnitIds.map((id) => <p key={id}><strong>{id}</strong> {units.get(id) ?? '原文引用不可用，请重新校验'}</p>)}</details>
          </article>)}
        </> : null}
      </section>
    </div> : <MotionComicScriptAssets script={script} project={project} disabled={locked} onChange={onChange} onOpenProjectAssets={onOpenProjectAssets} kind={view === 'characters' ? 'characters' : view === 'locations' ? 'locations' : 'props'} onOpenScene={(key) => { setSceneKey(key); setView('scenes'); }} />}
    {adjustments.length ? <details className="motion-comic-script-adjustments"><summary>整理与修改记录 · {adjustments.length} 项</summary><ol>{adjustments.map((item, index) => <li key={index}><strong>{item.path}</strong><p>修改前：{item.before}</p><p>修改后：{item.after}</p></li>)}</ol></details> : null}
    <CheckboxField label={approvalLabel} checked={reviewed} disabled={locked || recovery.needsValidation || Boolean(assets?.unresolved)} onChange={(_, data) => onReviewed(data.checked === true)} />
  </section>;
}
