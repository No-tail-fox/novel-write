import { createEditorialCollageDraft, parseEditorialCollagePipelineData, rebuildEditorialTimeline, type EditorialCollagePipelineData, type EditorialCollageShot, type EditorialCollageBeat, type EditorialSubtitleCue } from './editorial-collage';
import { planMusicMvLyrics } from './music-mv-plan';
import { creativeStyle } from './creative-animation/styles';
import { voxProductionSettingsSchema } from './vox-production';
import type { CreateTaskInput, MusicMvSettings } from './types';

function planMusicMvShotBoundaries(durationMs: number, shotCount: number, lyricStartsMs: number[]): number[] {
  const boundaries = [0];
  const spacing = durationMs / shotCount;
  for (let index = 1; index < shotCount; index++) {
    const previous = boundaries.at(-1)!;
    const remainingShots = shotCount - index;
    const min = Math.max(previous + 1, durationMs - remainingShots * 15_000);
    const max = Math.min(durationMs - remainingShots, previous + 15_000);
    const target = Math.max(min, Math.min(max, Math.round(spacing * index)));
    const tolerance = Math.max(1_500, Math.min(3_000, spacing * 0.35));
    const lyricBoundary = [...new Set(lyricStartsMs)]
      .filter(start => start >= min && start <= max)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    boundaries.push(lyricBoundary !== undefined && Math.abs(lyricBoundary - target) <= tolerance ? lyricBoundary : target);
  }
  boundaries.push(durationMs);
  return boundaries;
}

