import { useState } from 'react';
import { MapPin, Package, Users } from 'lucide-react';
import type { MotionComicScriptDraft } from '../../shared/motion-comic-planning';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { motionComicAssetMatches } from '../../shared/motion-comic-script-assets';
import { Button, SelectField } from '../../ui';

type AssetKind = 'characters' | 'locations' | 'props';

export function MotionComicScriptAssets({ script, project, kind, disabled, onChange, onOpenScene, onOpenProjectAssets }: {
  script: MotionComicScriptDraft;
  project?: MotionComicPipelineData;
  disabled?: boolean;
  onChange?: (script: MotionComicScriptDraft) => void;
  onOpenProjectAssets?: () => void;
  kind: AssetKind;
  onOpenScene: (key: string) => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<Partial<Record<AssetKind, string>>>({});
  const items = kind === 'characters' ? script.characters.map((item) => ({ key: item.key, label: item.name, detail: `${item.role} · ${item.looks.length} 套造型` }))
    : kind === 'locations' ? script.sceneAssets.map((item) => ({ key: item.key, label: item.label, detail: `${script.scenes.filter((scene) => scene.locationKey === item.key).length} 场引用` }))
      : script.props.map((item) => ({ key: item.key, label: item.label, detail: item.description }));
  const selected = items.find((item) => item.key === selectedKeys[kind]) ?? items[0];
  const character = kind === 'characters' ? script.characters.find((item) => item.key === selected?.key) : undefined;
  const location = kind === 'locations' ? script.sceneAssets.find((item) => item.key === selected?.key) : undefined;
  const prop = kind === 'props' ? script.props.find((item) => item.key === selected?.key) : undefined;
  const label = kind === 'characters' ? '人物' : kind === 'locations' ? '场景' : '道具';
  const Icon = kind === 'characters' ? Users : kind === 'locations' ? MapPin : Package;
  const linked = character?.existingCharacterId ?? location?.existingSceneAssetId ?? prop?.existingPropId;
  const createNew = character?.createNew ?? location?.createNew ?? prop?.createNew;
  const projectItems: Array<{ id: string; label: string; aliases?: string[]; description?: string }> = kind === 'characters' ? (project?.characters ?? []).map((item) => ({ ...item, label: item.name })) : kind === 'locations' ? project?.sceneAssets ?? [] : project?.props ?? [];
  const matches = selected ? motionComicAssetMatches(projectItems, { name: selected.label, aliases: character?.aliases, existingId: linked, createNew }) : [];
  const canonical = matches.length === 1 ? matches[0] : undefined;
  const canonicalCharacter = project?.characters.find((item) => item.id === canonical?.id);
  const ambiguous = matches.length > 1 || Boolean(linked && !canonical);
  const choiceValue = linked ? `id:${linked}` : createNew ? 'new' : 'auto';
  function setChoice(value: string) {
    const existingId = value.startsWith('id:') ? value.slice(3) : undefined;
    const newChoice = value === 'new' ? true : undefined;
    if (character) onChange?.({ ...script, characters: script.characters.map((item) => item.key === character.key ? { ...item, existingCharacterId: existingId, createNew: newChoice, looks: item.looks.map((look) => ({ ...look, existingLookId: undefined, createNew: undefined })) } : item) });
    if (location) onChange?.({ ...script, sceneAssets: script.sceneAssets.map((item) => item.key === location.key ? { ...item, existingSceneAssetId: existingId, createNew: newChoice } : item) });
    if (prop) onChange?.({ ...script, props: script.props.map((item) => item.key === prop.key ? { ...item, existingPropId: existingId, createNew: newChoice } : item) });
  }
  return <div className="motion-comic-plan-review motion-comic-script-assets" aria-label={`本集${label}拆解`}>
    <aside className="motion-comic-plan-scenes" aria-label={`本集${label}列表`}>
      <div className="motion-comic-plan-pane-heading"><strong>{label} · {items.length}</strong></div>
      <div className="motion-comic-plan-scene-list">
        {items.map((item) => <Button key={item.key} variant="subtle" className="motion-comic-plan-scene" title={item.label} aria-pressed={item.key === selected?.key} onClick={() => setSelectedKeys((current) => ({ ...current, [kind]: item.key }))}>
          <span><Icon size={14} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span>
        </Button>)}
      </div>
    </aside>
    <section className="motion-comic-script-asset-detail" aria-label={`${label}定义`} key={`${kind}:${selected?.key}`}>
      {selected ? <>
        <div className="motion-comic-plan-pane-heading"><span><strong>{selected.label}</strong><small>{project ? ambiguous ? '资产待选择' : canonical ? '复用项目资产' : '批准时新建项目资产' : linked ? '已关联项目资产' : '本集提取'}</small></span></div>
        {project ? <div className="comic-script-asset-binding">
          <SelectField label={`项目${label}`} value={choiceValue} disabled={disabled || !onChange} validationMessage={ambiguous ? '存在多个匹配或资产已删除，请明确选择项目身份。' : undefined} options={[
            { value: 'auto', label: canonical ? `自动匹配 · ${canonical.label}` : matches.length > 1 ? `自动匹配 · ${matches.length} 项待选择` : '自动匹配 · 无匹配时新建' },
            { value: 'new', label: `新建独立${label}` },
            ...projectItems.map((item) => ({ value: `id:${item.id}`, label: `复用 · ${item.label} · ${item.id}` })),
            ...(linked && !projectItems.some((item) => item.id === linked) ? [{ value: `id:${linked}`, label: '原项目资产已删除' }] : []),
          ]} onChange={(event) => setChoice(event.target.value)} />
          {canonical ? <div className="comic-script-canonical"><strong>项目统一定义 · {canonical.label}</strong><small>{canonical.id}</small><p>{canonicalCharacter?.identityPrompt ?? ('description' in canonical ? canonical.description : '')}</p></div> : null}
          {onOpenProjectAssets ? <Button variant="subtle" onClick={onOpenProjectAssets}>打开项目资产</Button> : null}
        </div> : null}
        <dl>
          {character ? <>
            <div><dt>角色定位</dt><dd>{character.role}</dd></div>
            <div><dt>别名</dt><dd>{character.aliases.join('、') || '无'}</dd></div>
            <div><dt>身份特征</dt><dd>{character.identityPrompt}</dd></div>
            <div><dt>性格</dt><dd>{character.personality}</dd></div>
            <div><dt>声音</dt><dd>{character.voiceNotes}</dd></div>
          </> : null}
          {location || prop ? <>
            <div><dt>描述</dt><dd>{(location ?? prop)!.description}</dd></div>
            <div><dt>视觉定义</dt><dd>{(location ?? prop)!.prompt}</dd></div>
          </> : null}
          {location ? <div><dt>连续性</dt><dd>{location.continuityNotes}</dd></div> : null}
        </dl>
        {character?.looks.map((look) => <section className="motion-comic-script-asset-look" key={look.key}>
          <h3>{look.label}</h3>
          {project ? <div className="comic-script-asset-binding"><SelectField label={`${look.label}的项目造型`} value={look.existingLookId ? `id:${look.existingLookId}` : look.createNew ? 'new' : 'auto'} disabled={disabled || !onChange || ambiguous} options={[
            { value: 'auto', label: '自动匹配 · 无匹配时新建造型' }, { value: 'new', label: '新建独立造型' },
            ...(canonicalCharacter?.looks ?? []).map((item) => ({ value: `id:${item.id}`, label: `复用 · ${item.label}` })),
            ...(look.existingLookId && !canonicalCharacter?.looks.some((item) => item.id === look.existingLookId) ? [{ value: `id:${look.existingLookId}`, label: '原造型不属于当前人物' }] : []),
          ]} onChange={(event) => { const value = event.target.value; onChange?.({ ...script, characters: script.characters.map((item) => item.key === character.key ? { ...item, existingCharacterId: canonicalCharacter?.id, looks: item.looks.map((entry) => entry.key === look.key ? { ...entry, existingLookId: value.startsWith('id:') ? value.slice(3) : undefined, createNew: value === 'new' ? true : undefined } : entry) } : item) }); }} /></div> : null}
          <dl>
            <div><dt>外貌</dt><dd>{look.appearancePrompt}</dd></div>
            <div><dt>服装</dt><dd>{look.wardrobe}</dd></div>
            <div><dt>连续性</dt><dd>{look.continuityNotes}</dd></div>
          </dl>
        </section>)}
        {location ? <section className="motion-comic-script-asset-look"><h3>引用场次</h3>
          {script.scenes.filter((scene) => scene.locationKey === location.key).map((scene) => <Button key={scene.key} variant="subtle" onClick={() => onOpenScene(scene.key)}>{scene.title}</Button>)}
        </section> : null}
      </> : <div className="motion-comic-plan-empty"><Icon size={24} /><strong>本集未提取{label}</strong></div>}
    </section>
  </div>;
}
