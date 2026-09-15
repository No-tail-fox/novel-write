import { rebuildEditorialTimeline, type EditorialCollagePipelineData } from './editorial-collage';
import { editorialRecipe, type EditorialRecipeId } from './editorial-recipe-catalog';
import { createVoxAnimation } from './vox-animation';
import { editorialShotNarration, editorialShotTitle } from './editorial-storytelling';

export function applyEditorialRecipe(document: EditorialCollagePipelineData, shotId: string, recipeId?: EditorialRecipeId): EditorialCollagePipelineData {
  const recipe = editorialRecipe(recipeId);
  return rebuildEditorialTimeline({ ...document, beats: document.beats.map(beat => ({ ...beat, shots: beat.shots.map(shot => {
    if (shot.id !== shotId || shot.productionRecipe === recipeId) return shot;
    if (!recipe) return { ...shot, productionRecipe: undefined, lastFrameAssetVersionId: undefined, videoAssetVersionId: undefined, videoJobId: undefined };
    const narration = editorialShotNarration(beat, shot);
    let animation = shot.animation;
    if (recipe.id === 'vox-narrated') {
      animation = animation ?? createVoxAnimation(editorialShotTitle(document, beat, shot), narration);
      animation = { ...animation, template: { id: shot.animation?.template.id ?? 'paper-actors', props: { ...animation.template.props,
        assetIds: animation.template.props.assetIds.length ? animation.template.props.assetIds : shot.layers.flatMap(layer => layer.assetVersionId ?? []),
      } }, code: { ...animation.code, prompt: animation.code.prompt || `制作编辑式纸片拼贴动画。${narration}\n背景、主体和证据独立运动。读取 props.cues 及 tokens 的 startMs/endMs，以中文或英文触发词的真实时间对齐动作；无时间戳时按句顺序均匀编排，不伪造逐词时间。` } };
    }
    return { ...shot, productionRecipe: recipe.id, renderStrategy: recipe.engine, motionPrompt: recipe.motionPrompt, animation,
      lastFrameAssetVersionId: recipe.id === 'nantian' ? shot.lastFrameAssetVersionId : undefined,
      videoAssetVersionId: undefined, videoJobId: undefined };
  }) })) });
}

export function setEditorialLastFrame(document: EditorialCollagePipelineData, shotId: string, assetId: string): EditorialCollagePipelineData {
  if (assetId && !document.assets.some(asset => asset.id === assetId && asset.kind === 'image' && asset.localPath)) throw new Error('请选择当前项目中可读取的尾帧图片。');
  return rebuildEditorialTimeline({ ...document, beats: document.beats.map(beat => ({ ...beat, shots: beat.shots.map(shot => shot.id === shotId && shot.lastFrameAssetVersionId !== (assetId || undefined)
    ? { ...shot, lastFrameAssetVersionId: assetId || undefined, videoAssetVersionId: undefined, videoJobId: undefined } : shot) })) });
}

export function setEditorialRecipeKeyframe(document: EditorialCollagePipelineData, shotId: string, assetId: string): EditorialCollagePipelineData {
  if (assetId && !document.assets.some(asset => asset.id === assetId && asset.kind === 'image' && asset.localPath)) throw new Error('请选择当前项目中可读取的原画。');
  return rebuildEditorialTimeline({ ...document, beats: document.beats.map(beat => ({ ...beat, shots: beat.shots.map(shot => shot.id === shotId && shot.keyframeAssetVersionId !== (assetId || undefined)
    ? { ...shot, keyframeAssetVersionId: assetId || undefined, videoAssetVersionId: undefined, videoJobId: undefined,
      layers: shot.productionRecipe === 'paper-cut' ? shot.layers.map(layer => layer.content || layer.source === 'local-file' ? layer : { ...layer, assetVersionId: undefined }) : shot.layers,
    } : shot) })) });
}
