import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { createConfiguredNarrationSynthesizer } from '@shared/media-providers';
import type { AppConfig, StoryboardScene, Task } from '@shared/types';

const config: AppConfig = { ...defaultConfig, tts: { ...defaultConfig.tts, provider: 'volcengine', volcengine: {
  ...defaultConfig.tts.volcengine, apiKey: 'test', resourceId: 'seed-tts-2.0',
  endpoint: 'https://tts.example/api/v3/tts/unidirectional', speaker: 'test-speaker',
} } };
const scene: StoryboardScene = { id: 1, cap: '完整旁白，不应因响应提前结束而丢失。', descPrompt: 'scene', durationMs: 1200 };
const task = { id: 'tts-completion-test', title: 'TTS test', ratio: '9:16', ttsSpeed: 1, speaker: 'voice' } as Task;
const audio = JSON.stringify({ code: 0, data: Buffer.from('audio-chunk').toString('base64') });
const end = JSON.stringify({ code: 20000000, message: 'ok', data: null });
const error = JSON.stringify({ code: 55000000, message: 'synthesis failed' });
afterEach(() => { vi.unstubAllGlobals(); });

async function synthesizeResponse(response: Response, check: (run: Promise<unknown>, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'storydream-tts-completion-'));
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response);
  vi.stubGlobal('fetch', fetchMock);
  try {
    const run = createConfiguredNarrationSynthesizer(config, dir)([scene], task);
    await check(run, dir);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.req_params.text).toBe(scene.cap);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('Volcengine V3 completion boundary', () => {
  it.each(['partial audio', 'empty body'] as const)('rejects %s without completion without saving or retrying', async mode => {
    const response = new Response(mode === 'partial audio' ? audio + '\n' : null, { status: 200 });
    await synthesizeResponse(response, async (run, dir) => {
      await expect(run).rejects.toThrow('TTS_RESPONSE_INCOMPLETE');
      expect(await readdir(dir, { recursive: true })).not.toContain('001.mp3');
    });
  });
  it('accepts a confirmed complete response with no trailing newline', async () => {
    const response = new Response('data: ' + audio + '\r\n\r\ndata: ' + end);
    await synthesizeResponse(response, async run => { await expect(run).resolves.toHaveLength(1); });
  });
  it('does not accept an API error after audio as a successful partial result', async () => {
    await synthesizeResponse(new Response(audio + '\n' + error), async (run, dir) => {
      await expect(run).rejects.toThrow('synthesis failed');
      expect(await readdir(dir, { recursive: true })).not.toContain('001.mp3');
    });
  });
  it('requires actual audio in addition to the completion marker', async () => {
    await synthesizeResponse(new Response(end), async run => { await expect(run).rejects.toThrow('did not include audio data'); });
  });
  it('preserves audio supplied in a completion frame', async () => {
    const response = new Response(JSON.stringify({ code: 20000000, data: Buffer.from('final-audio').toString('base64') }));
    await synthesizeResponse(response, async run => { await expect(run).resolves.toHaveLength(1); });
  });
  it('handles fragmented UTF-8 frames and a final marker split across network chunks', async () => {
    const bytes = new TextEncoder().encode(audio + '\n' + JSON.stringify({ code: 20000000, message: '完成', data: null }));
    const response = new Response(new ReadableStream({ start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    } }));
    await synthesizeResponse(response, async run => { await expect(run).resolves.toHaveLength(1); });
  });
});
