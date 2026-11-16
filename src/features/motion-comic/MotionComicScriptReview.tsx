import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type MotionComicPlanRecovery, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import { Button, CheckboxField, SelectField, Tabs, TextAreaField } from '../../ui';
import { MotionComicScriptEvidence, scriptSourceLocations, type ScriptReferenceResolver } from './MotionComicScriptEvidence';
import { MotionComicScriptAssets } from './MotionComicScriptAssets';
import { beatSelection, speakerOptions, updateFailedBeat } from './motion-comic-script-repair';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { motionComicScriptAssetSummary } from '../../shared/motion-comic-script-assets';
import './motion-comic-script-layout.css';
import './motion-comic-script-hierarchy.css';

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
  savedScript?: MotionComicScriptDraft;
  savedRevision?: number;
  originalScript?: MotionComicScriptDraft;
  originalRevision?: number;
  proposalPanel?: ReactNode;
  resolveReferenceUrl?: ScriptReferenceResolver;
}

/** The retained token identifies the server revision; edits must be revalidated before confirmation. */
export function MotionComicScriptReview({ recovery, resolveReferenceUrl, savedScript, savedRevision, originalScript, originalRevision, proposalPanel, project, onOpenProjectAssets, episodeNumber, locked, reviewed, onReviewed, onChange, approvalLabel = '我已核对本集剧情、角色及修改记录，确认后生成分镜', statusLabel, workflowNote = '确认前不会生成分镜，也不会写入正式分集。' }: Props) {
  const script = recovery.script;
  const [sceneKey, setSceneKey] = useState(script.scenes[0]?.key ?? '');
  const [view, setView] = useState('scenes');
  const [editingBeat, setEditingBeat] = useState('');
  useEffect(() => { setEditingBeat(''); }, [recovery.token, sceneKey, view]);
  useEffect(() => { setSceneKey(script.scenes[0]?.key ?? ''); setView('scenes'); }, [recovery.token]);
  const scene = script.scenes.find((item) => item.key === sceneKey) ?? script.scenes[0];
  const acts = new Set(script.scenes.map((item) => item.actIndex)).size;
  const units = useMemo(() => scriptSourceLocations(recovery.sourceText), [recovery.sourceText]);
  const adjustments = recovery.adjustments ?? [];
  const assets = project && motionComicScriptAssetSummary(project, script);
  return <section className="motion-comic-script-review" aria-label="当前集剧本审核">
    <div className="comic-script-review-heading"><div className="motion-comic-script-overview">
      <div title={`${statusLabel ?? '等待确认剧本'} · ${workflowNote}`}><small>{recovery.needsValidation ? '修改待校验 · ' : ''}第 {episodeNumber} 集 · {acts} 幕 · {script.scenes.length} 场</small></div>
      <details><summary>本集梗概</summary><div><strong>{script.title}</strong><p>{script.logline}</p><small>{workflowNote}</small></div></details>
    </div>
    <Tabs label="剧本拆解内容" value={view} onChange={setView} items={[
      { value: 'scenes', label: '分幕分场' },
      { value: 'characters', label: `人物 (${script.characters.length})` },
      { value: 'locations', label: `场景 (${script.sceneAssets.length})` },
      { value: 'props', label: `道具 (${script.props.length})` },
    ]} />
    {assets ? <div className="comic-script-asset-summary" data-unresolved={assets.unresolved > 0} role="status"><small>项目资产 · {assets.reused} 项复用 · {assets.created} 项新建 · {assets.unresolved} 项待选择</small></div> : null}
    </div>
    {view === 'scenes' ? <div className="motion-comic-plan-review motion-comic-script-scenes">
      <section className="motion-comic-script-beats" aria-label="剧情节拍与原文证据">
        <div className="comic-script-scene-picker"><SelectField label="本集分幕与场次" value={scene?.key ?? ''} options={script.scenes.map((item, index) => ({ value: item.key, label: `${String(index + 1).padStart(2, '0')} · 第 ${item.actIndex} 幕 ${item.actTitle} / ${item.title} · ${item.beats.length} 条` }))} onChange={(event) => setSceneKey(event.target.value)} /></div>
        {scene ? <>
          {scene.beats.map((beat, index) => <article className="motion-comic-script-beat" data-kind={beat.kind} key={beat.key}>
            <div className="comic-script-beat-heading"><strong><span className="comic-script-beat-index">{String(index + 1).padStart(2, '0')}</span><span className="comic-script-beat-kind">{beat.kind === 'dialogue' ? script.characters.find(character => character.key === beat.characterKey)?.name || '对白' : beat.kind === 'narration' ? '旁白 / 内心独白' : '动作'}</span></strong><Button density="compact" variant="subtle" disabled={locked || !onChange} aria-expanded={editingBeat === beat.key} aria-label={`${editingBeat === beat.key ? '收起' : '编辑'}第 ${index + 1} 条`} onClick={() => setEditingBeat(current => current === beat.key ? '' : beat.key)}>{editingBeat === beat.key ? '收起编辑' : '编辑'}</Button></div>
            {editingBeat === beat.key ? <>
            <SelectField label="类型与说话人" value={beatSelection(beat)} options={speakerOptions(script, beat)} disabled={locked || !onChange} onChange={(event) => onChange?.(updateFailedBeat(script, beat.key, event.target.value))} />
            <TextAreaField label="剧情内容" value={beat.text} rows={2} maxLength={2_000} validationMessage={!beat.text.trim() ? '剧情内容不能为空，请补全后再校验。' : undefined} resize="vertical" disabled={locked || !onChange} onChange={(_, data) => onChange?.({ ...script, scenes: script.scenes.map((item) => item.key === scene.key ? { ...item, beats: item.beats.map((entry) => entry.key === beat.key ? { ...entry, text: data.value } : entry) } : item) })} />
            </> : <button type="button" className="comic-script-beat-reading" disabled={locked || !onChange} aria-label={`编辑第 ${index + 1} 条剧情`} onClick={() => setEditingBeat(beat.key)}>{beat.text || '剧情内容为空，请编辑补全。'}</button>}
            <small className="comic-script-beat-citation">原文依据 · {beat.sourceUnitIds.map(id => { const source = units.get(id); return source ? `第 ${source.paragraph} 自然段 · 第 ${source.sentence} 句段` : '引用无法定位'; }).join('、') || '缺少引用，请核对'}</small>
          </article>)}
        </> : null}
        {proposalPanel}
      </section>
      <MotionComicScriptEvidence recovery={recovery} scene={scene} project={project} onOpenProjectAssets={onOpenProjectAssets} resolveReferenceUrl={resolveReferenceUrl}>
        <div className="comic-script-evidence__records"><strong>版本与审核记录</strong><p>{workflowNote}</p>
    {savedScript ? <details className="motion-comic-script-adjustments"><summary>首次生成原稿{originalRevision ? ` · r${originalRevision}` : ''}（只读）</summary>
      <p>与当前服务器稿分开保存，仅记录首次模型完成的原稿，不随人工修改、采用或撤销提案覆盖。</p>
      {originalScript ? <><strong>{originalScript.title}</strong><p>{originalScript.logline}</p>{originalScript.scenes.map(item => <section key={item.key}><h3>{item.title}</h3>{item.beats.map(beat => <p key={beat.key}>{beat.text}</p>)}</section>)}</> : <p>原稿不可用：旧任务未保存首次生成原稿，不会用当前服务器稿代替。</p>}
    </details> : null}
    {savedScript ? <details className="motion-comic-script-adjustments"><summary>当前稿与已保存稿差异（只读）</summary>
      {JSON.stringify(script) === JSON.stringify(savedScript) ? <p>当前稿与已保存稿一致。</p> : <>
        <p>当前稿存在修改；完整版本可在下方展开核对，确认前仍需通过校验。</p>
        {script.scenes.flatMap((item, sceneIndex) => item.beats.map((beat, beatIndex) => {
          const before = savedScript.scenes.find(entry => entry.key === item.key)?.beats.find(entry => entry.key === beat.key);
          return before && JSON.stringify(before) === JSON.stringify(beat) ? null : <section key={beat.key}><strong>第 {sceneIndex + 1} 场 · 第 {beatIndex + 1} 条</strong><p>已保存：{before?.text ?? '本条为新增'}</p><p>当前稿：{beat.text}</p>{before && (before.kind !== beat.kind || before.characterKey !== beat.characterKey) ? <p>类型或说话人已修改。</p> : null}</section>;
        }))}
      </>}
    </details> : null}
    {savedScript ? <details className="motion-comic-script-adjustments"><summary>查看已保存剧情 · r{savedRevision}（只读）</summary>
      <p>用于核对当前本地改稿；这里展示服务器当前稿，不是生成前原稿或跨版本历史。</p>
      <strong>{savedScript.title}</strong><p>{savedScript.logline}</p>
      {savedScript.scenes.map((savedScene) => <section key={savedScene.key}><h3>{savedScene.title}</h3><p>{savedScene.summary}</p>
        {savedScene.beats.map((beat) => <p key={beat.key}><strong>{beat.kind === 'dialogue' ? '对白' : beat.kind === 'narration' ? '旁白 / 内心独白' : '动作'}{beat.characterKey ? ` · ${savedScript.characters.find((character) => character.key === beat.characterKey)?.name ?? beat.characterKey}` : ''}：</strong>{beat.text}</p>)}
      </section>)}
    </details> : null}
    {adjustments.length ? <details className="motion-comic-script-adjustments"><summary>整理与修改记录 · {adjustments.length} 项</summary><ol>{adjustments.map((item, index) => <li key={index}><strong>{item.path}</strong><p>修改前：{item.before}</p><p>修改后：{item.after}</p></li>)}</ol></details> : null}
        </div>
      </MotionComicScriptEvidence>
    </div> : <MotionComicScriptAssets script={script} project={project} resolveReferenceUrl={resolveReferenceUrl} disabled={locked} onChange={onChange} onOpenProjectAssets={onOpenProjectAssets} kind={view === 'characters' ? 'characters' : view === 'locations' ? 'locations' : 'props'} onOpenScene={(key) => { setSceneKey(key); setView('scenes'); }} />}
    <CheckboxField label={approvalLabel} checked={reviewed} disabled={locked || recovery.needsValidation || Boolean(assets?.unresolved)} onChange={(_, data) => onReviewed(data.checked === true)} />
  </section>;
}
