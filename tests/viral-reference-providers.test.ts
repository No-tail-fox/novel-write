import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '@shared/config';
import { createReferenceProviders } from '@shared/viral-reference-providers';
import type { AppConfig, LlmConfig, ViralAnalysisSettings } from '@shared/types';
import type { ReferenceUnitInput } from '@shared/viral-reference-provider-types';

const settings: ViralAnalysisSettings = { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' };
const baseDraft = { track: 'shot', text: '采样画面中人物位于左侧，右侧留有文字空间。', state: 'observed', presence: 'present', aspect: 'appearance' };
const summary = { overview: '全片由问题引入并给出解释。', narrative: '先提出问题，再呈现论据。', rhythm: '前段信息密度较高。', productionRules: ['为关键论据保留画面空间。'], limitations: [] };
let directory: string;
let input: ReferenceUnitInput;

function config(protocol: LlmConfig['protocol'] = 'openai'): AppConfig {
  const value = structuredClone(defaultConfig);
  value.llm = { ...value.llm, apiKey: 'text-test-secret', model: 'text-model', baseUrl: 'https://text.example/v1', protocol: 'openai' };
  value.viral.vision = { ...value.llm, apiKey: 'vision-test-secret', model: 'vision-model', baseUrl: 'https://vision.example/v1', protocol };
  value.speechToText.apiKey = '';
  return value;
}
function mockOutput(value: unknown, protocol: LlmConfig['protocol'] = 'openai') {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const payload = protocol === 'responses'
    ? { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
    : protocol === 'anthropic'
      ? { stop_reason: 'end_turn', content: [{ type: 'text', text }] }
      : { choices: [{ finish_reason: 'stop', message: { content: text } }] };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
function request(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, headers: new Headers(options.headers), body: JSON.parse(String(options.body)) };
}

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'viral-reference-provider-'));
  const frames = [];
  for (let index = 0; index < 4; index++) {
    const path = join(directory, `${index}.jpg`);
    await writeFile(path, Buffer.from(`frame-${index}`));
    frames.push({ path, mediaId: `frame-${index}`, timeMs: index * 200 });
  }
  input = { unitId: 'unit-1', range: { startMs: 0, endMs: 1000 }, frames,
    videoPath: join(directory, 'clip.mp4'), audioPath: join(directory, 'clip.wav'), transcript: [] };
  await writeFile(input.videoPath, Buffer.from('video-fixture'));
  await writeFile(input.audioPath!, Buffer.from('audio-fixture'));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

