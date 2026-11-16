import { MapPin, Package, Users } from 'lucide-react';
import type { MotionComicDramaticScene, MotionComicPipelineData } from '../../shared/motion-comic';
import { Button } from '../../ui';
import { ScenePreview, type SceneMediaResolver } from './MotionComicScenePreview';

export function MotionComicSceneReferences({ document, scene, resolveUrl, onOpenAssets, disabled }: { document: MotionComicPipelineData; scene: MotionComicDramaticScene; resolveUrl?: SceneMediaResolver; onOpenAssets?: () => void; disabled: boolean }) {
  const lookIds = new Set(scene.shots.flatMap(shot => shot.characterLookIds));
  const sceneIds = new Set(scene.shots.map(shot => shot.sceneAssetId));
  const propIds = new Set(scene.shots.flatMap(shot => shot.propAssetIds));
  const characters = document.characters.flatMap(character => character.looks.filter(look => lookIds.has(look.id)).map(look => ({ id: look.id, label: character.name, detail: look.label, refs: look.referenceAssetVersionIds })));
  const locations = document.sceneAssets.filter(asset => sceneIds.has(asset.id)).map(asset => ({ id: asset.id, label: asset.label, detail: '场景参考', refs: asset.referenceAssetVersionIds }));
  const props = document.props.filter(asset => propIds.has(asset.id)).map(asset => ({ id: asset.id, label: asset.label, detail: '道具参考', refs: asset.referenceAssetVersionIds }));
  const assetFor = (ids: string[]) => ids.map(id => document.assets.find(asset => asset.id === id && asset.kind === 'image')).find(asset => asset?.localPath || asset?.uri);
  const reference = locations.map(item => assetFor(item.refs)).find(Boolean);
  return <aside className="comic-scene-references" aria-label="当前场次引用">
    <h2>当前场次引用</h2>
    {[{ label: '人物', icon: <Users size={14} />, items: characters }, { label: '场景', icon: <MapPin size={14} />, items: locations }, { label: '道具', icon: <Package size={14} />, items: props }].map(group => <section key={group.label}>
      <h3>{group.icon}{group.label}<small>{group.items.length}</small></h3>
      {group.items.length ? group.items.map(item => { const asset = assetFor(item.refs); return <div key={item.id} className="comic-scene-references__item"><ScenePreview path={asset?.localPath || asset?.uri} label={`${item.label}参考图`} resolveUrl={resolveUrl} compact emptyLabel="暂无参考图" /><span><strong>{item.label}</strong><small>{item.detail}</small></span></div>; }) : <p className="comic-scene-references__empty">本场暂无{group.label}引用</p>}
    </section>)}
    <section className="comic-scene-references__preview"><h3>参考图</h3><ScenePreview path={reference?.localPath || reference?.uri} label="当前场次场景参考图" resolveUrl={resolveUrl} emptyLabel="关联场景参考图后在此查看" /></section>
    {onOpenAssets ? <Button variant="subtle" density="compact" disabled={disabled} onClick={onOpenAssets}>管理项目资产</Button> : null}
  </aside>;
}
