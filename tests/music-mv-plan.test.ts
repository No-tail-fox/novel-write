import { describe, expect, it } from 'vitest';
import { assertMusicMvLyricSynchronization, assertMusicMvRenderSynchronization, formatMusicMvLyricSyncFailure, matchMusicMvLyricsToTranscript, planMusicMvLyrics } from '@shared/music-mv-plan';
import { createMusicMvDocument } from '@shared/music-mv-production';
import type { CreateTaskInput, MusicMvSettings, ViralTranscriptSegment } from '@shared/types';

const music: MusicMvSettings = {
  rhythmMode: 'lyric-sync',
  captionStyle: 'minimal',
  visualMotif: '雨夜霓虹',
  audioPath: 'song.wav',
};

function word(text: string, start: number, end = start + 0.4) {
  return { word: text, start, end };
}

describe('Music MV lyric synchronization', () => {
  it('preserves service failure details but redacts credentials', () => {
    const detail = formatMusicMvLyricSyncFailure(new Error('HTTP 403: model unavailable; Authorization: Bearer test-secret-token; api_key=private-value'));
    expect(detail).toContain('HTTP 403: model unavailable');
    expect(detail).not.toContain('test-secret-token');
    expect(detail).not.toContain('private-value');
    expect(formatMusicMvLyricSyncFailure(null)).toContain('语音转写失败');
  });
  it('requires real timing when captions are requested, including default karaoke mode', () => {
    for (const style of ['minimal', 'karaoke', undefined] as const) {
      expect(() => assertMusicMvLyricSynchronization(style, false)).toThrow('MUSIC_MV_LYRIC_SYNC_REQUIRED');
      expect(() => assertMusicMvLyricSynchronization(style, true)).not.toThrow();
      expect(() => assertMusicMvLyricSynchronization(style, false, '[00:01.00]歌词')).not.toThrow();
    }
    expect(() => assertMusicMvLyricSynchronization('none', false)).not.toThrow();
    expect(() => assertMusicMvLyricSynchronization('minimal', false, undefined, '语音转文字未配置 API Key 或模型。')).toThrow('语音转文字未配置 API Key 或模型。');
  });
  it('blocks legacy equal-duration captions and missing captions on rerun or export', () => {
    const cue = { startMs: 0, endMs: 3000 };
    for (const cues of [[], [cue], [{ ...cue, alignmentSource: 'estimated' as const }]]) {
      expect(() => assertMusicMvRenderSynchronization('karaoke', cues, 12000)).toThrow('MUSIC_MV_LYRIC_SYNC_REQUIRED');
    }
    for (const alignmentSource of ['provider', 'whisper', 'manual'] as const) {
      expect(() => assertMusicMvRenderSynchronization('minimal', [{ ...cue, alignmentSource }], 12000)).not.toThrow();
    }
    expect(() => assertMusicMvRenderSynchronization('none', [], 12000)).not.toThrow();
    expect(() => assertMusicMvRenderSynchronization('none', [cue], 12000)).toThrow('MUSIC_MV_LYRIC_SYNC_REQUIRED');
    expect(() => assertMusicMvRenderSynchronization('minimal', [{ ...cue, alignmentSource: 'manual', endMs: 13000 }], 12000)).toThrow('MUSIC_MV_LYRIC_SYNC_REQUIRED');
  });

  it('matches lyric lines against word timestamps and ignores section headings', () => {
    const transcript: ViralTranscriptSegment[] = [{
      text: '雨 落 下 霓 虹 亮 起', start: 1, end: 5,
      words: [word('雨', 1), word('落', 1.3), word('下', 1.6), word('霓', 3), word('虹', 3.3), word('亮', 3.6), word('起', 3.9)],
    }];
    const aligned = matchMusicMvLyricsToTranscript('[Verse 1]\n雨落下\n[Chorus]\n霓虹亮起', transcript, 10_000);
    expect(aligned).toMatchObject({ matched: 2, total: 2 });
    expect(aligned?.lrcText).toBe('[00:01.00]雨落下\n[00:02.00]\n[00:03.00]霓虹亮起\n[00:04.30]');
  });

  it('matches repeated lyric lines at successive occurrences', () => {
    const transcript: ViralTranscriptSegment[] = [
      { text: '再见', start: 2, end: 2.5, words: [word('再见', 2)] },
      { text: '再见', start: 5, end: 5.5, words: [word('再见', 5)] },
    ];
    expect(matchMusicMvLyricsToTranscript('再见\n再见', transcript, 8_000)?.lrcText)
      .toBe('[00:02.00]再见\n[00:02.40]\n[00:05.00]再见\n[00:05.40]');
  });

  it('rejects partial matches, duplicate segment-only timestamps, and missing timing', () => {
    expect(matchMusicMvLyricsToTranscript('已知\n缺失', [
      { text: '已知', start: 1, end: 2, words: [] },
    ], 5_000)).toBeNull();
    expect(matchMusicMvLyricsToTranscript('第一句\n第二句', [
      { text: '第一句，第二句', start: 1, end: 3, words: [] },
    ], 5_000)).toBeNull();
    expect(matchMusicMvLyricsToTranscript('歌词', [
      { text: '歌词', start: Number.NaN, end: 1, words: [] },
    ], 5_000)).toBeNull();
  });

  it('preserves measured vocal ends and instrumental gaps throughout document creation', () => {
    const aligned = matchMusicMvLyricsToTranscript('[ti:测试]\n雨落下\n霓虹亮起', [
      { text: '雨落下', start: 1.125, end: 2.125, words: [] },
      { text: '霓虹亮起', start: 5.375, end: 6.375, words: [] },
    ], 10_000);
    expect(aligned).not.toBeNull();
    const plan = planMusicMvLyrics(aligned!.lrcText, music, 10_000, 'provider');
    expect(plan.segments.map(line => [line.startMs, line.startMs + line.durationMs])).toEqual([[1125, 2125], [5375, 6375]]);
    const input: CreateTaskInput = {
      title: '间奏测试', inputText: aligned!.lrcText, taskKind: 'music-mv', track: 'music-mv',
      storyboardSceneCount: 4, musicMv: music,
    };
    const document = createMusicMvDocument('mv-gaps-test', input, 10_000, '2026-10-29T00:00:00.000Z', 'provider');
    const cues = document.beats.flatMap(beat => beat.subtitleCues);
    expect(cues.map(cue => [cue.text, cue.startMs, cue.endMs])).toEqual([
      ['雨落下', 1125, 2125], ['霓虹亮起', 5375, 6375],
    ]);
  });

  it('keeps millisecond precision at minute boundaries and clips at song end', () => {
    const aligned = matchMusicMvLyricsToTranscript('最后一句', [
      { text: '最后一句', start: 59.999, end: 61.125, words: [] },
    ], 60_500);
    expect(aligned?.lrcText).toBe('[00:59.999]最后一句\n[01:00.50]');
    expect(planMusicMvLyrics(aligned!.lrcText, music, 60_500, 'provider').segments)
      .toMatchObject([{ startMs: 59_999, durationMs: 501 }]);
  });

  it('rejects substring timing and avoids duplicate LRC boundaries for adjacent lines', () => {
    expect(matchMusicMvLyricsToTranscript('一句', [
      { text: '不是一句', start: 1, end: 3, words: [] },
    ], 10_000)).toBeNull();
    const aligned = matchMusicMvLyricsToTranscript('第一句\n第二句', [
      { text: '第一句', start: 1, end: 2, words: [] },
      { text: '第二句', start: 2, end: 3, words: [] },
    ], 10_000);
    expect(aligned?.lrcText).toBe('[00:01.00]第一句\n[00:02.00]第二句\n[00:03.00]');
    expect(planMusicMvLyrics(aligned!.lrcText, music, 10_000).segments).toHaveLength(2);
  });

  it('preserves provider timestamps in generated project cues and keeps fallback labeled estimated', () => {
    const providerLrc = '[00:02.00]第一句\n[00:05.00]第二句';
    const input: CreateTaskInput = {
      title: '同步测试', inputText: providerLrc, taskKind: 'music-mv', track: 'music-mv',
      storyboardSceneCount: 4, musicMv: music,
    };
    const document = createMusicMvDocument('mv-sync-test', input, 10_000, '2026-10-29T00:00:00.000Z', 'provider');
    const cues = document.beats.flatMap(beat => beat.subtitleCues);
    expect(cues.map(cue => [cue.text, cue.startMs, cue.alignmentSource])).toEqual([
      ['第一句', 2_000, 'provider'], ['第二句', 5_000, 'provider'], ['第二句', 7_500, 'provider'],
    ]);

    expect(planMusicMvLyrics('第一句\n第二句', music, 10_000).timingSource).toBe('estimated');
  });
});

