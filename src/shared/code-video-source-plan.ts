import { codeVideoPolicySchema, newCodeVideoPolicy, type CodeVideoPolicy } from './creative-animation/production-policy';
import { editorialCueReadingMs } from './editorial-script';
import type { EditorialCollagePipelineData } from './editorial-collage';
import { resolveProductionAudioClips } from './production-audio';

export interface CodeVideoSourceSegment {
  index: number;
  /** UTF-16 offsets into the unchanged input, end exclusive. */
  start: number;
  end: number;
  text: string;
  estimatedDurationMs: number;
}
export interface CodeVideoSourcePlan {
  policy: CodeVideoPolicy;
  estimatedDurationMs: number;
  requiresAction: boolean;
  segments: CodeVideoSourceSegment[];
  /** Instructions for a caller's already configured rewrite request; never executes one. */
  condenseInstructions?: string;
}

export function codeVideoCondenseInstructions(targetDurationSeconds: number): string {
  codeVideoPolicySchema.parse({ ...newCodeVideoPolicy(), targetDurationSeconds });
  return `将原稿改写为目标 ${targetDurationSeconds} 秒内可自然朗读的简短摘要。保留核心结论、关键事实、数字、因果关系、来源归属和必要限定；不得编造事实或改变原意。删除重复与次要例子，不得靠加速语音或截断音频满足时长。输出完整、连贯的旁白，供用户审核后再生成配音。`;
}

/** Free, deterministic planning. It neither rewrites the source nor touches audio.
 * Estimates are planning bounds, not a guarantee of the eventual TTS clock.
 */
export function planCodeVideoSource(sourceText: string, inputPolicy: CodeVideoPolicy = newCodeVideoPolicy()): CodeVideoSourcePlan {
  const policy = codeVideoPolicySchema.parse(inputPolicy);
  if (!/[\p{L}\p{N}]/u.test(sourceText)) throw new Error('CODE_VIDEO_SOURCE_EMPTY: 请填写可朗读的文案。');
  const budgetMs = policy.targetDurationSeconds * 1000;
  const estimatedDurationMs = editorialCueReadingMs(sourceText);
  const segments: CodeVideoSourceSegment[] = [];
  const boundaries = [0, ...Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(sourceText), part => part.index + part.segment.length)];
  const wordEnds = new Set(Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(sourceText), part => part.index + part.segment.length));
  let cursor = 0;
  while (cursor < boundaries.length - 1) {
    const start = boundaries[cursor];
    let low = cursor + 1, high = boundaries.length - 1, best = cursor;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (editorialCueReadingMs(sourceText.slice(start, boundaries[mid])) <= budgetMs) { best = mid; low = mid + 1; }
      else high = mid - 1;
    }
    if (best === cursor) throw new Error('CODE_VIDEO_SOURCE_UNIT_TOO_LONG: 单个字符组合超过目标时长，请整理原稿。');
    if (best < boundaries.length - 1) {
      const minimum = cursor + Math.max(1, Math.floor((best - cursor) / 2));
      const candidates = Array.from({ length: best - minimum + 1 }, (_, i) => best - i);
      best = candidates.find(i => /[。！？!?；;\n][”’」』）】》"']*\s*$/u.test(sourceText.slice(start, boundaries[i])))
        ?? candidates.find(i => wordEnds.has(boundaries[i])) ?? best;
    }
    const end = boundaries[best], text = sourceText.slice(start, end);
    segments.push({ index: segments.length + 1, start, end, text, estimatedDurationMs: editorialCueReadingMs(text) });
    cursor = best;
  }
  return { policy, estimatedDurationMs, requiresAction: estimatedDurationMs > budgetMs, segments,
    ...(policy.longTextMode === 'condense' ? { condenseInstructions: codeVideoCondenseInstructions(policy.targetDurationSeconds) } : {}) };
}

/** Gate the actual authored narration before TTS, not just the original source.
 * A reviewed condensed script may legitimately be shorter than its source.
 */
export function codeVideoSourcePreflightErrors(document: EditorialCollagePipelineData, policy?: CodeVideoPolicy): string[] {
  if (!policy) return [];
  const shots = document.beats.flatMap(beat => beat.shots).filter(shot => !shot.narrationSplit || shot.narrationSplit.sourceShotId === shot.id);
  const narration = shots.map(shot => document.beats.flatMap(beat => beat.subtitleCues).filter(cue => shot.subtitleCueIds.includes(cue.id)).map(cue => cue.text).join(' '));
  const voicedShots = shots.filter((_, index) => /[\p{L}\p{N}]/u.test(narration[index]));
  const measuredAssets = voicedShots.map(shot => document.assets.find(asset => asset.id === shot.voiceAssetVersionId && asset.kind === 'audio' && asset.durationMs && asset.durationMs > 0));
  if (measuredAssets.length && measuredAssets.every(asset => !!asset)) {
    const assetIds = new Set(measuredAssets.map(asset => asset!.id));
    const clips = document.timeline?.audioClips?.filter(clip => assetIds.has(clip.assetVersionId));
    const resolved = document.timeline && clips?.length ? resolveProductionAudioClips(clips, new Map(document.assets.map(asset => [asset.id, asset])), document.timeline.durationMs) : [];
    const measuredMs = resolved.length
      ? Math.max(...resolved.map(clip => clip.startMs + clip.durationMs))
      : [...new Map(measuredAssets.map(asset => [asset!.id, asset!])).values()].reduce((sum, asset) => sum + asset.durationMs!, 0);
    if (measuredMs <= policy.targetDurationSeconds * 1100) return [];
    return [`CODE_VIDEO_AUDIO_OVER_TARGET: 已有完整配音共 ${Math.ceil(measuredMs / 1000)} 秒，超过目标 ${policy.targetDurationSeconds} 秒的 10% 容差。请提高目标时长或另建项目分段、精简并审核旁白后重新配音；不会截断已有音频。`];
  }
  if (!narration.some(text => /[\p{L}\p{N}]/u.test(text))) return [];
  const plan = planCodeVideoSource(narration.join('\n'), policy);
  // Each TTS request has its own reading floor; do not hide many tiny requests in a global estimate.
  const estimate = narration.filter(text => /[\p{L}\p{N}]/u.test(text)).reduce((sum, text) => sum + editorialCueReadingMs(text), 0);
  if (!plan.requiresAction && estimate <= policy.targetDurationSeconds * 1000) return [];
  const prefix = `CODE_VIDEO_SOURCE_OVER_TARGET: 当前旁白估算约 ${Math.ceil(Math.max(estimate, plan.estimatedDurationMs) / 1000)} 秒，超过目标 ${policy.targetDurationSeconds} 秒；已在本次配音请求前停止。`;
  if (policy.longTextMode === 'condense') return [`${prefix} 请先将文案精简并重新创建、审核分镜，再开始制作。${plan.condenseInstructions}`];
  const source = document.sourceText?.trim() ? document.sourceText : narration.join('\n');
  const split = planCodeVideoSource(source, policy);
  const ranges = split.segments.slice(0, 20).map(segment => `第 ${segment.index} 段：原稿字符 ${segment.start + 1}–${segment.end}，约 ${Math.ceil(segment.estimatedDurationMs / 1000)} 秒`).join('；');
  return [`${prefix} 请按以下原稿范围分别创建项目并审核分镜，保留全部原文；当前制作不会自动创建多部影片。共 ${split.segments.length} 段${split.segments.length > 20 ? '（此处仅显示前 20 段）' : ''}：${ranges}。若原稿与分镜不同，请先同步旁白。`];
}
