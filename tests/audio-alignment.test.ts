import { describe, expect, it } from 'vitest';
import {
  alignSubtitleCue,
  alignSubtitleCueFromTimestampFile,
  estimateSubtitleTokenTimings,
  hashSubtitleAlignment,
  hashSubtitleText,
  invalidateSubtitleAlignment,
  isProductionSubtitleCue,
  isSubtitleAlignmentValid,
  normalizeProductionSubtitleCue,
  normalizeSubtitleTimestamps,
  parseSubtitleTimestampFile,
  subtitleAlignmentInvalidationReasons,
  tokenizeSubtitleText,
  validateSubtitleTokens,
} from '@shared/audio-alignment';

describe('browser-safe subtitle/audio alignment', () => {
  // The renderer command “导入识别时间戳” is backed by importSubtitleTimestamps.
  it('parses local Whisper JSON and aligns the matching cue as observed timing', () => {
    const payload = JSON.stringify({ segments: [{ start: 0.2, end: 1.1, text: '你好' }, { start: 1.2, end: 1.8, text: 'OpenAI' }] });
    const file = parseSubtitleTimestampFile(payload, 'transcript.json');
    expect(file.issues).toEqual([]);
    expect(file.timestamps.map((entry) => [entry.text, entry.startMs, entry.endMs])).toEqual([['你好', 200, 1100], ['OpenAI', 1200, 1800]]);
    const aligned = alignSubtitleCueFromTimestampFile({ id: 'cue', startMs: 0, endMs: 1_150, text: '你好' }, payload, 'transcript.json');
    expect(aligned.cue.alignmentSource).toBe('whisper');
    expect(aligned.cue.tokens).toEqual([{ text: '你好', startMs: 200, endMs: 1100 }]);
    expect(aligned.issues).toEqual([]);
  });

  it('parses SRT/VTT absolute clocks and labels mismatches instead of hiding them', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,250\n中英 mix\n';
    expect(parseSubtitleTimestampFile(srt, 'voice.srt')).toMatchObject({ format: 'srt', issues: [], timestamps: [{ text: '中英 mix', startMs: 1000, endMs: 2250 }] });
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.250\n中英 mix\n';
    expect(parseSubtitleTimestampFile(vtt, 'voice.vtt')).toMatchObject({ format: 'vtt', issues: [], timestamps: [{ text: '中英 mix', startMs: 1000, endMs: 2250 }] });
    const aligned = alignSubtitleCueFromTimestampFile({ id: 'cue', startMs: 0, endMs: 3_000, text: '另一句' }, srt, 'voice.srt');
    expect(aligned.cue.alignmentSource).toBe('estimated');
    expect(aligned.issues).toContain('cue-text-or-timestamps-mismatch');
  });
  it('tokenizes Chinese characters and keeps mixed English/number runs intact', () => {
    expect(tokenizeSubtitleText('你好，OpenAI 2026！')).toEqual(['你', '好', '，', 'OpenAI', '2026', '！']);
    expect(tokenizeSubtitleText('')).toEqual([]);
    expect(tokenizeSubtitleText('   \n\t')).toEqual([]);
  });

  it('uses a deterministic UTF-8 text fingerprint', () => {
    expect(hashSubtitleText('abc')).toMatch(/^[a-f0-9]{16}$/u);
    expect(hashSubtitleText('你好')).toBe(hashSubtitleText('你好'));
    expect(hashSubtitleText('你好')).not.toBe(hashSubtitleText('你好！'));
  });

  it('converts seconds to milliseconds, shifts cue-relative timestamps, clamps bounds and removes overlap', () => {
    const tokens = normalizeSubtitleTimestamps([
      { word: 'one', start: -0.2, end: 0.4 },
      { word: 'two', start: 0.5, end: 1.6 },
      { word: 'three', start: 1.4, end: 2.4 },
    ], {
      cueStartMs: 1_000,
      cueEndMs: 3_000,
      timestampUnit: 'seconds',
      timestampOrigin: 'cue',
    });

    expect(tokens[0].startMs).toBe(1_000);
    expect(tokens.at(-1)?.endMs).toBe(3_000);
    expect(validateSubtitleTokens(tokens, 1_000, 3_000)).toEqual([]);
    expect(tokens.slice(1).every((token, index) => token.startMs >= tokens[index].endMs)).toBe(true);
    expect(tokens.every((token) => token.startMs >= 1_000 && token.endMs <= 3_000)).toBe(true);
  });

  it('rejects the whole provider response when one timestamp is malformed instead of filtering it', () => {
    const cue = alignSubtitleCue({ id: 'partial', startMs: 0, endMs: 1_000, text: '甲乙' }, {
      source: 'whisper',
      timestamps: [
        { text: '甲', start: 0, end: 0.4 },
        { text: '乙', start: 0.4, end: 0.4 },
      ],
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
    });
    expect(cue.alignmentSource).toBe('estimated');
    expect(cue.tokens?.map((token) => token.text).join('')).toBe('甲乙');
  });

  it('does not accept a partial text payload when one provider word has no text', () => {
    const cue = alignSubtitleCue({ id: 'partial-text', startMs: 0, endMs: 1_000, text: '甲乙' }, {
      source: 'provider',
      timestamps: [{ text: '甲', start: 0, end: 0.5 }, { start: 0.5, end: 1 }],
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
    });
    expect(cue.alignmentSource).toBe('estimated');
  });

  it('supports textless tuple boundaries by mapping them to the authored tokens', () => {
    const cue = alignSubtitleCue({ id: 'tuple', startMs: 500, endMs: 1_500, text: '中英 mix' }, {
      source: 'manual',
      timestamps: [[0, 0.25], [0.25, 0.75], [0.75, 1]],
      timestampUnit: 'seconds',
      timestampOrigin: 'cue',
    });
    expect(cue.alignmentSource).toBe('manual');
    expect(cue.tokens?.map((token) => token.text)).toEqual(['中', '英', 'mix']);
    expect(cue.tokens?.every((token) => token.endMs > token.startMs)).toBe(true);
  });

  it('accepts saved provider whole-word Chinese boundaries on reopen', () => {
    const reopened = alignSubtitleCue({
      id: 'whole-word',
      startMs: 0,
      endMs: 1_000,
      text: '你好世界',
      tokens: [
        { id: 'w1', text: '你好', startMs: 0, endMs: 400 },
        { id: 'w2', text: '世界', startMs: 400, endMs: 1_000 },
      ],
      alignmentSource: 'whisper',
      textHash: hashSubtitleText('你好世界'),
      alignmentFingerprint: hashSubtitleAlignment({ text: '你好世界', startMs: 0, endMs: 1_000 }),
    });
    expect(reopened.alignmentSource).toBe('whisper');
    expect(reopened.tokens?.map((token) => token.text)).toEqual(['你好', '世界']);
  });

  it('does not reuse old tokens when an audio dependency changes', () => {
    const original = alignSubtitleCue({ id: 'audio-change', startMs: 0, endMs: 1_000, text: '重新估算' }, {
      source: 'manual',
      timestamps: [{ text: '重新估算', start: 0, end: 1 }],
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
      audioAssetVersionId: 'audio-old',
    });
    const changed = alignSubtitleCue(original, { audioAssetVersionId: 'audio-new' });
    expect(changed.audioAssetVersionId).toBe('audio-new');
    expect(changed.alignmentSource).toBe('estimated');
    expect(changed.alignmentFingerprint).not.toBe(original.alignmentFingerprint);
  });

  it('rejects mixed startMs/end units and removes null dependencies consistently', () => {
    expect(normalizeSubtitleTimestamps([{ startMs: 100, end: 0.5 }], {
      cueStartMs: 0,
      cueEndMs: 1_000,
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
    })).toEqual([]);
    const cue = alignSubtitleCue({
      id: 'clear', startMs: 0, endMs: 1_000, text: '清理引用', audioAssetVersionId: 'old', voiceId: 'old-voice', voiceSpeed: 1,
    }, { audioAssetVersionId: null, voiceId: null, voiceSpeed: null });
    expect(cue).not.toHaveProperty('audioAssetVersionId');
    expect(cue).not.toHaveProperty('voiceId');
    expect(cue).not.toHaveProperty('voiceSpeed');
    expect(cue.alignmentFingerprint).toBe(hashSubtitleAlignment({ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }));
  });

  it('rejects ambiguous unsuffixed clocks and never emits zero-duration tokens', () => {
    expect(normalizeSubtitleTimestamps([{ text: 'a', start: 0, end: 1 }], {
      cueStartMs: 0,
      cueEndMs: 1_000,
    })).toEqual([]);
    expect(normalizeSubtitleTimestamps([{ text: 'a', start: 0, end: 0 }], {
      cueStartMs: 0,
      cueEndMs: 1_000,
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
    })).toEqual([]);
    expect(normalizeSubtitleTimestamps([{ text: 'a', start: -2, end: -1 }], {
      cueStartMs: 0,
      cueEndMs: 1_000,
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
    })).toEqual([]);
  });

  it('supports explicit millisecond fields and falls back to an explicit estimated source', () => {
    const cue = alignSubtitleCue(
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: '中文 test' },
      { audioAssetVersionId: 'audio-v1', voiceId: 'voice-a', voiceSpeed: 1 },
    );
    expect(cue.alignmentSource).toBe('estimated');
    expect(cue.tokens).toHaveLength(3);
    expect(cue.textHash).toBe(hashSubtitleText(cue.text));
    expect(cue.alignmentFingerprint).toMatch(/^[a-f0-9]{16}$/u);

    const explicit = normalizeSubtitleTimestamps([
      { text: 'a', startMs: -50, endMs: 350 },
      { text: 'b', startMs: 300, endMs: 900 },
    ], { cueStartMs: 0, cueEndMs: 800, timestampUnit: 'milliseconds', timestampOrigin: 'absolute' });
    expect(explicit).toEqual([
      { text: 'a', startMs: 0, endMs: 350 },
      { text: 'b', startMs: 350, endMs: 800 },
    ]);
  });

  it('keeps an empty cue explicitly estimated without inventing tokens', () => {
    const cue = alignSubtitleCue({ id: 'empty', startMs: 200, endMs: 700, text: '   ' }, { timestamps: [] });
    expect(cue.tokens).toEqual([]);
    expect(cue.alignmentSource).toBe('estimated');
    expect(cue.textHash).toBe(hashSubtitleText('   '));
  });

  it('invalidates alignment when text, audio, voice, rate, style or cue range changes', () => {
    const cue = alignSubtitleCue(
      { id: 'cue-2', startMs: 0, endMs: 2_000, text: '保持这句' },
      {
        source: 'whisper',
        timestamps: [{ start: 0, end: 2, text: '保持这句' }],
        timestampUnit: 'seconds',
        audioAssetVersionId: 'audio-v1',
        voiceId: 'voice-a',
        voiceSpeed: 1,
        styleRef: 'style-v1',
      },
    );
    expect(isSubtitleAlignmentValid(cue, {
      text: cue.text,
      startMs: cue.startMs,
      endMs: cue.endMs,
      audioAssetVersionId: 'audio-v1',
      voiceId: 'voice-a',
      voiceSpeed: 1,
      styleRef: 'style-v1',
    })).toBe(true);

    const reasons = subtitleAlignmentInvalidationReasons(cue, {
      text: '改过的句子',
      startMs: 100,
      endMs: 2_100,
      audioAssetVersionId: 'audio-v2',
      voiceId: 'voice-b',
      voiceSpeed: 1.1,
      styleRef: 'style-v2',
    });
    expect(reasons).toEqual(expect.arrayContaining(['text-changed', 'audio-changed', 'voice-changed', 'rate-changed', 'range-changed']));

    const cleared = invalidateSubtitleAlignment(cue, { audioAssetVersionId: 'audio-v2', voiceSpeed: 1.1 });
    expect(cleared).not.toHaveProperty('tokens');
    expect(cleared).not.toHaveProperty('textHash');
    expect(cleared.audioAssetVersionId).toBe('audio-v2');
    expect(cleared.voiceSpeed).toBe(1.1);
  });

  it('estimates the complete cue when provider text does not cover authored text', () => {
    const cue = alignSubtitleCue(
      { id: 'mismatch', startMs: 0, endMs: 1_000, text: '原始中文' },
      { timestamps: [{ text: 'different', start: 0, end: 1 }], source: 'whisper', timestampUnit: 'seconds', timestampOrigin: 'absolute' },
    );
    expect(cue.alignmentSource).toBe('estimated');
    expect(cue.tokens?.map((token) => token.text).join('')).toBe('原始中文');
  });

  it('does not invalidate audio timing for a style-only change', () => {
    const cue = alignSubtitleCue({ id: 'style', startMs: 0, endMs: 1_000, text: '样式不影响音频' }, {
      source: 'manual',
      timestamps: [{ text: '样式不影响音频', start: 0, end: 1 }],
      timestampUnit: 'seconds',
      timestampOrigin: 'absolute',
      audioAssetVersionId: 'audio',
      voiceId: 'voice',
      voiceSpeed: 1,
      styleRef: 'old-style',
    });
    expect(isSubtitleAlignmentValid(cue, { audioAssetVersionId: 'audio', voiceId: 'voice', voiceSpeed: 1, styleRef: 'new-style' })).toBe(true);
    expect(subtitleAlignmentInvalidationReasons(cue, { styleRef: 'new-style' })).not.toContain('style-changed');
  });

  it('accepts legacy cues without alignment fields', () => {
    const legacy = { id: 'legacy', startMs: 0, endMs: 1_000, text: '旧字幕' };
    expect(isProductionSubtitleCue(legacy)).toBe(true);
    expect(normalizeProductionSubtitleCue(legacy)).toEqual(legacy);
  });

  it('rejects malformed persisted token text without throwing during validation', () => {
    const base = { id: 'bad-token', startMs: 0, endMs: 1000, text: '你好' };
    for (const token of [{ startMs: 0, endMs: 1000 }, { text: 12, startMs: 0, endMs: 1000 }, { text: '', startMs: 0, endMs: 1000 }, null]) {
      expect(() => isProductionSubtitleCue({ ...base, tokens: [token] })).not.toThrow();
      expect(isProductionSubtitleCue({ ...base, tokens: [token] })).toBe(false);
    }
  });

  it('produces a complete weighted estimate inside the cue range', () => {
    const tokens = estimateSubtitleTokenTimings('中英 mix', 100, 1_100);
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens[0].startMs).toBe(100);
    expect(tokens.at(-1)?.endMs).toBe(1_100);
    expect(validateSubtitleTokens(tokens, 100, 1_100)).toEqual([]);
  });
});
