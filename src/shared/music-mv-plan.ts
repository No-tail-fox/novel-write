import type { MusicMvSettings, MusicPlan, ViralTranscriptSegment } from './types';
import { redactErrorText } from './app-error';
import type { ProductionSubtitleCue } from './production-workflow';

/** Do not silently replace a requested lyric MV with a captionless video. */
export function assertMusicMvLyricSynchronization(
  captionStyle: MusicMvSettings['captionStyle'] | undefined,
  hasLrcTimestamps: boolean,
  alignedLrcText?: string,
  failureDetail?: string,
): void {
  if (captionStyle !== 'none' && !hasLrcTimestamps && !alignedLrcText?.trim()) {
    throw new Error('MUSIC_MV_LYRIC_SYNC_REQUIRED: 无法可靠对齐歌词，已停止创建，未生成无字幕替代片。' + (failureDetail?.trim() || '请检查语音转写配置后重试，或提供校准后的逐句 LRC。'));
  }
}

/** Existing projects must not bypass synchronization checks on resume or export. */
export function assertMusicMvRenderSynchronization(
  captionStyle: MusicMvSettings['captionStyle'] | undefined,
  cues: readonly Pick<ProductionSubtitleCue, 'alignmentSource' | 'startMs' | 'endMs'>[],
  audioDurationMs: number,
): void {
  if (captionStyle === 'none' && cues.length === 0) return;
  const trusted = cues.length > 0 && Number.isFinite(audioDurationMs) && audioDurationMs > 0 && cues.every(cue =>
    (cue.alignmentSource === 'provider' || cue.alignmentSource === 'whisper' || cue.alignmentSource === 'manual') &&
    Number.isFinite(cue.startMs) && Number.isFinite(cue.endMs) &&
    cue.startMs >= 0 && cue.endMs > cue.startMs && cue.endMs <= audioDurationMs);
  if (!trusted) {
    throw new Error('MUSIC_MV_LYRIC_SYNC_REQUIRED: 此音乐 MV 缺少可靠歌词时间戳，或字幕时间已超出歌曲范围。已停止自动制作或导出；请重新校准歌词后重试，不会沿用旧的均分字幕或隐藏字幕继续生成。');
  }
}

/** Preserve actionable provider errors without exposing request credentials. */
export function formatMusicMvLyricSyncFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const detail = redactErrorText(message).replace(/\s+/gu, ' ').trim().slice(0, 700);
  return `语音转写失败。${detail ? `详情：${detail}。` : ''}请在系统设置 > 语音转文字中检查服务配置，或提供校准后的逐句 LRC。`;
}

/**
 * Convert a word-timestamped transcript into LRC only when every lyric line can
 * be found in order and has a distinct, in-range timestamp. Segment-level
 * timestamps are accepted only when they provide enough resolution for each line.
 */
