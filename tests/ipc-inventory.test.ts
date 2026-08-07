import { readFile } from 'node:fs/promises';
import { ipcRenderer } from 'electron';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { storyDreamApi } from '../electron/preload';
import { ipcInputSchemas, MAX_IPC_TEXT } from '../src/shared/ipc-contract';
import { INVOKE_CHANNELS, type StoryDreamApi } from '../src/shared/storydream-api';
import type { AppMutationResult } from '../src/shared/types';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

function extractPreloadInvokeChannels(source: string): string[] {
  return [...source.matchAll(/invokeTrusted(?:<[^>]+>)?\('([^']+)'/gu)].map((match) => match[1]);
}

describe('renderer IPC inventory', () => {
  beforeEach(() => {
    vi.mocked(ipcRenderer.invoke).mockReset().mockResolvedValue({ ok: true, value: { items: [], nextCursor: null } });
  });

  it('defines exactly one input schema for every canonical invoke channel', () => {
    expect(INVOKE_CHANNELS).toHaveLength(116);
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(new Set(Object.keys(ipcInputSchemas))).toEqual(new Set(INVOKE_CHANNELS));
    expect(INVOKE_CHANNELS).toContain('task:open-output-directory');
    expect(INVOKE_CHANNELS).toContain('image-lab:open-output-directory');
    expect(INVOKE_CHANNELS).toContain('person-assets:open-directory');
    expect(INVOKE_CHANNELS).not.toContain('path:open');
  });

  it('routes directory opening through persisted entity IDs and person names instead of renderer paths', async () => {
    await storyDreamApi.openTaskOutputDirectory('task-safe-id');
    await storyDreamApi.openImageLabOutputDirectory('image-safe-id');
    await storyDreamApi.openPersonAssetDirectory('人物甲');

    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['task:open-output-directory', 'task-safe-id'],
      ['image-lab:open-output-directory', 'image-safe-id'],
      ['person-assets:open-directory', '人物甲'],
    ]);
    expect(storyDreamApi).not.toHaveProperty('openPath');
  });

  it('routes task favorite mutations and preserves the favorite history filter', async () => {
    await storyDreamApi.setTaskFavorite('task-favorite-id', true);
    await storyDreamApi.listTasks({ favorite: true });

    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['task:set-favorite', { id: 'task-favorite-id', isFavorite: true }],
      ['task:list', { family: 'task', filter: 'active', favorite: true }],
    ]);
  });

  it('routes typed HTML config changes through the dedicated preload channel', async () => {
    const changes = [{ field: 'transitionType', value: 'dissolve' }] as const;
    await storyDreamApi.updateHtmlVideoConfig('html-task-1', [...changes]);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('html-video:update-config', {
      id: 'html-task-1',
      changes,
    });
  });

  it('routes manual cover import by task id without exposing an external path parameter', async () => {
    await storyDreamApi.importHtmlVideoCover('html-task-1');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('html-video:import-cover', 'html-task-1');
  });

  it('routes bounded HyperFrames lint through the trusted main-process channel', async () => {
    const input = { taskId: 'html-task-1', sceneIndex: 1, source: '<!doctype html><html></html>' };
    await storyDreamApi.lintHtmlVideoCompositionSource(input);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('html-video:composition-source:lint', input);
  });

  it('routes ordinary cover import by ratio without exposing an external path parameter', async () => {
    await storyDreamApi.importOrdinaryTaskCover('9:16');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('task:import-cover', '9:16');
  });

  it('routes image clipboard copy and explicit reference selections through trusted task channels', async () => {
    await storyDreamApi.copyTaskImage('task-image-id', 3);
    await storyDreamApi.referenceEditTaskImage('task-image-id', 3, '保留人物，改为夜景', ['D:\\refs\\one.png']);

    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual([
      ['task:copy-image', { id: 'task-image-id', sceneId: 3 }],
      ['task:reference-edit-image', {
        id: 'task-image-id',
        sceneId: 3,
        prompt: '保留人物，改为夜景',
        referenceImagePaths: ['D:\\refs\\one.png'],
      }],
    ]);
  });

  it('routes book selection saves with the previous composite identity intact', async () => {
    const input = { theme: 'new', bookId: 'new-id', previousIdentity: { theme: 'old', bookId: 'old-id' }, data: { name: 'Book' } };
    await storyDreamApi.saveBookSelection(input);
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('book-selection:save', input);
  });

  it('keeps actual preload invoke calls in exact canonical order', async () => {
    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    const PRELOAD_INVOKE_CHANNELS = extractPreloadInvokeChannels(preload);

    expect(PRELOAD_INVOKE_CHANNELS).toEqual(INVOKE_CHANNELS);
  });

  it('implements the shared renderer API and audits app deltas as an event subscription', async () => {
    expectTypeOf(storyDreamApi).toMatchTypeOf<StoryDreamApi>();
    expectTypeOf<StoryDreamApi>().toMatchTypeOf<typeof storyDreamApi>();

    const preload = await readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8');
    expect(preload).toContain("ipcRenderer.on('app:delta', listener)");
    expect(preload).toContain("ipcRenderer.off('app:delta', listener)");
    expect(INVOKE_CHANNELS).not.toContain('app:delta');
  });

  it('returns revision-bearing mutation results from every history governance method', () => {
    type GovernanceMethod =
      | 'archiveTask'
      | 'restoreTask'
      | 'deleteTaskPermanently'
      | 'archiveViralAnalysis'
      | 'restoreViralAnalysis'
      | 'deleteViralAnalysisPermanently'
      | 'archiveImageLabRecord'
      | 'restoreImageLabRecord'
      | 'deleteImageLabRecordPermanently'
      | 'archiveVoiceLabRecord'
      | 'restoreVoiceLabRecord'
      | 'deleteVoiceLabRecordPermanently';

    expectTypeOf<ReturnType<StoryDreamApi[GovernanceMethod]>>()
      .toEqualTypeOf<Promise<AppMutationResult>>();
    expectTypeOf<ReturnType<(typeof storyDreamApi)[GovernanceMethod]>>()
      .toEqualTypeOf<Promise<AppMutationResult>>();
  });

  it('fixes each list family, defaults active, trims query, and drops renderer-only keys', async () => {
    const historyApi = storyDreamApi as unknown as {
      listTasks: (request?: Record<string, unknown>) => Promise<unknown>;
      listViralAnalyses: (request?: Record<string, unknown>) => Promise<unknown>;
      listImageLabRecords: (request?: Record<string, unknown>) => Promise<unknown>;
      listVoiceLabRecords: (request?: Record<string, unknown>) => Promise<unknown>;
    };

    await historyApi.listTasks({
      family: 'voice-lab',
      filter: 'archived',
      taskType: 'html-video',
      statuses: ['pending', 'running'],
      query: '  launch copy  ',
      cursor: 'task-cursor',
      limit: 25,
      extra: true,
    });
    await historyApi.listViralAnalyses({ family: 'task', query: '   ', status: 'completed' });
    await historyApi.listImageLabRecords({ family: 'task', status: 'generated' });
    await historyApi.listVoiceLabRecords({ family: 'image-lab', filter: 'archived', status: 'failed', query: '  voice  ' });

    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(1, 'task:list', {
      family: 'task',
      filter: 'archived',
      taskType: 'html-video',
      statuses: ['pending', 'running'],
      query: 'launch copy',
      cursor: 'task-cursor',
      limit: 25,
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(2, 'viral:list', {
      family: 'viral-analysis',
      filter: 'active',
      status: 'completed',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(3, 'image-lab:list', {
      family: 'image-lab',
      filter: 'active',
      status: 'generated',
    });
    expect(ipcRenderer.invoke).toHaveBeenNthCalledWith(4, 'voice-lab:list', {
      family: 'voice-lab',
      filter: 'archived',
      status: 'failed',
      query: 'voice',
    });

    for (const listHistory of [
      historyApi.listTasks,
      historyApi.listViralAnalyses,
      historyApi.listImageLabRecords,
      historyApi.listVoiceLabRecords,
    ]) {
      await expect(listHistory({ filter: null })).rejects.toThrow(TypeError);
      await expect(listHistory({ query: 42 })).rejects.toThrow(TypeError);
      await expect(listHistory({ query: ' '.repeat(MAX_IPC_TEXT + 1) })).rejects.toThrow(TypeError);
    }
    expect(ipcRenderer.invoke).toHaveBeenCalledTimes(4);
  });

  it('routes all family governance methods through the 12 canonical channels', async () => {
    const historyApi = storyDreamApi as unknown as Record<string, (id: string) => Promise<unknown>>;
    const methods = [
      ['archiveTask', 'task:archive'],
      ['restoreTask', 'task:restore'],
      ['deleteTaskPermanently', 'task:delete'],
      ['archiveViralAnalysis', 'viral:archive'],
      ['restoreViralAnalysis', 'viral:restore'],
      ['deleteViralAnalysisPermanently', 'viral:delete'],
      ['archiveImageLabRecord', 'image-lab:archive'],
      ['restoreImageLabRecord', 'image-lab:restore'],
      ['deleteImageLabRecordPermanently', 'image-lab:delete'],
      ['archiveVoiceLabRecord', 'voice-lab:archive'],
      ['restoreVoiceLabRecord', 'voice-lab:restore'],
      ['deleteVoiceLabRecordPermanently', 'voice-lab:delete'],
    ] as const;

    for (const [method] of methods) await historyApi[method]('safe-id');

    expect(vi.mocked(ipcRenderer.invoke).mock.calls).toEqual(
      methods.map(([, channel]) => [channel, 'safe-id']),
    );
  });
});
