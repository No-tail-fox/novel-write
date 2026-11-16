import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, Clapperboard, MapPin, Package, Shirt, Users } from 'lucide-react';
import type { MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { motionComicAssetMatches } from '../../shared/motion-comic-script-assets';
import { Button, SelectField } from '../../ui';
import { fixedMotionComicReferenceAsset, motionComicReferenceAssets } from './motion-comic-consistency';
import { safeMotionComicTaskMediaUrl } from './motion-comic-task-view-model';
import type { ScriptReferenceResolver } from './MotionComicScriptEvidence';
import '../../styles/features/motion-comic.css';
import './motion-comic-script-hierarchy.css';

type AssetKind = 'characters' | 'locations' | 'props';
type Binding = 'reuse' | 'new' | 'pending' | 'local';
const bindingLabels: Record<Binding, string> = { reuse: '复用项目资产', new: '批准时新建', pending: '待选择', local: '本集提取' };
const bindingShort: Record<Binding, string> = { reuse: '复用', new: '新建', pending: '待选', local: '本集' };

/** Real reference image for a project asset (pinned first, else the newest image); never a placeholder image. */
function referencePath(project: MotionComicPipelineData | undefined, ids: readonly string[]): string | undefined {
  if (!project || !ids.length) return undefined;
  return fixedMotionComicReferenceAsset(project, ids)?.localPath ?? motionComicReferenceAssets(project, ids).filter(asset => asset.localPath?.trim()).at(-1)?.localPath;
}

function AssetAvatar({ path, label, icon, size, resolveUrl }: { path?: string; label: string; icon: ReactNode; size: 'sm' | 'lg'; resolveUrl?: ScriptReferenceResolver }) {
  const [media, setMedia] = useState<{ path: string; url?: string }>();
  const resolver = useRef(resolveUrl);
  useEffect(() => { resolver.current = resolveUrl; }, [resolveUrl]);
  const canResolve = Boolean(resolveUrl);
  useEffect(() => {
    const resolve = resolver.current;
    if (!path || !resolve) return;
    let active = true;
    Promise.resolve().then(() => resolve(path)).then(value => { if (active) setMedia({ path, url: safeMotionComicTaskMediaUrl(value) }); }, () => { if (active) setMedia({ path }); });
    return () => { active = false; };
  }, [path, canResolve]);
  const url = media?.path === path ? media?.url : undefined;
  const initial = Array.from(label.replace(/[\s·・\-—]/gu, ''))[0] ?? '?';
  return <span className="comic-script-asset-avatar" data-size={size} data-has-image={Boolean(url) || undefined} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" onError={() => setMedia({ path: path! })} /> : size === 'lg' || !icon ? <b>{initial}</b> : icon}
  </span>;
}

function Field({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  const text = value?.trim();
  return <div className="comic-script-asset-field" data-wide={wide || undefined}>
    <dt>{label}</dt>
    <dd data-empty={!text || undefined}>{text || '未填写'}</dd>
  </div>;
}

export function MotionComicScriptAssets({ script, project, kind, disabled, onChange, onOpenScene, onOpenProjectAssets, resolveReferenceUrl }: {
  script: MotionComicScriptDraft;
  project?: MotionComicPipelineData;
  disabled?: boolean;
  onChange?: (script: MotionComicScriptDraft) => void;
  onOpenProjectAssets?: () => void;
  resolveReferenceUrl?: ScriptReferenceResolver;
  kind: AssetKind;
  onOpenScene: (key: string) => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Partial<Record<AssetKind, string>>>({});
  const label = kind === 'characters' ? '人物' : kind === 'locations' ? '场景' : '道具';
  const Icon = kind === 'characters' ? Users : kind === 'locations' ? MapPin : Package;
  const projectItems: Array<{ id: string; label: string; aliases?: string[]; description?: string; referenceAssetVersionIds?: string[] }> = kind === 'characters'
    ? (project?.characters ?? []).map((item) => ({ ...item, label: item.name, referenceAssetVersionIds: item.looks.flatMap(look => look.referenceAssetVersionIds) }))
    : kind === 'locations' ? project?.sceneAssets ?? [] : project?.props ?? [];
  const sceneCount = (key: string) => script.scenes.filter((scene) => scene.locationKey === key).length;
  const items = (kind === 'characters' ? script.characters.map((item) => ({ key: item.key, label: item.name, aliases: item.aliases, detail: item.role, meta: `${item.looks.length} 套造型`, existingId: item.existingCharacterId, createNew: item.createNew }))
    : kind === 'locations' ? script.sceneAssets.map((item) => ({ key: item.key, label: item.label, aliases: undefined, detail: item.description, meta: `${sceneCount(item.key)} 场引用`, existingId: item.existingSceneAssetId, createNew: item.createNew }))
      : script.props.map((item) => ({ key: item.key, label: item.label, aliases: undefined, detail: item.description, meta: '', existingId: item.existingPropId, createNew: item.createNew })))
    .map((item) => {
      const matches = project ? motionComicAssetMatches(projectItems, { name: item.label, aliases: item.aliases, existingId: item.existingId, createNew: item.createNew }) : [];
      const canonical = matches.length === 1 ? matches[0] : undefined;
      const ambiguous = matches.length > 1 || Boolean(item.existingId && !canonical);
      const binding: Binding = !project ? 'local' : ambiguous ? 'pending' : canonical ? 'reuse' : 'new';
      return { ...item, matches, canonical, ambiguous, binding, path: referencePath(project, canonical?.referenceAssetVersionIds ?? []) };
    });
  const selected = items.find((item) => item.key === selectedKeys[kind]) ?? items[0];
  const character = kind === 'characters' ? script.characters.find((item) => item.key === selected?.key) : undefined;
  const location = kind === 'locations' ? script.sceneAssets.find((item) => item.key === selected?.key) : undefined;
  const prop = kind === 'props' ? script.props.find((item) => item.key === selected?.key) : undefined;
  const linked = selected?.existingId;
  const createNew = selected?.createNew;
  const matches = selected?.matches ?? [];
  const canonical = selected?.canonical;
  const canonicalCharacter = project?.characters.find((item) => item.id === canonical?.id);
  const ambiguous = Boolean(selected?.ambiguous);
  const choiceValue = linked ? `id:${linked}` : createNew ? 'new' : 'auto';
  const duplicateLabels = new Set(projectItems.map(item => item.label).filter((value, index, all) => all.indexOf(value) !== index));
  const optionLabel = (item: { id: string; label: string }) => duplicateLabels.has(item.label) ? `复用 · ${item.label} · ${item.id.slice(-6)}` : `复用 · ${item.label}`;
  const counts = { reuse: items.filter(item => item.binding === 'reuse').length, new: items.filter(item => item.binding === 'new').length, pending: items.filter(item => item.binding === 'pending').length };
  function setChoice(value: string) {
    const existingId = value.startsWith('id:') ? value.slice(3) : undefined;
    const newChoice = value === 'new' ? true : undefined;
    if (character) onChange?.({ ...script, characters: script.characters.map((item) => item.key === character.key ? { ...item, existingCharacterId: existingId, createNew: newChoice, looks: item.looks.map((look) => ({ ...look, existingLookId: undefined, createNew: undefined })) } : item) });
    if (location) onChange?.({ ...script, sceneAssets: script.sceneAssets.map((item) => item.key === location.key ? { ...item, existingSceneAssetId: existingId, createNew: newChoice } : item) });
    if (prop) onChange?.({ ...script, props: script.props.map((item) => item.key === prop.key ? { ...item, existingPropId: existingId, createNew: newChoice } : item) });
  }
  const referencedScenes = location ? script.scenes.filter((scene) => scene.locationKey === location.key) : [];
  return <div className="motion-comic-plan-review motion-comic-script-assets comic-script-assets-v2" data-kind={kind} aria-label={`本集${label}拆解`}>
    <aside className="motion-comic-plan-scenes" aria-label={`本集${label}列表`}>
      <div className="motion-comic-plan-pane-heading comic-script-assets-list-heading">
        <strong>{label} · {items.length}</strong>
        {project && items.length ? <small>{counts.reuse} 复用 · {counts.new} 新建{counts.pending ? ` · ${counts.pending} 待选` : ''}</small> : null}
      </div>
      <div className="motion-comic-plan-scene-list">
        {items.map((item) => <button type="button" key={item.key} className="comic-script-asset-row" title={item.label} aria-pressed={item.key === selected?.key} data-binding={item.binding} onClick={() => setSelectedKeys((current) => ({ ...current, [kind]: item.key }))}>
          <AssetAvatar path={item.path} label={item.label} icon={kind === 'characters' ? null : <Icon size={15} />} size="sm" resolveUrl={resolveReferenceUrl} />
          <span className="comic-script-asset-row__copy"><strong>{item.label}</strong><small>{item.detail || item.meta || '未填写描述'}</small></span>
          <span className="comic-script-asset-chip" data-binding={item.binding}>{bindingShort[item.binding]}</span>
        </button>)}
      </div>
    </aside>
    <section className="motion-comic-script-asset-detail" aria-label={`${label}定义`} key={`${kind}:${selected?.key}`}>
      {selected ? <>
        <header className="comic-script-asset-hero">
          <AssetAvatar path={selected.path} label={selected.label} icon={<Icon size={28} />} size="lg" resolveUrl={resolveReferenceUrl} />
          <div className="comic-script-asset-hero__copy">
            <div className="comic-script-asset-hero__title"><h2>{selected.label}</h2><span className="comic-script-asset-chip" data-binding={selected.binding}>{bindingLabels[selected.binding]}</span></div>
            {character?.role ? <p>{character.role}</p> : null}
            <div className="comic-script-asset-tags">
              {character?.aliases.map(alias => <span key={alias}>别名 · {alias}</span>)}
              {character ? <span><Shirt size={12} aria-hidden="true" />{character.looks.length} 套造型</span> : null}
              {location ? <span><Clapperboard size={12} aria-hidden="true" />{referencedScenes.length} 场引用</span> : null}
            </div>
          </div>
          {onOpenProjectAssets ? <Button variant="subtle" density="compact" className="comic-script-asset-hero__open" icon={<ArrowUpRight size={14} />} iconPosition="after" onClick={onOpenProjectAssets}>打开项目资产</Button> : null}
        </header>
        {project ? <section className="comic-script-asset-card comic-script-asset-binding" aria-label={`项目${label}身份`} data-binding={selected.binding}>
          <div className="comic-script-asset-card__heading"><strong>项目身份</strong><small>批准剧本时按此关联到项目资产库，跨集共用</small></div>
          <SelectField label={`项目${label}`} value={choiceValue} disabled={disabled || !onChange} validationMessage={ambiguous ? '存在多个匹配或资产已删除，请明确选择项目身份。' : undefined} options={[
            { value: 'auto', label: canonical ? `自动匹配 · ${canonical.label}` : matches.length > 1 ? `自动匹配 · ${matches.length} 项待选择` : '自动匹配 · 无匹配时新建' },
            { value: 'new', label: `新建独立${label}` },
            ...projectItems.map((item) => ({ value: `id:${item.id}`, label: optionLabel(item) })),
            ...(linked && !projectItems.some((item) => item.id === linked) ? [{ value: `id:${linked}`, label: '原项目资产已删除' }] : []),
          ]} onChange={(event) => setChoice(event.target.value)} />
          {canonical ? <div className="comic-script-canonical" title={canonical.id}><span>项目统一定义</span><p>{canonicalCharacter?.identityPrompt ?? ('description' in canonical ? canonical.description : '') ?? ''}</p></div> : null}
        </section> : null}
        <section className="comic-script-asset-card" aria-label={`本集${label}设定`}>
          <div className="comic-script-asset-card__heading"><strong>本集设定</strong><small>来自本集剧本拆解</small></div>
          <dl className="comic-script-asset-fields">
            {character ? <>
              <Field label="身份特征" value={character.identityPrompt} wide />
              <Field label="性格" value={character.personality} />
              <Field label="声音" value={character.voiceNotes} />
            </> : null}
            {location || prop ? <>
              <Field label="描述" value={(location ?? prop)!.description} wide />
              <Field label="视觉定义" value={(location ?? prop)!.prompt} wide />
            </> : null}
            {location ? <Field label="连续性" value={location.continuityNotes} wide /> : null}
          </dl>
        </section>
        {character?.looks.length ? <div className="comic-script-asset-section-title"><strong>造型</strong><span>{character.looks.length}</span></div> : null}
        {character?.looks.map((look) => <section className="comic-script-asset-card motion-comic-script-asset-look" key={look.key} aria-label={`造型 ${look.label}`}>
          <div className="comic-script-asset-card__heading"><strong><Shirt size={14} aria-hidden="true" />{look.label}</strong></div>
          {project ? <div className="comic-script-asset-look-binding"><SelectField label={`${look.label}的项目造型`} value={look.existingLookId ? `id:${look.existingLookId}` : look.createNew ? 'new' : 'auto'} disabled={disabled || !onChange || ambiguous} options={[
            { value: 'auto', label: '自动匹配 · 无匹配时新建造型' }, { value: 'new', label: '新建独立造型' },
            ...(canonicalCharacter?.looks ?? []).map((item) => ({ value: `id:${item.id}`, label: `复用 · ${item.label}` })),
            ...(look.existingLookId && !canonicalCharacter?.looks.some((item) => item.id === look.existingLookId) ? [{ value: `id:${look.existingLookId}`, label: '原造型不属于当前人物' }] : []),
          ]} onChange={(event) => { const value = event.target.value; onChange?.({ ...script, characters: script.characters.map((item) => item.key === character.key ? { ...item, existingCharacterId: canonicalCharacter?.id, looks: item.looks.map((entry) => entry.key === look.key ? { ...entry, existingLookId: value.startsWith('id:') ? value.slice(3) : undefined, createNew: value === 'new' ? true : undefined } : entry) } : item) }); }} /></div> : null}
          <dl className="comic-script-asset-fields">
            <Field label="外貌" value={look.appearancePrompt} wide />
            <Field label="服装" value={look.wardrobe} />
            <Field label="连续性" value={look.continuityNotes} />
          </dl>
        </section>)}
        {location ? <section className="comic-script-asset-card" aria-label="引用场次">
          <div className="comic-script-asset-card__heading"><strong>引用场次</strong><small>点击跳到分幕分场</small></div>
          {referencedScenes.length ? <div className="comic-script-asset-scenes">{referencedScenes.map((scene) => <Button key={scene.key} variant="subtle" density="compact" icon={<Clapperboard size={13} />} onClick={() => onOpenScene(scene.key)}>{scene.title}</Button>)}</div> : <p className="comic-script-asset-muted">本集暂无场次引用此场景。</p>}
        </section> : null}
      </> : <div className="motion-comic-plan-empty"><Icon size={24} /><strong>本集未提取{label}</strong></div>}
    </section>
  </div>;
}
