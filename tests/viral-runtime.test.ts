import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from 'undici';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { buildOpenAiTranscriptionRequest, createViralRuntimeProviders, parseOpenAiTranscriptionResult } from '@shared/viral-runtime';

function getAgentConnectTimeout(dispatcher: unknown): number | null {
  if (!dispatcher || typeof dispatcher !== 'object') return null;
  for (const symbol of Object.getOwnPropertySymbols(dispatcher)) {
    if (symbol.description !== 'options') continue;
    const options = (dispatcher as Record<symbol, unknown>)[symbol] as { connect?: { timeout?: number } } | undefined;
    return typeof options?.connect?.timeout === 'number' ? options.connect.timeout : null;
  }
  return null;
}

describe('viral runtime speech-to-text API', () => {
  it('routes TypeScript and Python media processes through bounded tree cleanup', async () => {
    const runtime = await readFile(new URL('../src/shared/viral-runtime.ts', import.meta.url), 'utf8');
    const download = await readFile(new URL('../src/shared/viral-download.ts', import.meta.url), 'utf8');
    const worker = await readFile(new URL('../src/shared/viral-media-worker.py', import.meta.url), 'utf8');

    expect(runtime).toContain("from './process-runner'");
    expect(runtime).toContain('runBoundedProcess');
    expect(runtime).not.toContain('execFileAsync');
    expect(download).toContain("from './process-runner'");
    expect(download).toContain('runBoundedProcess');
    expect(download).not.toContain('execFileAsync');
    expect(worker).toContain('run_bounded_subprocess');
    expect(worker).toContain('taskkill');
    expect(worker).toContain('safe_unlink(output_path)');
  });

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

  it('rejects an oversized speech-to-text response before parsing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-stt-response-limit-'));
    const audioPath = join(dir, 'audio.wav');
    await writeFile(audioPath, 'small audio fixture');
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ text: 'transcript' }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': String(4 * 1024 * 1024 + 1),
        },
      })) as unknown as typeof fetch;
    try {
      const config = normalizeAppConfig({
        ...defaultConfig,
        speechToText: {
          ...defaultConfig.speechToText,
          apiKey: 'stt-key',
          baseUrl: 'https://stt.example/v1',
          model: 'whisper-1',
        },
      });
      const providers = createViralRuntimeProviders(config, dir);

      await expect(providers.transcribe(audioPath)).rejects.toThrow(/byte|large|limit|大小|上限/i);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
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
      expect(fetchMock).toHaveBeenCalledWith('https://llm.example/v1/chat/completions', expect.any(Object));
      expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer llm-key');
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

  it('retries transient viral frame vision fetch failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-vision-fetch-retry-'));
    const framePath = join(dir, 'frame.jpg');
    await writeFile(framePath, 'not-a-real-jpeg');
    const originalFetch = globalThis.fetch;
    const transient = new TypeError('fetch failed') as Error & { cause?: unknown };
    transient.cause = new Error('read ECONNRESET');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    shotType: 'close-up',
                    cameraMovement: 'static',
                    composition: 'center',
                    transition: 'cut',
                    textOverlay: null,
                    visualDescription: 'Recovered frame analysis',
                    mood: 'calm',
                    keyElements: ['bread'],
                    imagePrompt: 'Recovered image prompt',
                  }),
                },
              },
            ],
          }),
        ),
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
      const result = await providers.analyzeFrame({ timestamp: 0, framePath }, null, { title: 'Sample clip' } as never);

      expect(result.visualDescription).toBe('Recovered frame analysis');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses a longer connect timeout for viral frame vision requests', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-vision-connect-timeout-'));
    const framePath = join(dir, 'frame.jpg');
    await writeFile(framePath, 'not-a-real-jpeg');
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const requestInit = init as RequestInit & { dispatcher?: unknown };
      expect(requestInit.dispatcher).toBeInstanceOf(Agent);
      expect(getAgentConnectTimeout(requestInit.dispatcher)).toBe(30000);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  shotType: 'close-up',
                  cameraMovement: 'static',
                  composition: 'center',
                  transition: 'cut',
                  textOverlay: null,
                  visualDescription: 'Recovered frame analysis',
                  mood: 'calm',
                  keyElements: ['bread'],
                  imagePrompt: 'Recovered image prompt',
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

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
          },
        },
      });

      const providers = createViralRuntimeProviders(config, dir);
      const result = await providers.analyzeFrame({ timestamp: 0, framePath }, null, { title: 'Sample clip' } as never);

      expect(result.visualDescription).toBe('Recovered frame analysis');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
