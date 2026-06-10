import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { buildOpenAiTranscriptionRequest, createViralRuntimeProviders, parseOpenAiTranscriptionResult } from '@shared/viral-runtime';

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

  it('builds a SiliconFlow transcription request with only supported multipart fields', () => {
    const config = normalizeAppConfig({
      ...defaultConfig,
      speechToText: {
        ...defaultConfig.speechToText,
        provider: 'siliconflow',
        apiKey: 'sf-key',
        model: 'TeleAI/TeleSpeechASR',
        language: 'zh',
        prompt: 'ignored for SiliconFlow',
        responseFormat: 'verbose_json',
        timestampGranularities: ['segment', 'word'],
      },
    });

    const request = buildOpenAiTranscriptionRequest(config);

    expect(request.endpoint).toBe('https://api.siliconflow.cn/v1/audio/transcriptions');
    expect(request.apiKey).toBe('sf-key');
    expect(request.maxUploadBytes).toBe(50 * 1024 * 1024);
    expect(request.fields).toEqual([['model', 'TeleAI/TeleSpeechASR']]);
  });

  it('falls back to the main LLM when the viral vision profile is incomplete', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-vision-fallback-'));
    const framePath = join(dir, 'frame.jpg');
    await writeFile(framePath, 'not-a-real-jpeg');
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      choices: [{ message: { content: '{"shotType":"特写","visualDescription":"商品占据画面中心","imagePrompt":"中文生图提示词：商品特写，中心构图，高对比字幕"}' } }],
    })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        llm: {
          ...defaultConfig.llm,
          apiKey: 'llm-key',
          baseUrl: 'https://llm.example',
          model: 'vision-chat-model',
        },
        viral: {
          ...defaultConfig.viral,
          vision: {
            ...defaultConfig.viral.vision,
            apiKey: 'stale-vision-key',
            model: '',
          },
        },
      });

      const providers = createViralRuntimeProviders(config, dir);
      const result = await providers.analyzeFrame({ timestamp: 0, framePath }, null, { title: 'Sample clip' } as never);

      expect(result.visualDescription).toBe('商品占据画面中心');
      expect(result.imagePrompt).toBe('中文生图提示词：商品特写，中心构图，高对比字幕');
      expect(fetchMock).toHaveBeenCalledWith('https://llm.example/v1/chat/completions', expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer llm-key' }),
      }));
      const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(requestBody).toMatchObject({ model: 'vision-chat-model' });
      const userText = requestBody.messages[1].content.find((item: { type: string }) => item.type === 'text').text;
      expect(userText).toContain('所有字段必须使用中文');
      expect(userText).toContain('imagePrompt');
      expect(userText).not.toContain('effectBreakdown');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports an actionable setup message when no viral frame vision model is usable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-vision-missing-'));
    const framePath = join(dir, 'frame.jpg');
    await writeFile(framePath, 'not-a-real-jpeg');
    const config = normalizeAppConfig({
      ...defaultConfig,
      llm: {
        ...defaultConfig.llm,
        apiKey: '',
        model: '',
      },
      viral: {
        ...defaultConfig.viral,
        vision: {
          ...defaultConfig.viral.vision,
          apiKey: '',
          model: '',
        },
      },
    });

    const providers = createViralRuntimeProviders(config, dir);

    await expect(providers.analyzeFrame({ timestamp: 0, framePath }, null, { title: 'Sample clip' } as never)).rejects.toThrow(
      '爆款拆解视觉模型未配置',
    );
  });

  it('wraps viral frame vision fetch failures with stage context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-vision-fetch-fail-'));
    const framePath = join(dir, 'frame.jpg');
    await writeFile(framePath, 'not-a-real-jpeg');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        viral: {
          ...defaultConfig.viral,
          vision: {
            ...defaultConfig.viral.vision,
            apiKey: 'vision-key',
            baseUrl: 'https://vision.example',
            model: 'vision-model',
            timeoutMs: 10,
          },
        },
      });

      const providers = createViralRuntimeProviders(config, dir);

      await expect(providers.analyzeFrame({ timestamp: 0, framePath }, null, { title: 'Sample clip' } as never)).rejects.toThrow(
        /frame analysis failed.*fetch failed/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