export function matchMusicMvLyricsToTranscript(
  inputText: string,
  transcript: readonly ViralTranscriptSegment[],
  audioDurationMs: number,
): { lrcText: string; matched: number; total: number } | null {
  const lines = inputText.replace(/\r/g, '').split(/\n/u).map(line => line.trim()).filter(line => Boolean(line) && !/^\[(?:ar|ti|al|by|length|re|ve):/iu.test(line) && !/^\[(?:verse|chorus|bridge|intro|outro|instrumental|pre-chorus)(?:\s+\d+)?\]$/iu.test(line));
  if (!lines.length || !Number.isFinite(audioDurationMs) || audioDurationMs <= 0) return null;

  const sourceTokens = transcript.flatMap(segment => segment.words.length
    ? segment.words.map(word => ({ text: word.word, start: word.start, end: word.end }))
    : [{ text: segment.text, start: segment.start, end: segment.end }]);
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
  const tokens = sourceTokens
    .filter(token => Number.isFinite(token.start) && Number.isFinite(token.end) && token.start >= 0 && token.end > token.start)
    .map(token => ({ ...token, normalized: normalize(token.text) }))
    .filter(token => token.normalized.length > 0)
    .sort((a, b) => a.start - b.start);
  if (!tokens.length) return null;

  let transcriptText = '';
  const ranges: Array<{ start: number; end: number; time: number; endTime: number }> = [];
  for (const token of tokens) {
    const start = transcriptText.length;
    transcriptText += token.normalized;
    ranges.push({ start, end: transcriptText.length, time: token.start, endTime: token.end });
  }

  let cursor = 0;
  let previousStartMs = -1;
  const matchedLines: Array<{ text: string; startMs: number; endMs: number }> = [];
  for (const line of lines) {
    const needle = normalize(line);
    if (!needle) return null;
    const matchStart = transcriptText.indexOf(needle, cursor);
    if (matchStart < 0) return null;
    const range = ranges.find(candidate => candidate.start === matchStart);
    const lastRange = ranges.find(candidate => candidate.end === matchStart + needle.length);
    // A timestamp for a whole ASR token cannot time a substring of that token.
    if (!range || !lastRange) return null;
    const startMs = Math.round(range.time * 1000);
    const endMs = Math.min(audioDurationMs, Math.round(lastRange.endTime * 1000));
    if (startMs <= previousStartMs || startMs >= audioDurationMs || endMs <= startMs) return null;

    matchedLines.push({ text: line, startMs, endMs });
    previousStartMs = startMs;
    cursor = matchStart + needle.length;
  }

  const stamp = (ms: number) => {
    const minutes = String(Math.floor(ms / 60_000)).padStart(2, '0');
    const seconds = String(Math.floor(ms % 60_000 / 1000)).padStart(2, '0');
    const fraction = String(ms % 1000).padStart(3, '0');
    return '[' + minutes + ':' + seconds + '.' + (fraction.endsWith('0') ? fraction.slice(0, 2) : fraction) + ']';
  };
  const lrcLines = matchedLines.flatMap((line, index) => [
    stamp(line.startMs) + line.text,
    // Preserve measured vocal ends: do not hold a lyric across an instrumental gap.
    ...(line.endMs < (matchedLines[index + 1]?.startMs ?? audioDurationMs + 1) ? [stamp(line.endMs)] : []),
  ]);
  return { lrcText: lrcLines.join('\n'), matched: lines.length, total: lines.length };
}

/** Lyrics own their timing independently of the number of visual shots. */
export function planMusicMvLyrics(
  inputText: string,
  music: MusicMvSettings,
  audioDurationMs = 0,
  timingSource: 'manual' | 'provider' = 'manual',
): MusicPlan {
  const parsed = inputText.replace(/\r/g, '').split(/\n/u).flatMap<{ lyric: string; startMs: number | null }>(line => {
    const text = line.trim();
    if (/^\[offset:/iu.test(text)) {
      // LRC players differ in offset direction; require an explicit clock instead of silently desynchronizing a song.
      if (!/^\[offset:[+-]?0+\]$/iu.test(text)) throw new Error('MUSIC_MV_LRC_OFFSET: 请先将 LRC 的 offset 偏移合并到每句时间戳，再移除 offset 标签。');
      return [];
    }
    if (!text || /^\[(?:ar|ti|al|by|length|re|ve):/iu.test(text) || /^\[(?:verse|chorus|bridge|intro|outro|instrumental|pre-chorus)(?:\s+\d+)?\]$/iu.test(text)) return [];
    if (/<\d{1,3}:\d{2}/u.test(text)) throw new Error('MUSIC_MV_LRC_FORMAT: 暂不支持逐字 LRC 标签，请转换为每句一个时间戳的 LRC。');
    const stamps = [...text.matchAll(/\[(\d{1,3}):([0-5]\d(?:\.\d{1,3})?)\]/gu)];
    if (/\[\d+:/u.test(text.replace(/\[\d{1,3}:[0-5]\d(?:\.\d{1,3})?\]/gu, ''))) throw new Error('MUSIC_MV_LRC_FORMAT: LRC 时间戳格式无效，请使用 [分:秒.毫秒]。');
    const lyric = stamps.length ? text.slice(stamps.at(-1)!.index! + stamps.at(-1)![0].length).trim() : text;
    // An empty timed line ends the previous caption and leaves an instrumental gap.
    return stamps.length ? stamps.map(stamp => ({ lyric, startMs: Math.round((Number(stamp[1]) * 60 + Number(stamp[2])) * 1000) })) : [{ lyric, startMs: null }];
  });
  const lyricCount = parsed.filter(line => line.lyric).length;
  if (!lyricCount) throw new Error('MUSIC_MV_LYRICS_EMPTY: 请填写有效歌词。');
  const timed = parsed.every(line => line.startMs !== null);
  if (!timed && parsed.some(line => line.startMs !== null)) throw new Error('MUSIC_MV_LYRICS_MIXED: 请为每句歌词提供时间戳，或全部使用普通歌词。');
  if (timed) parsed.sort((a, b) => a.startMs! - b.startMs!);
  const durationByMode = music.rhythmMode === 'fast-cut' ? 1600 : music.rhythmMode === 'slow-cinematic' ? 3600 : 2400;
  const last = parsed.at(-1)!;
  const durationMs = Math.round(audioDurationMs > 0 ? audioDurationMs : timed ? last.startMs! + (last.lyric ? durationByMode : 0) : durationByMode * lyricCount);
  if (timed && parsed.some((line, index) => line.startMs! > durationMs || line.startMs === durationMs && Boolean(line.lyric) || index > 0 && line.startMs === parsed[index - 1].startMs)) {
    throw new Error('MUSIC_MV_LYRICS_TIMING: 歌词时间戳重复或超出歌曲时长，请检查 LRC。');
  }
  if (durationMs < lyricCount) throw new Error('MUSIC_MV_LYRICS_DENSE: 歌词数量超过可用时间，请分段制作。');
  const segments = parsed.flatMap((line, index) => {
    if (!line.lyric) return [];
    const startMs = timed ? line.startMs! : Math.round(durationMs * index / lyricCount);
    const endMs = timed ? parsed[index + 1]?.startMs ?? durationMs : Math.round(durationMs * (index + 1) / lyricCount);
    return [{ lyric: line.lyric, startMs, durationMs: endMs - startMs }];
  });
  return {
    ...music, audioDurationMs: durationMs,
    timingSource: timed ? timingSource : 'estimated',
    segments: segments.map((line, index) => ({ ...line, id: index + 1,
      section: index === 0 ? 'intro' : index === segments.length - 1 ? 'outro' : index >= Math.floor(segments.length / 2) ? 'chorus' : 'verse',
      visualHint: `${music.visualMotif || '围绕歌词情绪'}，镜头跟随歌词「${line.lyric}」`,
    })),
  };
}
