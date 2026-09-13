import { describe, expect, it } from 'vitest';
import { detectStoryDreamRuntime, parseBrowserCompanionConfig } from '../src/shared/runtime-capabilities';

function fakeApi() {
  return { getBootstrap: async () => ({}), getState: async () => ({}) } as never;
}

describe('runtime capabilities', () => {
  it('detects Electron from the preload API', () => {
    const runtime = detectStoryDreamRuntime({ storydream: fakeApi(), storybound: undefined });
    expect(runtime.kind).toBe('electron');
    expect(runtime.canLaunchJianying).toBe(true);
  });

  it('keeps plain browser preview explicitly limited', () => {
    const runtime = detectStoryDreamRuntime({ storydream: undefined, storybound: undefined });
    expect(runtime.kind).toBe('browser-fallback');
    expect(runtime.canWriteJianyingDraft).toBe(false);
  });

  it('accepts only loopback companion origins', () => {
    expect(parseBrowserCompanionConfig('{"origin":"http://127.0.0.1:3187","pairingToken":"short"}')?.origin).toBe('http://127.0.0.1:3187');
    expect(parseBrowserCompanionConfig('{"origin":"https://example.com"}')).toBeNull();
    expect(parseBrowserCompanionConfig('{"origin":"http://localhost:3187"}')).toBeNull();
    for (const origin of ['http://127.0.0.1:99999', 'http://127.0.0.1:3187/run', 'http://user@127.0.0.1', 'http://127.0.0.1?token=x']) {
      expect(parseBrowserCompanionConfig(JSON.stringify({ origin }))).toBeNull();
    }
    expect(parseBrowserCompanionConfig('null')).toBeNull();
  });

  it('does not grant local capabilities from a saved address or token', () => {
    const config = parseBrowserCompanionConfig('{"origin":"http://127.0.0.1:3187","pairingToken":"unverified"}');
    const runtime = detectStoryDreamRuntime({}, config);
    expect(runtime.kind).toBe('browser-fallback');
    expect(runtime.api).toBeNull();
    expect(runtime.canReadLocalFiles).toBe(false);
    expect(runtime.canWriteJianyingDraft).toBe(false);
    expect(runtime.canRunLocalPipelines).toBe(false);
  });
});
