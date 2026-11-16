import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ImageOff, Link2 } from 'lucide-react';
import { Button, Dialog, HoverPreview } from '../../ui';
import { splitMotionComicSource, type MotionComicPlanRecovery, type MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { motionComicAssetMatches, motionComicScriptAssetSummary } from '../../shared/motion-comic-script-assets';
import { motionComicReferenceAssets } from './motion-comic-consistency';
import { safeMotionComicTaskMediaUrl } from './motion-comic-task-view-model';

export type ScriptReferenceResolver = (path: string) => string | Promise<string>;
export function scriptSourceLocations(sourceText: string): Map<string, { text: string; paragraph: number; sentence: number }> {
  const paragraphs = sourceText.trim().split(/\r?\n+/u).map(text => text.trim()).filter(Boolean);
  let index = 0;
  return new Map(paragraphs.flatMap((paragraph, paragraphIndex) => splitMotionComicSource(paragraph).map(unit => {
    index += 1;
    return [`S${index}`, { text: unit.text, paragraph: paragraphIndex + 1, sentence: index }] as const;
  })));
}

function ReferencePreview({ path, label, resolveUrl }: { path: string; label: string; resolveUrl?: ScriptReferenceResolver }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const resolver = useRef(resolveUrl);
  useEffect(() => { resolver.current = resolveUrl; }, [resolveUrl]);
  const canResolve = Boolean(resolveUrl);
  useEffect(() => {
    let active = true;
    setUrl(undefined); setFailed(false);
    const resolve = resolver.current;
    if (resolve) Promise.resolve().then(() => resolve(path)).then(value => {
      if (active) { const safe = safeMotionComicTaskMediaUrl(value); setUrl(safe); setFailed(!safe); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [path, canResolve]);
  const image = () => <img src={url} alt={`${label} · 项目关联参考`} loading="lazy" onError={() => setFailed(true)} />;
  return <figure>{url && !failed ? <HoverPreview title={label} renderPreview={image}><button type="button" className="comic-script-reference-image" aria-label={`预览${label}参考图`} onClick={() => setOpen(true)}>{image()}</button></HoverPreview> : <div className="comic-script-reference-unavailable"><ImageOff size={18} aria-hidden="true" /><span>{failed ? '参考图加载失败' : resolveUrl ? '正在加载参考图' : '参考图预览不可用'}</span></div>}<figcaption>{label}</figcaption><Dialog open={open} onOpenChange={setOpen} title={`${label} · 项目参考图`} surfaceClassName="comic-script-reference-dialog" actions={<Button onClick={() => setOpen(false)}>关闭预览</Button>}>{url && !failed ? image() : <p>参考图加载失败，请在项目资产中检查文件。</p>}</Dialog></figure>;
}

export function MotionComicScriptEvidence({ recovery, scene, project, onOpenProjectAssets, resolveReferenceUrl, children }: {
  recovery: MotionComicPlanRecovery;
  scene?: MotionComicScriptDraft['scenes'][number];
  project?: MotionComicPipelineData;
  onOpenProjectAssets?: () => void;
  resolveReferenceUrl?: ScriptReferenceResolver;
  children?: ReactNode;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedBeat, setSelectedBeat] = useState(0);
  const script = recovery.script;
  const sources = useMemo(() => scriptSourceLocations(recovery.sourceText), [recovery.sourceText]);
  const beats = scene?.beats ?? [];
  const located = beats.filter(beat => beat.sourceUnitIds.length > 0 && beat.sourceUnitIds.every(id => sources.has(id))).length;
  const summary = project ? motionComicScriptAssetSummary(project, script) : undefined;
  const characters = script.characters.map(character => {
    const matches = project && !character.createNew ? motionComicAssetMatches(project.characters, { name: character.name, aliases: character.aliases, existingId: character.existingCharacterId }) : [];
    return { draft: character, canonical: matches.length === 1 ? matches[0] : undefined };
  });
  const references: Array<{ id: string; path: string; label: string }> = [];
  const add = (ids: string[], label: string) => {
    if (!project) return;
    for (const asset of motionComicReferenceAssets(project, ids)) if (asset.localPath && !references.some(item => item.id === asset.id)) references.push({ id: asset.id, path: asset.localPath, label });
  };
  for (const { draft, canonical } of characters) for (const look of draft.looks) {
    const matches = canonical && !look.createNew ? motionComicAssetMatches(canonical.looks, { name: look.label, existingId: look.existingLookId }) : [];
    if (matches.length === 1) add(matches[0].referenceAssetVersionIds, `${draft.name} · ${look.label}`);
  }
  for (const item of script.sceneAssets) {
    const matches = project && !item.createNew ? motionComicAssetMatches(project.sceneAssets, { name: item.label, existingId: item.existingSceneAssetId }) : [];
    if (matches.length === 1) add(matches[0].referenceAssetVersionIds, item.label);
  }
  for (const item of script.props) {
    const matches = project && !item.createNew ? motionComicAssetMatches(project.props, { name: item.label, existingId: item.existingPropId }) : [];
    if (matches.length === 1) add(matches[0].referenceAssetVersionIds, item.label);
  }
  return <aside className="comic-script-evidence" aria-label="素材与证据检查器">
    <header className="motion-comic-plan-pane-heading"><strong>素材与证据</strong><small>本集检查器</small></header>
    <section className="comic-script-reference-section" aria-label="本集项目关联参考">
      <div className="comic-script-inspector-title"><strong>项目关联参考</strong><span>{references.length} 张</span></div>
      {references.length ? <div className="comic-script-reference-grid">{references.map(item => <ReferencePreview key={`${item.id}:${item.path}`} path={item.path} label={item.label} resolveUrl={resolveReferenceUrl} />)}</div> : <div className="comic-script-reference-empty"><ImageOff size={22} aria-hidden="true" /><strong>本集暂无关联参考图</strong><p>关联项目人物造型、场景或道具后，在这里核对真实素材。</p></div>}
      {onOpenProjectAssets ? <Button variant="subtle" density="compact" onClick={onOpenProjectAssets}>打开项目资产</Button> : <small>请在项目资产中关联参考图。</small>}
    </section>
    <section className="comic-script-inspector-checks" aria-label="核对状态">
      <div><BookOpen size={15} aria-hidden="true" /><span>当前场原文引用</span><strong>{located === beats.length && beats.length ? `${located} 条可定位` : `${beats.length - located} 条缺少有效引用`}</strong></div>
      <div><Link2 size={15} aria-hidden="true" /><span>人物资产</span><strong>{characters.filter(item => item.canonical).length} 复用 · {characters.filter(item => !item.canonical).length} 待关联</strong></div>
      <div><span>全部资产</span><strong>{summary ? `${summary.reused} 复用 · ${summary.created} 将新建 · ${summary.unresolved} 待选择` : '未载入项目资产'}</strong></div>
      <div><span>整理与修改</span><strong>{recovery.adjustments?.length ?? 0} 项{recovery.needsValidation ? ' · 待校验' : ''}</strong></div>
    </section>
    {scene ? <details className="comic-script-scene-context"><summary>{scene.title} · 场景梗概与幕边界</summary><p>{scene.summary}</p><p>幕边界依据：{scene.actBoundaryReason}</p></details> : null}
    <section className="comic-script-evidence__sources" aria-label="来源对应">
      {beats.map((beat, index) => <article key={beat.key} className="comic-script-evidence__entry">
        <strong>第 {index + 1} 条 · 来源对应</strong>
        {beat.sourceUnitIds.map(id => { const source = sources.get(id); return source ? <div key={id}><small>原文第 {source.paragraph} 自然段 · 第 {source.sentence} 句段</small><blockquote>{source.text.length > 100 ? `${source.text.slice(0, 100)}…` : source.text}</blockquote></div> : <p key={id}>引用无法定位，请重新校验。</p>; })}
        {!beat.sourceUnitIds.length ? <p>缺少引用，请补全后重新校验。</p> : null}
        <Button variant="subtle" density="compact" onClick={() => { setSelectedBeat(index); setSourceOpen(true); }} aria-label={`打开第 ${index + 1} 条完整原文`}>打开完整原文</Button>
        <details className="comic-script-evidence-ids"><summary>技术引用信息</summary><p>剧情标识：{beat.key}</p><p>来源标识：{beat.sourceUnitIds.join('、') || '无'}</p></details>
      </article>)}
    </section>
    {children}
    <Dialog open={sourceOpen} onOpenChange={setSourceOpen} title={`完整原文 · 对应第 ${selectedBeat + 1} 条剧情`} surfaceClassName="comic-script-source-dialog" actions={<Button onClick={() => setSourceOpen(false)}>关闭原文</Button>}>
      <p>按原文自然段展示；高亮段落包含此条剧情的引用。</p>
      {recovery.sourceText.trim().split(/\r?\n+/u).filter(text => text.trim()).map((text, index) => <section key={index} data-referenced={beats[selectedBeat]?.sourceUnitIds.some(id => sources.get(id)?.paragraph === index + 1) || undefined}><strong>第 {index + 1} 自然段</strong><p>{text}</p></section>)}
    </Dialog>
  </aside>;
}
