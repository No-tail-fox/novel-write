import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { ipcInputSchemas } from '@shared/ipc-contract';
import { createVideoLabRuntime } from '@shared/video-lab-runtime';
import { videoLabGenerateInputSchema, videoLabProviderConfig, type VideoLabGenerateInput, type VideoLabRecord } from '@shared/video-lab';
import type { createConfiguredVideoProvider, VideoProvider } from '@shared/video-provider';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
async function workDirectory() {
  const dir = await mkdtemp(join(tmpdir(), 'storydream-video-lab-'));
  directories.push(dir);
  return dir;
}
function configured() {
  const config = normalizeAppConfig(defaultConfig);
  config.video.providers = ['first', 'selected'].map((id) => ({
    ...config.video.providers[0], id, name: id, enabled: true, apiKey: 'local-test-secret',
    baseUrl: 'https://video.example/v1', model: `model-${id}`, capabilities: ['t2v', 'i2v', 'first-last-frame', 'reference-image'],
  }));
  config.video.activeProviderId = 'first';
  config.video.automation.providerWhitelist = ['first'];
  return config;
}
const input: VideoLabGenerateInput = { prompt: '窗外细雨，镜头缓缓向前', durationSec: 5, ratio: '16:9', providerId: 'selected' };

describe('standalone video generation', () => {
  it('validates the public IPC request and forbids arbitrary directory IDs', () => {
    expect(videoLabGenerateInputSchema.parse(input)).toEqual(input);
    for (const invalid of [
      { ...input, prompt: '   ' }, { ...input, durationSec: Infinity }, { ...input, durationSec: 0 },
      { ...input, firstFramePath: '../secret.png' }, { ...input, firstFramePath: 'https://host/image.png' },
      { ...input, lastFramePath: 'C:/frame.png' }, { ...input, apiKey: 'should-not-be-accepted' },
    ]) expect(ipcInputSchemas['video-lab:generate'].safeParse(invalid).success).toBe(false);
    expect(ipcInputSchemas['video-lab:open-output-directory'].safeParse('../../outside').success).toBe(false);
    expect(ipcInputSchemas['video-lab:list'].safeParse(undefined).success).toBe(true);
  });

  it('pins manual generation to the selected provider without changing the saved configuration', () => {
    const config = configured();
    const selected = videoLabProviderConfig(config, 'selected');
    expect(selected.video.providers.map((provider) => provider.id)).toEqual(['selected']);
    expect(selected.video.automation).toMatchObject({ providerWhitelist: ['selected'], fallback: 'disabled', retryCount: 0 });
    expect(config.video.automation.providerWhitelist).toEqual(['first']);
    expect(() => videoLabProviderConfig(config, 'missing')).toThrow('VIDEO_LAB_PROVIDER_UNAVAILABLE');
    config.video.providers[1].apiKey = '';
    expect(() => videoLabProviderConfig(config, 'selected')).toThrow('VIDEO_LAB_PROVIDER_NOT_CONFIGURED');
  });

  it('saves UTF-8 history and snapshots references independently of projects, disabling submit retries', async () => {
    const dir = await workDirectory();
    const sources = [join(dir, '首帧.png'), join(dir, '参考图.png')];
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    for (const source of sources) await writeFile(source, png);
    let requestReceived: unknown;
    const createProvider = vi.fn<typeof createConfiguredVideoProvider>((config, recordDir): VideoProvider => ({
      id: 'selected', name: 'selected', model: 'model-selected', capabilities: ['i2v'], license: '', estimateCost: () => 0.5,
      generate: async (request) => {
        requestReceived = request;
        const path = join(recordDir, 'generated.mp4');
        await writeFile(path, 'local-video');
        return { path, providerId: 'selected', providerName: 'selected', model: 'model-selected', estimatedCost: 0.5, license: '', remoteTaskId: 'remote-1' };
      },
    }));
    const options = { rootDirectory: join(dir, 'records'), getConfig: async () => configured(), createProvider };
    const runtime = createVideoLabRuntime(options);
    const result = await runtime.generate({ ...input, firstFramePath: sources[0], referenceImagePaths: sources });
    expect(result).toMatchObject({ status: 'completed', prompt: input.prompt, providerId: 'selected', remoteTaskId: 'remote-1' });
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(createProvider.mock.calls[0][0].video.providers.map((provider: { id: string }) => provider.id)).toEqual(['selected']);
    expect(createProvider.mock.calls[0]).toHaveLength(4);
    expect((createProvider.mock.calls[0] as unknown[])[3]).toEqual({ submitRetryCount: 0 });
    expect(requestReceived).toMatchObject({ firstFramePath: result.referenceImagePaths![0] });
    expect(new Set(result.referenceImagePaths).size).toBe(2);
    for (const source of sources) await rm(source);
    expect(await readFile(result.firstFramePath!)).toEqual(png);
    expect(await createVideoLabRuntime(options).listRecords()).toEqual([result]);
    expect(await runtime.outputDirectory(result.id)).toBe(await realpath(join(dir, 'records', result.id)));
    expect(await readFile(join(dir, 'records', result.id, 'record.json'), 'utf8')).toContain(input.prompt);
  });

  it('persists configuration and reference failures without attempting a paid request', async () => {
    const dir = await workDirectory();
    const createProvider = vi.fn();
    const runtime = createVideoLabRuntime({ rootDirectory: dir, getConfig: async () => configured(), createProvider });
    const missingProvider = await runtime.generate({ ...input, providerId: 'missing' });
    expect(missingProvider).toMatchObject({ status: 'failed', videoPath: '' });
    expect(missingProvider.errorMessage).toContain('配置并启用');
    const invalidImage = join(dir, 'invalid.png');
    await writeFile(invalidImage, 'not an image');
    const invalidReference = await runtime.generate({ ...input, firstFramePath: invalidImage });
    expect(invalidReference).toMatchObject({ status: 'failed', videoPath: '' });
    expect(invalidReference.errorMessage).toContain('无法识别参考图');
    expect(createProvider).not.toHaveBeenCalled();
    expect(await runtime.listRecords()).toHaveLength(2);
  });

  it('retains service failures and converts interrupted records to actionable history on restart', async () => {
    const dir = await workDirectory();
    const createProvider = vi.fn((): VideoProvider => ({
      id: 'selected', name: 'selected', model: 'model-selected', capabilities: ['t2v'], license: '', estimateCost: () => 0,
      generate: async () => { throw new Error('VIDEO_PROVIDER_ERROR: 上游失败 api_key=hidden-secret'); },
    }));
    const options = { rootDirectory: dir, getConfig: async () => configured(), createProvider };
    const failed = await createVideoLabRuntime(options).generate(input);
    expect(failed.status).toBe('failed');
    expect(failed.errorMessage).toContain('上游失败');
    expect(failed.errorMessage).not.toContain('hidden-secret');
    expect(createProvider).toHaveBeenCalledTimes(1);
    const interrupted: VideoLabRecord = { ...failed, status: 'running', finishedAt: null };
    await writeFile(join(dir, failed.id, 'record.json'), JSON.stringify(interrupted), 'utf8');
    const recovered = await createVideoLabRuntime(options).listRecords();
    expect(recovered[0]).toMatchObject({ id: failed.id, status: 'failed' });
    expect(recovered[0].errorMessage).toContain('检查服务端任务状态');
    expect(createProvider).toHaveBeenCalledTimes(1);
  });

  it('keeps an in-flight generation running when the history is refreshed', async () => {
    const dir = await workDirectory();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const createProvider = vi.fn<typeof createConfiguredVideoProvider>((_config, recordDir) => ({
      id: 'selected', name: 'selected', model: 'model-selected', capabilities: ['t2v'], license: '', estimateCost: () => 0,
      generate: async () => {
        started();
        await gate;
        const path = join(recordDir, 'result.mp4');
        await writeFile(path, 'video');
        return { path, providerId: 'selected', providerName: 'selected', model: 'model-selected', estimatedCost: 0, license: '' };
      },
    }));
    const runtime = createVideoLabRuntime({ rootDirectory: dir, getConfig: async () => configured(), createProvider });
    const generation = runtime.generate(input);
    await ready;
    try {
      expect((await runtime.listRecords())[0].status).toBe('running');
    } finally {
      release();
    }
    expect((await generation).status).toBe('completed');
    expect((await runtime.listRecords())[0].status).toBe('completed');
  });
});
