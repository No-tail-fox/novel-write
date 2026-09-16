import { readFile } from 'node:fs/promises';
import { ipcRenderer } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storyDreamApi } from '../electron/preload';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { defaultConfig } from '../src/shared/config';
import type { MusicLabGenerateInput } from '../src/shared/music-lab';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

const recordId = 'e89d67e6-cf6b-4270-aac5-8a8d3bb8f392';
const trackId = '64a39f5b-1a59-4d41-bcd6-0bd8559e40a2';
const generation: MusicLabGenerateInput = {
  mode: 'description', model: 'suno-v6', description: '安静的钢琴配乐',
  instrumental: true, maxMode: false, variety: 0,
};

describe('music lab IPC boundary', () => {
  it('accepts connection tests for every model settings category', () => {
    for (const target of ['llm', 'image', 'video', 'music', 'tts', 'speechToText', 'vision']) {
      const request = { target, config: defaultConfig, secretChanges: {} };
      expect(ipcInputSchemas['config:test'].parse(request)).toEqual(request);
    }
    expect(() => ipcInputSchemas['config:test'].parse({ target: 'unknown', config: defaultConfig, secretChanges: {} })).toThrow();
  });
  beforeEach(() => {
    vi.mocked(ipcRenderer.invoke).mockReset().mockResolvedValue({ ok: true, value: undefined });
  });

  it('routes generation and helpers through the trusted bridge', async () => {
    const lyrics = { model: 'suno-v6' as const, instruction: '写一段关于夏天的歌词' };
    const style = { model: 'suno-v6' as const, style: '钢琴与弦乐', instrumental: true };
    await storyDreamApi.getMusicLabServiceStatus();
    await storyDreamApi.getMusicLabBalance();
    await storyDreamApi.listMusicLabRecords();
    await storyDreamApi.generateMusicLab(generation);
    await storyDreamApi.refreshMusicLabRecord(recordId);
    await storyDreamApi.generateMusicLabLyrics(lyrics);
    await storyDreamApi.boostMusicLabStyle(style);
    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['music-lab:service-status', undefined], ['music-lab:balance', undefined], ['music-lab:list', undefined],
      ['music-lab:generate', generation], ['music-lab:refresh', recordId],
      ['music-lab:lyrics', lyrics], ['music-lab:boost-style', style],
    ]);
  });

  it('uses owned record and track IDs for downloads, BGM import and directory access', async () => {
    const download = { recordId, trackId, format: 'wav' as const };
    await storyDreamApi.downloadMusicLabTrack(download);
    await storyDreamApi.importMusicLabTrackAsBgm({ recordId, trackId });
    await storyDreamApi.openMusicLabOutputDirectory(recordId);
    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['music-lab:download', download],
      ['music-lab:import-bgm', { recordId, trackId }],
      ['music-lab:open-output-directory', recordId],
    ]);
    expect(ipcInputSchemas['music-lab:download'].parse(download)).toEqual(download);
    expect(() => ipcInputSchemas['music-lab:download'].parse({ ...download, url: 'https://untrusted.invalid/song.mp3' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:import-bgm'].parse({ recordId, trackId, path: 'C:\\private.wav' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:import-bgm'].parse({ recordId: '..', trackId })).toThrow();
    expect(() => ipcInputSchemas['music-lab:open-output-directory'].parse('C:\\')).toThrow();
  });

  it('rejects credentials, endpoints and invalid model parameters from the renderer', () => {
    expect(ipcInputSchemas['music-lab:generate'].parse(generation)).toEqual(generation);
    expect(() => ipcInputSchemas['music-lab:generate'].parse({ ...generation, apiKey: 'injected' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:generate'].parse({ ...generation, baseUrl: 'http://127.0.0.1' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:generate'].parse({ ...generation, model: 'unsupported' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:generate'].parse({ ...generation, variety: 100 })).toThrow();
    expect(() => ipcInputSchemas['music-lab:balance'].parse({ apiKey: 'injected' })).toThrow();
  });

  it('routes advanced operations by owned sources and rejects arbitrary URL and upload fields', async () => {
    const operation = { operation: 'reverse' as const, model: 'suno-v6' as const, sources: [{ recordId, trackId }] };
    const upload = { audioPath: 'C:\\managed\\source.mp3', model: 'suno-v6' as const, title: '本地旋律' };
    await storyDreamApi.performMusicLabOperation(operation);
    await storyDreamApi.uploadMusicLabSource(upload);
    await storyDreamApi.syncMusicLabHistory();
    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['music-lab:operation', operation], ['music-lab:upload-source', upload], ['music-lab:sync-history', undefined],
    ]);
    expect(ipcInputSchemas['music-lab:operation'].parse(operation)).toEqual(operation);
    expect(() => ipcInputSchemas['music-lab:operation'].parse({ ...operation, sourceAudioUrl: 'https://untrusted.invalid/music.mp3' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:upload-source'].parse({ ...upload, apiKey: 'injected' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:upload-source'].parse({ ...upload, audioPath: '../source.mp3' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:upload-source'].parse({ ...upload, audioPath: 'https://untrusted.invalid/source.mp3' })).toThrow();
  });

  it('routes voice actions through the shared boundary and selects audio through the managed picker', async () => {
    const voice = { action: 'generate' as const, taskId: 1, model: 'suno-v6' as const, prompt: '温柔的夏夜', custom: false, style: '', title: '夏夜', maxMode: false, variety: 0, styleWeight: 0.5, weirdness: 0.5 };
    await storyDreamApi.musicLabVoice({ action: 'list' });
    await storyDreamApi.musicLabVoice(voice);
    await storyDreamApi.importBgmAudio();
    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['music-lab:voice', { action: 'list' }], ['music-lab:voice', voice], ['local-audio:select', 'managed-bgm'],
    ]);
    expect(ipcInputSchemas['music-lab:voice'].parse(voice)).toEqual(voice);
    expect(() => ipcInputSchemas['music-lab:voice'].parse({ ...voice, apiKey: 'injected' })).toThrow();
    expect(() => ipcInputSchemas['music-lab:voice'].parse({ ...voice, taskId: 0 })).toThrow();
    expect(() => ipcInputSchemas['music-lab:voice'].parse({ ...voice, custom: true })).toThrow();
  });

  it('keeps credentials in main and imports only persisted local tracks into the managed BGM library', async () => {
    const [main, preload, fallback] = await Promise.all([
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8'),
    ]);
    expect(main).toContain('resolveEnvironmentApiKey: resolveMusicLabApiKey');
    expect(main).toContain('process.env.SUNO_API_KEY');
    expect(main).toContain("GetEnvironmentVariable('SUNO_API_KEY', 'User')");
    expect(main).toContain('windowsHide: true');
    expect(main).toContain('resolveManagedBgmFilePath(appDataDir(), basename(input.audioPath))');
    expect(main).toContain('normalizePath(input.audioPath) !== normalizePath(expectedPath)');
    expect(main).toContain('normalizePath(dirname(sourcePath)) !== normalizePath(managedRoot)');
    expect(main).toContain("const record = await runtime.downloadTrack({ ...input, format: 'mp3' })");
    expect(main).toContain('const sourcePath = track.localMp3Path || track.localWavPath');
    expect(main).toContain('await importManagedBgm(sourcePath, appDataDir())');
    expect(main).toContain("publishStatePatch({ kind: 'config', ...saved })");
    expect(preload).not.toContain('SUNO_API_KEY');
    expect(fallback).not.toContain('SUNO_API_KEY');
    expect(fallback).toContain("return { configured: false, providerName: 'Suno-API' }");
  });
});
