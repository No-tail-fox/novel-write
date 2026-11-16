import type { DirectorShot } from '../director-desk/DirectorDeskWorkspace';
import { invalidateMotionComicShotVideo, updateMotionComicShotDuration, type MotionComicPipelineData, type MotionComicShot } from '../../shared/motion-comic';
import { invalidateDirectorShotSpeech, setDirectorShotNarration } from '../../shared/director-subtitle-structure';

/** Resolve comparisons inside the mutation, never against a previous React render. */
export function updateMotionComicMakeShot(current: MotionComicPipelineData, id: string, update: Partial<DirectorShot> & Pick<Partial<MotionComicShot>, 'continuity'>): MotionComicPipelineData {
  const episode = current.episodes.find(item => item.scenes.some(scene => scene.shots.some(shot => shot.id === id)));
  const before = episode?.scenes.flatMap(scene => scene.shots).find(shot => shot.id === id);
  if (!episode || !before) return current;
  if (current.sourceDocument && update.renderStrategy !== undefined && update.renderStrategy !== 'living-poster') throw new Error('导入剧本创建的 AI 漫剧只允许使用远程视频 API。');
  const subtitle = before.dialogueCueIds.map(cueId => episode.dialogueCues.find(cue => cue.id === cueId)?.text ?? '').join('\n');
  const strategy = update.renderStrategy === undefined ? before.renderStrategy : update.renderStrategy === 'living-poster' ? 'remote-video' as const : 'image-motion' as const;
  const invalidatesVideo = (update.prompt !== undefined && update.prompt !== before.prompt)
    || (update.motionPrompt !== undefined && update.motionPrompt !== before.motionPrompt)
    || (update.subtitle !== undefined && update.subtitle !== subtitle)
    || (update.framing !== undefined && update.framing !== before.framing)
    || (update.durationMs !== undefined && update.durationMs !== before.durationMs)
    || strategy !== before.renderStrategy || Object.prototype.hasOwnProperty.call(update, 'continuity');
  let base = update.durationMs !== undefined && update.durationMs !== before.durationMs
    ? updateMotionComicShotDuration(current, episode.id, id, update.durationMs) : current;
  if ((update.voiceId !== undefined && update.voiceId !== before.voiceId) || (update.voiceSpeed !== undefined && update.voiceSpeed !== before.voiceSpeed)) base = invalidateDirectorShotSpeech(base, id);
  const next: MotionComicPipelineData = { ...base, episodes: base.episodes.map(item => ({ ...item, scenes: item.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => shot.id !== id ? shot : ({
    ...shot, title: update.title ?? shot.title, prompt: update.prompt ?? shot.prompt, motionPrompt: update.motionPrompt ?? shot.motionPrompt,
    framing: update.framing ?? shot.framing, continuity: Object.prototype.hasOwnProperty.call(update, 'continuity') ? update.continuity : shot.continuity,
    durationMs: update.durationMs ?? shot.durationMs, voiceId: update.voiceId ?? shot.voiceId, voiceLabel: update.voice ?? shot.voiceLabel,
    voiceSpeed: update.voiceSpeed ?? shot.voiceSpeed, layoutTemplate: update.layoutTemplate ?? shot.layoutTemplate, motionPreset: update.motionPreset ?? shot.motionPreset,
    subtitleStyle: update.subtitleStyle ?? shot.subtitleStyle, seed: update.seed ?? shot.seed, seedLocked: update.seedLocked ?? shot.seedLocked, renderStrategy: strategy,
  })) })) })) };
  const withDialogue = update.subtitle !== undefined && update.subtitle !== subtitle ? setDirectorShotNarration(next, id, update.subtitle) : next;
  return invalidatesVideo ? invalidateMotionComicShotVideo(withDialogue, id) : withDialogue;
}

/** Scene is exclusive; character looks and props are independent selections. */
export function toggleMotionComicMakeAsset(current: MotionComicPipelineData, shotId: string, assetId: string): MotionComicPipelineData {
  let changed = false;
  const next = { ...current, episodes: current.episodes.map(episode => ({ ...episode, scenes: episode.scenes.map(scene => ({ ...scene, shots: scene.shots.map(shot => {
    if (shot.id !== shotId) return shot;
    if (current.characters.some(character => character.looks.some(look => look.id === assetId))) {
      changed = true;
      return { ...shot, characterLookIds: shot.characterLookIds.includes(assetId) ? shot.characterLookIds.filter(id => id !== assetId) : [...shot.characterLookIds, assetId] };
    }
    if (current.sceneAssets.some(asset => asset.id === assetId)) {
      if (shot.sceneAssetId === assetId) return shot;
      changed = true;
      return { ...shot, sceneAssetId: assetId };
    }
    if (current.props.some(asset => asset.id === assetId)) {
      changed = true;
      return { ...shot, propAssetIds: shot.propAssetIds.includes(assetId) ? shot.propAssetIds.filter(id => id !== assetId) : [...shot.propAssetIds, assetId] };
    }
    return shot;
  }) })) })) };
  return changed ? invalidateMotionComicShotVideo(next, shotId) : current;
}
