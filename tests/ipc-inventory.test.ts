import { readFile } from 'node:fs/promises';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { storyDreamApi } from '../electron/preload';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { INVOKE_CHANNELS, type StoryDreamApi } from '../src/shared/storydream-api';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

function extractPreloadInvokeChannels(source: string): string[] {
  return [...source.matchAll(/invokeTrusted(?:<[^>]+>)?\('([^']+)'/gu)].map((match) => match[1]);
}

describe('renderer IPC inventory', () => {
  it('defines exactly one input schema for every canonical invoke channel', () => {
    expect(new Set(INVOKE_CHANNELS).size).toBe(INVOKE_CHANNELS.length);
    expect(new Set(Object.keys(ipcInputSchemas))).toEqual(new Set(INVOKE_CHANNELS));
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
});