describe('reference visual provider protocol contracts', () => {
  it('sends four ordered image inputs and downgrades whole-range static conclusions to inference', async () => {
    const fetchMock = mockOutput({ observations: [baseDraft] });
    const provider = createReferenceProviders(config(), settings);
    await expect(provider.analyzeVisual!(input)).resolves.toEqual([{ ...baseDraft, state: 'inferred' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = request(fetchMock);
    expect(sent.url).toBe('https://vision.example/v1/chat/completions');
    expect(sent.headers.get('authorization')).toBe('Bearer vision-test-secret');
    expect(sent.body.messages[1].content.filter((part: { type: string }) => part.type === 'image_url')).toEqual(input.frames.map((_, index) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(`frame-${index}`).toString('base64')}` } })));
    expect(sent.body.messages[1].content[0].text).toContain('不能判断连续动作');
    expect(sent.body.stream).toBe(false);
    expect(provider.analyzeAudio).toBeUndefined();
  });

  it('uses Responses input_image fields and validates the completed response envelope', async () => {
    const fetchMock = mockOutput({ observations: [baseDraft] }, 'responses');
    await createReferenceProviders(config('responses'), settings).analyzeVisual!(input);
    const sent = request(fetchMock);
    expect(sent.url).toBe('https://vision.example/v1/responses');
    expect(sent.body.input[1].content.filter((part: { type: string }) => part.type === 'input_image')).toHaveLength(4);
    expect(sent.body.text.format.type).toBe('json_object');
    expect(sent.body.store).toBe(false);
    expect(sent.body.background).toBe(false);
  });

  it('uses Anthropic image blocks and x-api-key without OpenAI payload fields', async () => {
    const fetchMock = mockOutput({ observations: [baseDraft] }, 'anthropic');
    await createReferenceProviders(config('anthropic'), settings).analyzeVisual!(input);
    const sent = request(fetchMock);
    expect(sent.url).toBe('https://vision.example/v1/messages');
    expect(sent.headers.get('x-api-key')).toBe('vision-test-secret');
    expect(sent.headers.get('authorization')).toBeNull();
    expect(sent.body.messages[0].content.filter((part: { type: string }) => part.type === 'image')[0]).toEqual({
      type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('frame-0').toString('base64') },
    });
    expect(sent.body.response_format).toBeUndefined();
  });

  it('rejects motion/transition/audio hallucinations from static inputs and never retries', async () => {
    for (const track of ['transition', 'layer-motion', 'sfx', 'music']) {
      const fetchMock = mockOutput({ observations: [{ ...baseDraft, track }] });
      await expect(createReferenceProviders(config(), settings).analyzeVisual!(input)).rejects.toThrow('REFERENCE_PROVIDER_INVALID_OUTPUT');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    const fetchMock = mockOutput({ observations: [{ ...baseDraft, aspect: 'camera-motion' }] });
    await expect(createReferenceProviders(config(), settings).analyzeVisual!(input)).rejects.toThrow('REFERENCE_PROVIDER_INVALID_OUTPUT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not hide malformed JSON, extra fields, or non-Chinese output', async () => {
    for (const value of ['```json\n{"observations":[]}\n```', { observations: [{ ...baseDraft, extra: 'unexpected' }] }, { observations: [{ ...baseDraft, text: 'The person is centered.' }] }]) {
      const fetchMock = mockOutput(value);
      await expect(createReferenceProviders(config(), settings).analyzeVisual!(input)).rejects.toThrow('REFERENCE_PROVIDER_INVALID_OUTPUT');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('validates input bounds before sending and never silently drops a fifth image', async () => {
    const fetchMock = mockOutput({ observations: [] });
    const provider = createReferenceProviders(config(), settings);
    await expect(provider.analyzeVisual!({ ...input, frames: [...input.frames, input.frames[0]] })).rejects.toThrow('1–4');
    await expect(provider.analyzeVisual!({ ...input, range: { startMs: 0, endMs: 32001 } })).rejects.toThrow('32 秒');
    const controller = new AbortController(); controller.abort();
    await expect(provider.analyzeVisual!(input, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('explicit continuous-input capabilities', () => {
  it('rejects unsupported protocols at configuration time instead of silently falling back', () => {
    for (const protocol of ['responses', 'anthropic'] as const) {
      expect(() => createReferenceProviders(config(protocol), { ...settings, referenceVisualInput: 'video' })).toThrow('仅支持显式配置');
      expect(() => createReferenceProviders(config(protocol), { ...settings, referenceAudioInput: true })).toThrow('仅支持显式配置');
    }
  });

  it('sends a real MP4 clip for explicit video input and accepts visual motion only', async () => {
    const draft = { ...baseDraft, track: 'layer-motion', aspect: 'subject-motion' };
    const fetchMock = mockOutput({ observations: [draft] });
    const provider = createReferenceProviders(config(), { ...settings, referenceVisualInput: 'video' });
    await expect(provider.analyzeVisual!(input)).resolves.toEqual([draft]);
    const content = request(fetchMock).body.messages[1].content;
    expect(content.find((part: { type: string }) => part.type === 'video_url')).toEqual({ type: 'video_url', video_url: { url: `data:video/mp4;base64,${Buffer.from('video-fixture').toString('base64')}` } });
    expect(content[0].text).toContain('禁止描述任何配音、音乐、音效');
    expect(content.some((part: { type: string }) => part.type === 'input_audio')).toBe(false);
  });

  it('uses actual WAV input for audio understanding, separately from transcription', async () => {
    const draft = { track: 'sfx', text: '片段中可听到一次短促撞击声。', state: 'observed', presence: 'present' };
    const fetchMock = mockOutput({ observations: [draft] });
    const provider = createReferenceProviders(config(), { ...settings, referenceAudioInput: true });
    await expect(provider.analyzeAudio!(input)).resolves.toEqual([draft]);
    expect(request(fetchMock).body.messages[1].content).toContainEqual({ type: 'input_audio', input_audio: { format: 'wav', data: Buffer.from('audio-fixture').toString('base64') } });
    expect(provider.transcribe).toBeUndefined();
    await expect(provider.analyzeAudio!({ ...input, audioPath: undefined })).rejects.toThrow('真实 WAV');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('single-attempt requests and credential-free cache identity', () => {
  it('leaves unconfigured capabilities absent and retains the existing main-model fallback', () => {
    const missing = createReferenceProviders(structuredClone(defaultConfig), settings);
    expect(missing.analyzeVisual).toBeUndefined();
    expect(missing.summarize).toBeUndefined();
    expect(missing.transcribe).toBeUndefined();
    const value = config(); value.viral.vision.apiKey = '';
    expect(createReferenceProviders(value, settings).analyzeVisual).toBeTypeOf('function');
  });

  it('excludes rotating credentials but includes model, protocol and capability changes in the fingerprint', () => {
    const value = config(); const original = createReferenceProviders(value, settings).fingerprint;
    value.llm.apiKey = 'rotated-secret'; value.viral.vision.apiKey = 'rotated-vision-secret';
    expect(createReferenceProviders(value, settings).fingerprint).toBe(original);
    expect(createReferenceProviders(value, { ...settings, referenceAudioInput: true }).fingerprint).not.toBe(original);
    expect(createReferenceProviders(value, { ...settings, referenceVisualInput: 'video' }).fingerprint).not.toBe(original);
    value.viral.vision.model = 'different-vision-model';
    expect(createReferenceProviders(value, settings).fingerprint).not.toBe(original);
    expect(createReferenceProviders(config('responses'), settings).fingerprint).not.toBe(original);
  });

  it('makes one request on HTTP and transport failures and keeps echoed secrets out of errors', async () => {
    for (const status of [429, 500]) {
      const fetchMock = vi.fn(async () => new Response('vision-test-secret', { status })); vi.stubGlobal('fetch', fetchMock);
      const error = await createReferenceProviders(config(), settings).analyzeVisual!(input).catch((error: Error) => error);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expect((error as Error).message).not.toContain('vision-test-secret');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
    const fetchMock = vi.fn(async () => { throw new Error('socket vision-test-secret'); }); vi.stubGlobal('fetch', fetchMock);
    await expect(createReferenceProviders(config(), settings).analyzeVisual!(input)).rejects.toThrow('REFERENCE_PROVIDER_REQUEST');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('summarizes bounded hierarchical inputs with strict JSON and preserves partial-result limitations', async () => {
    const fetchMock = mockOutput(summary);
    const result = await createReferenceProviders(config(), settings).summarize!({ summaries: ['片段一：人物介绍问题。', '片段二：文字说明答案。'], partial: true });
    expect(result.limitations[0]).toContain('尚有未完成');
    expect(request(fetchMock).url).toBe('https://text.example/v1/chat/completions');
    expect(request(fetchMock).body.messages[1].content).toContain('partial=true');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed summary call or expose the provider body', async () => {
    const fetchMock = vi.fn(async () => new Response('text-test-secret', { status: 429 })); vi.stubGlobal('fetch', fetchMock);
    const error = await createReferenceProviders(config(), settings).summarize!({ summaries: ['已分析镜头。'], partial: false }).catch((error: Error) => error);
    expect((error as Error).message).not.toContain('text-test-secret');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('calls the configured STT once and retains genuine segment/word timestamps', async () => {
    const value = config(); value.speechToText = { ...value.speechToText, apiKey: 'stt-test-secret', model: 'whisper-test', baseUrl: 'https://stt.example/v1', responseFormat: 'verbose_json' };
    const payload = { segments: [{ text: '测试', start: 0.1, end: 0.8, words: [{ word: '测试', start: 0.1, end: 0.8 }] }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetchMock);
    await expect(createReferenceProviders(value, settings).transcribe!(input.audioPath!)).resolves.toEqual(payload.segments);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://stt.example/v1/audio/transcriptions');
    expect((options.body as FormData).get('model')).toBe('whisper-test');
  });
});
