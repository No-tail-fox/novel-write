import { useState } from 'react';
import { Button, SelectField } from '../../ui';
import { EDITORIAL_RECIPES, editorialRecipe, type EditorialRecipeId } from '../../shared/editorial-recipe-catalog';
import { editorialKeyframeAssetId, editorialVideoFrames } from '../../shared/editorial-media';
import type { EditorialCollagePipelineData } from '../../shared/editorial-collage';
import { toLocalImageUrl } from '../tasks/task-formatters';

export function EditorialRecipeInspector({ document, shotId, busy, onRecipe, onKeyframe, onLastFrame, onImport }: {
  document: EditorialCollagePipelineData; shotId: string; busy: boolean;
  onRecipe: (id?: EditorialRecipeId) => void; onKeyframe: (assetId: string) => void; onLastFrame: (assetId: string) => void; onImport: () => Promise<void>;
}) {
  const [importing, setImporting] = useState(false), [error, setError] = useState('');
  const shots = document.beats.flatMap(beat => beat.shots), index = shots.findIndex(shot => shot.id === shotId), shot = shots[index];
  if (!shot) return null;
  const recipe = editorialRecipe(shot.productionRecipe), frames = editorialVideoFrames(document, shot);
  const images = document.assets.filter(asset => asset.kind === 'image' && asset.localPath);
  const options = images.map((asset, i) => {
    const owner = shots.find(item => item.keyframeAssetVersionId === asset.id || item.layers.some(layer => layer.assetVersionId === asset.id));
    const layer = owner?.layers.find(item => item.assetVersionId === asset.id);
    const label = asset.provider === 'local-import' ? asset.prompt || '导入图片' : `${owner?.title || '镜头'} · ${layer?.label || '构图原画'}`;
    return { value: asset.id, label: `${i + 1} · ${label.slice(0, 48)}` };
  });
  const nextId = shots[index + 1] ? editorialKeyframeAssetId(shots[index + 1]) : undefined;
  const canUseNext = Boolean(nextId && images.some(asset => asset.id === nextId));
  const showFrames = recipe?.id === 'paper-cut' || shot.renderStrategy === 'living-poster';
  return <section className="editorial-recipe" aria-label="镜头制作方式">
    <SelectField label="制作方式" value={shot.productionRecipe ?? ''} disabled={busy || importing} options={[{ value: '', label: '自定义制作' }, ...EDITORIAL_RECIPES.map(item => ({ value: item.id, label: item.label }))]} onChange={event => onRecipe(event.target.value as EditorialRecipeId || undefined)} />
    {recipe ? <p className="editorial-recipe__hint">{recipe.description}</p> : null}
    {showFrames ? <>
      <SelectField label={recipe?.id === 'paper-cut' ? '构图原画' : '首帧图片'} value={shot.keyframeAssetVersionId ?? ''} disabled={busy || importing} options={[{ value: '', label: '使用生成的关键帧' }, ...options]} onChange={event => onKeyframe(event.target.value)} />
      {shot.renderStrategy === 'living-poster' ? <>
        <SelectField label="尾帧图片" value={shot.lastFrameAssetVersionId ?? ''} disabled={busy || importing} options={[{ value: '', label: recipe?.id === 'nantian' ? '请选择尾帧（必填）' : '不指定尾帧' }, ...options]} onChange={event => onLastFrame(event.target.value)} />
        <Button density="compact" variant="subtle" disabled={busy || importing || !canUseNext} onClick={() => nextId && onLastFrame(nextId)}>使用下一镜头关键帧</Button>
      </> : null}
      <div className="editorial-recipe__frames">{[{ label: recipe?.id === 'paper-cut' ? '构图原画' : '首帧', asset: frames.first }, ...(shot.renderStrategy === 'living-poster' ? [{ label: '尾帧', asset: frames.last }] : [])].map(({ label, asset }) => <figure key={label}>{asset?.localPath ? <img src={toLocalImageUrl(asset.localPath)} alt={`${label}预览`} /> : <div className="editorial-recipe__empty">待选择</div>}<figcaption>{label}</figcaption></figure>)}</div>
      <Button density="compact" variant="secondary" disabled={busy || importing} onClick={async () => { setError(''); setImporting(true); try { await onImport(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setImporting(false); } }}>{importing ? '正在导入…' : '导入原画 / 尾帧'}</Button>
      {shot.renderStrategy === 'living-poster' && frames.unavailableReason ? <p className="editorial-recipe__hint" role="status">{frames.unavailableReason}</p> : null}
    </> : null}
    {error ? <p className="editorial-recipe__error" role="alert">{error}</p> : null}
  </section>;
}
