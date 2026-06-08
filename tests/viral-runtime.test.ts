import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { buildOpenAiTranscriptionRequest, parseOpenAiTranscriptionResult } from '@shared/viral-runtime';

describe('viral runtime speech-to-text API', () => {
  it('builds OpenAI-compatible transcription request fields from config', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      speechToText: {
        ...defaultConfig.speechToText,
        baseUrl: 'https://api.example.com',
        apiKey: 'stt-key',
        model: 'whisper-1',
        language: 'zh',
        prompt: '短视频口播',
        responseFormat: 'verbose_json',
        temperature: 0.2,
        timeoutMs: 90000,
        timestampGranularities: ['segment', 'word'],
        chunkingStrategy: 'auto',
      },
    });

    const request = buildOpenAiTranscriptionRequest(config);

    expect(request.endpoint).toBe('https://api.example.com/v1/audio/transcriptions');
    expect(request.timeoutMs).toBe(90000);
    expect(request.apiKey).toBe('stt-key');
    expect(request.fields).toEqual([
      ['model', 'whisper-1'],
      ['language', 'zh'],
      ['prompt', '短视频口播'],
      ['response_format', 'verbose_json'],
      ['temperature', '0.2'],
      ['timestamp_granularities[]', 'segment'],
      ['timestamp_granularities[]', 'word'],
      ['chunking_strategy', 'auto'],
    ]);
  });

  it('parses verbose and plain transcription responses into viral transcript segments', () => {
    expect(
      parseOpenAiTranscriptionResult({
        text: '第一句。第二句。',
        segments: [
          { text: '第一句。', start: 0, end: 1.4, words: [{ word: '第一句', start: 0.1, end: 1.2 }] },
          { text: '第二句。', start: 1.4, end: 2.8 },
        ],
      }),
    ).toEqual([
      { text: '第一句。', start: 0, end: 1.4, words: [{ word: '第一句', start: 0.1, end: 1.2 }] },
      { text: '第二句。', start: 1.4, end: 2.8, words: [] },
    ]);

    expect(parseOpenAiTranscriptionResult({ text: '没有时间戳的结果' })).toEqual([
      { text: '没有时间戳的结果', start: 0, end: 0, words: [] },
    ]);
  });
});
