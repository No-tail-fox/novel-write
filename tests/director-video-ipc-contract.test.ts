import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { directorGenerateShotVideoRequestSchema, ipcInputSchemas } from '../src/shared/ipc-contract';
import { INVOKE_CHANNELS } from '../src/shared/storydream-api';

describe('director video IPC contract', () => {
  it('accepts only the persisted project, shot, and revision token', () => {
    const input = {
      id: 'vox-project-1',
      shotId: 'shot-1',
      expectedUpdatedAt: '2026-09-05T00:00:00.000Z',
    };

    expect(directorGenerateShotVideoRequestSchema.parse(input)).toEqual(input);
    expect(ipcInputSchemas['director:generate-shot-video'].parse(input)).toEqual(input);

    for (const forbidden of [
      { apiKey: 'sk-secret' },
      { firstFramePath: 'C:/private/frame.png' },
      { budget: 10 },
      { outputPath: 'C:/private/output.mp4' },
    ]) {
      expect(() => directorGenerateShotVideoRequestSchema.parse({ ...input, ...forbidden })).toThrow();
    }
  });

  it('keeps the channel canonical and browser fallback validation explicit', async () => {
    expect(INVOKE_CHANNELS).toContain('director:generate-shot-video');
    const [preload, fallback, api] = await Promise.all([
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    expect(preload).toContain("invokeTrusted('director:generate-shot-video', input)");
    expect(fallback).toContain('validateDirectorGenerateShotVideoRequest(input)');
    expect(fallback).toContain('DIRECTOR_VIDEO_DESKTOP_ONLY');
    expect(api).toContain('generateDirectorShotVideo: (input: DirectorGenerateShotVideoRequest)');
  });

  it('exposes the subtitle recheck channel through the desktop bridge', async () => {
    const input = {
      id: 'vox-project-1', reportId: 'report-1', renderFingerprint: 'director-v3-abc',
      shotIds: ['shot-1'], cueIds: ['cue-1'], expectedUpdatedAt: '2026-09-09T00:00:00.000Z',
    };
    expect(ipcInputSchemas['director:recheck-subtitles'].parse(input)).toEqual(input);
    expect(INVOKE_CHANNELS).toContain('director:recheck-subtitles');
    const [preload, fallback, api] = await Promise.all([
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    expect(preload).toContain("invokeTrusted('director:recheck-subtitles', input)");
    expect(fallback).toContain('recheckDirectorSubtitles');
    expect(api).toContain('recheckDirectorSubtitles: (input: DirectorSubtitleRecheckRequest)');
  });

  it('exposes the media recheck channel with an explicit scoped request', async () => {
    const input = {
      id: 'vox-project-1', reportId: 'report-1', renderFingerprint: 'director-v3-abc',
      shotIds: ['shot-1', 'shot-2'], startMs: 1000, endMs: 5200,
      expectedUpdatedAt: '2026-09-09T00:00:00.000Z',
    };
    expect(ipcInputSchemas['director:recheck-media'].parse(input)).toEqual(input);
    expect(() => ipcInputSchemas['director:recheck-media'].parse({ ...input, shotIds: [] })).toThrow();
    expect(() => ipcInputSchemas['director:recheck-media'].parse({ ...input, endMs: -1 })).toThrow();
    expect(INVOKE_CHANNELS).toContain('director:recheck-media');
    const [preload, fallback, api] = await Promise.all([
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);
    expect(preload).toContain("invokeTrusted('director:recheck-media', input)");
    expect(fallback).toContain('recheckDirectorMedia');
    expect(fallback).toContain('DIRECTOR_RECHECK_DESKTOP_ONLY');
    expect(api).toContain('recheckDirectorMedia: (input: DirectorMediaRecheckRequest)');
  });
});