describe('Music MV word-level (enhanced / A2) LRC', () => {
  it('parses enhanced LRC into unchanged line timing plus per-word timing', () => {
    const lrc = '[ti:逐字]\n[00:01.00]<00:01.00>雨<00:01.50>落<00:02.00>下<00:02.80>\n[00:04.00]<00:04.00>霓<00:04.40>虹<00:05.00>亮起';
    const plan = planMusicMvLyrics(lrc, music, 10_000);
    expect(plan.timingSource).toBe('manual');
    expect(plan.segments.map(line => [line.lyric, line.startMs, line.durationMs])).toEqual([['雨落下', 1000, 3000], ['霓虹亮起', 4000, 6000]]);
    expect(plan.segments[0].words).toEqual([
      { text: '雨', startMs: 1000, durationMs: 500 }, { text: '落', startMs: 1500, durationMs: 500 }, { text: '下', startMs: 2000, durationMs: 800 },
    ]);
    // Last word without an end tag runs to the caption end (song end here).
    expect(plan.segments[1].words?.at(-1)).toEqual({ text: '亮起', startMs: 5000, durationMs: 5000 });
  });

  it('accepts A2-style spaced words, untagged leading text and gap tags', () => {
    const plan = planMusicMvLyrics('[00:10.00] Hello <00:10.50> rainy <00:11.20> night <00:12.00>\n[00:13.00]<00:13.00>la <00:13.40> <00:14.00>la', music, 20_000);
    expect(plan.segments[0].lyric).toBe('Hello rainy night');
    expect(plan.segments[0].words?.map(w => [w.text, w.startMs, w.durationMs])).toEqual([['Hello', 10_000, 500], ['rainy', 10_500, 700], ['night', 11_200, 800]]);
    expect(plan.segments[1].words?.map(w => [w.text, w.startMs, w.durationMs])).toEqual([['la', 13_000, 400], ['la', 14_000, 6_000]]);
    // Word tags never change the caption clock or the document cues.
    const input: CreateTaskInput = { title: '逐字', inputText: '[00:01.00]<00:01.00>第一<00:01.60>句\n[00:05.00]<00:05.00>第二句', taskKind: 'music-mv', track: 'music-mv', storyboardSceneCount: 2, musicMv: music };
    const cues = createMusicMvDocument('mv-word-test', input, 10_000, '2026-10-29T00:00:00.000Z').beats.flatMap(beat => beat.subtitleCues);
    expect(cues.map(cue => [cue.text, cue.startMs, cue.endMs])).toEqual([['第一句', 1000, 5000], ['第二句', 5000, 10_000]]);
  });

  it('keeps plain LRC output byte-identical (no words field)', () => {
    const plan = planMusicMvLyrics('[00:02.00]第一句\n[00:05.00]第二句', music, 10_000);
    expect(plan.segments.every(line => !('words' in line))).toBe(true);
  });

  it('rejects malformed word-level LRC with Chinese errors', () => {
    const plan = (text: string) => () => planMusicMvLyrics(text, music, 10_000);
    expect(plan('[00:01.00]<00:1.0>雨<00:01.50>落')).toThrow(/MUSIC_MV_LRC_WORD_FORMAT: 逐字时间标签格式无效/);
    expect(plan('[00:01.00]<00:01.00 雨')).toThrow('MUSIC_MV_LRC_WORD_FORMAT');
    expect(plan('<00:01.00>雨<00:01.50>落')).toThrow(/必须跟在行时间戳/);
    expect(plan('[00:01.00][00:05.00]<00:01.00>雨')).toThrow(/只能有一个行时间戳/);
    expect(plan('[00:02.00]<00:01.00>雨')).toThrow(/MUSIC_MV_LRC_WORD_TIMING: 逐字时间无效（逐字时间早于行时间戳）/);
    expect(plan('[00:01.00]<00:01.50>雨<00:01.20>落')).toThrow(/逐个递增/);
    expect(plan('[00:01.00]<00:01.00>雨<00:01.00>')).toThrow(/行尾时间必须晚于最后一个字/);
    expect(plan('[00:01.00]<00:01.00>雨<00:06.00>落\n[00:05.00]下一句')).toThrow(/晚于下一句开始/);
  });
});