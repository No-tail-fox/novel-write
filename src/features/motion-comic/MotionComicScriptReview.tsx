import { useEffect, useMemo, useState } from 'react';
import { splitMotionComicSource, type MotionComicPlanRecovery, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import { Button, CheckboxField, SelectField, TextAreaField } from '../../ui';
import { beatSelection, speakerOptions, updateFailedBeat } from './motion-comic-script-repair';

interface Props {
  recovery: MotionComicPlanRecovery;
  episodeNumber: number;
  locked: boolean;
  reviewed: boolean;
  onReviewed: (value: boolean) => void;
  onChange?: (script: MotionComicScriptDraft) => void;
}

/** The retained token identifies the server revision; edits must be revalidated before confirmation. */
export function MotionComicScriptReview({ recovery, episodeNumber, locked, reviewed, onReviewed, onChange }: Props) {
  const script = recovery.script;
  const [sceneKey, setSceneKey] = useState(script.scenes[0]?.key ?? '');
  useEffect(() => { setSceneKey(script.scenes[0]?.key ?? ''); }, [recovery.token]);
  const scene = script.scenes.find((item) => item.key === sceneKey) ?? script.scenes[0];
  const units = useMemo(() => new Map(splitMotionComicSource(recovery.sourceText).map((unit) => [unit.id, unit.text])), [recovery.sourceText]);
  const adjustments = recovery.adjustments ?? [];
  return <section className="motion-comic-script-review" aria-label="当前集剧本审核">
    <div className="motion-comic-plan-safety" role="status"><span>
      <strong>第 {episodeNumber} 集 · {script.title} · {recovery.needsValidation ? '修改待校验' : '等待确认剧本'}</strong>
      <small>{script.logline} · {script.scenes.length} 场 · {script.characters.length} 角色。确认前不会生成分镜，也不会写入正式分集。</small>
    </span></div>
    <div className="motion-comic-plan-review">
      <aside className="motion-comic-plan-scenes" aria-label="本集分幕与场次">
        <div className="motion-comic-plan-pane-heading"><strong>第 {episodeNumber} 集 · 分幕 / 分场</strong></div>
        <div className="motion-comic-plan-scene-list">
          {script.scenes.map((item, index) => <Button key={item.key} variant="subtle" className="motion-comic-plan-scene" aria-pressed={item.key === scene?.key} onClick={() => setSceneKey(item.key)}>
            <span>{String(index + 1).padStart(2, '0')}</span><span><strong>{item.title}</strong><small>第 {item.actIndex} 幕 · {item.actTitle} · {item.beats.length} 条</small></span>
          </Button>)}
        </div>
        <div className="motion-comic-plan-entities"><strong>本集实体</strong><small>角色：{script.characters.map((c) => c.name).join('、') || '无'}</small><small>场景：{script.sceneAssets.map((c) => c.label).join('、') || '无'}</small><small>道具：{script.props.map((c) => c.label).join('、') || '无'}</small></div>
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
    </div>
    {adjustments.length ? <details className="motion-comic-script-adjustments"><summary>整理与修改记录 · {adjustments.length} 项</summary><ol>{adjustments.map((item, index) => <li key={index}><strong>{item.path}</strong><p>修改前：{item.before}</p><p>修改后：{item.after}</p></li>)}</ol></details> : null}
    <CheckboxField label="我已核对本集剧情、角色及修改记录，确认后生成分镜" checked={reviewed} disabled={locked || recovery.needsValidation} onChange={(_, data) => onReviewed(data.checked === true)} />
  </section>;
}