export function createMusicMvDocument(id: string, input: CreateTaskInput, audioDurationMs: number, now: string, lyricTimingSource: 'manual' | 'provider' = 'manual'): EditorialCollagePipelineData {
  const music: MusicMvSettings = { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '', ...input.musicMv };
  if (!music.audioPath.trim()) throw new Error('MUSIC_MV_AUDIO_REQUIRED: 请先选择主歌曲。');
  if (!Number.isFinite(audioDurationMs) || audioDurationMs < 1000 || audioDurationMs > 120 * 60_000) throw new Error('MUSIC_MV_DURATION: 歌曲时长必须在 1 秒到 120 分钟之间。');
  const plan = planMusicMvLyrics(input.inputText, music, audioDurationMs, lyricTimingSource);
  const ratio = input.ratio ?? '16:9';
  if (!['9:16', '16:9', '1:1', '4:3'].includes(ratio)) throw new Error('MUSIC_MV_RATIO: 不支持此画幅。');
  const style = creativeStyle(input.style ?? '')?.slug ?? 'cel-anime-80s';
  const requested = input.storyboardSceneCount ?? input.targetScenes ?? Math.ceil(plan.audioDurationMs / (music.rhythmMode === 'fast-cut' ? 2000 : music.rhythmMode === 'slow-cinematic' ? 8000 : 5000));
  if (!Number.isFinite(requested) || requested < 1) throw new Error('MUSIC_MV_SHOT_COUNT: 分镜数量必须大于零。');
  const count = Math.max(Math.ceil(plan.audioDurationMs / 15000), Math.min(500, Math.max(1, Math.round(requested))));
  if (count > 500) throw new Error('MUSIC_MV_TOO_LONG: 请缩短歌曲，使镜头数量不超过 500。');
  const hasTrustedLyricTiming = plan.timingSource !== 'estimated';
  const cueStyle = music.captionStyle === 'none' ? '无字幕，不显示歌词' : !hasTrustedLyricTiming ? '无字幕（缺少可靠逐句时间戳，不得按估算时间显示歌词）' : music.captionStyle === 'karaoke' ? '卡拉 OK 歌词按句显示；没有逐字时间戳时不得伪造词级高亮' : '极简歌词字幕';
  const settings = voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, narration: false, generateImages: false,
    authoring: { mode: 'ai-code', styleId: style, brief: `音乐 MV。以主歌曲为唯一声音，围绕歌词创作连续画面。视觉母题：${music.visualMotif || '跟随歌词情绪'}。节奏：${music.rhythmMode}。字幕要求：${cueStyle}。完整保留歌词和歌曲时长。`.slice(0, 2000) },
    music: { id: 'mv-song', title: input.title?.trim() || '主歌曲', path: music.audioPath, durationMs: plan.audioDurationMs, gainDb: 0, loop: false, fadeInMs: 0, fadeOutMs: 0 },
  });
  const shots: EditorialCollageShot[] = [], cues: EditorialSubtitleCue[] = [];
  const lyricStarts = hasTrustedLyricTiming ? plan.segments.map(cue => cue.startMs) : [];
  const timedSegments = hasTrustedLyricTiming ? plan.segments : [];
  const shotBoundaries = planMusicMvShotBoundaries(plan.audioDurationMs, count, lyricStarts);
  for (let index = 0; index < count; index++) {
    const startMs = shotBoundaries[index], endMs = shotBoundaries[index + 1];
    const shotId = `mv-shot-${index + 1}`;
    // Untimed lyrics remain visual inspiration, never a subtitle clock.
    const lyrics = plan.segments.filter(cue => cue.startMs < endMs && cue.startMs + cue.durationMs > startMs);
    const shotCues = music.captionStyle === 'none' ? [] : timedSegments.filter(cue => cue.startMs < endMs && cue.startMs + cue.durationMs > startMs).map(cue => {
      const start = Math.max(startMs, cue.startMs), end = Math.min(endMs, cue.startMs + cue.durationMs);
      // A cue spanning editing windows keeps its original clock and is clipped at the window edge.
      // LRC only provides line starts here; equal-character karaoke tokens falsely imply measured vocal timing.
      return { id: `mv-cue-${cue.id}-${index + 1}`, shotId, text: cue.lyric, startMs: start, endMs: end, alignmentSource: plan.timingSource };
    });
    if (shotCues.length > 100) throw new Error('MUSIC_MV_TOO_MANY_LYRICS: 单镜头歌词过密，请增加分镜数量。');
    cues.push(...shotCues);
    shots.push({ id: shotId, beatId: 'mv-song', title: '', durationMs: endMs - startMs, renderStrategy: 'deterministic-layers',
      scenePrompt: `${music.visualMotif}。${lyrics.map(cue => cue.visualHint).join('；') || '前奏或间奏，延续歌曲意境'}`, motionPrompt: `音乐 MV，${music.rhythmMode}，连续场景`,
      layers: [], camera: [], subtitleCueIds: shotCues.map(cue => cue.id), subtitleStyle: cueStyle, transitionIn: { type: 'cut', durationMs: 0 } });
  }
  // Each beat has at most 100 shots / 200 cues in the shared editor schema.
  const beats: EditorialCollageBeat[] = [];
  for (let index = 0; index < shots.length; index += 50) {
    const group = shots.slice(index, index + 50), beatId = `mv-part-${beats.length + 1}`;
    const groupIds = new Set(group.map(shot => shot.id));
    const groupCues = cues.filter(cue => groupIds.has(cue.shotId!));
    if (groupCues.length > 200) throw new Error('MUSIC_MV_TOO_MANY_LYRICS: 此段歌词过密，请增加分镜数量或分段制作。');
    const startMs = shotBoundaries[index];
    beats.push({ id: beatId, index: beats.length + 1, title: '音乐 MV', narration: plan.segments.filter(cue => cue.startMs >= startMs && cue.startMs < startMs + group.reduce((sum,s) => sum+s.durationMs,0)).map(cue => cue.lyric).join('\n'),
      startMs, durationMs: group.reduce((sum, shot) => sum + shot.durationMs, 0), shots: group.map(shot => ({ ...shot, beatId })), subtitleCues: groupCues });
  }
  return parseEditorialCollagePipelineData(rebuildEditorialTimeline({ ...createEditorialCollageDraft({ id, title: input.title?.trim() || '音乐 MV', ratio: ratio as EditorialCollagePipelineData['ratio'], now }),
    sourceText: plan.segments.map(cue => cue.lyric).join('\n'), stage: 'style-approved', productionSettings: settings, beats }));
}