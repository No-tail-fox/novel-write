import { describe, expect, it } from 'vitest';
import config, { rendererManualChunk } from '../vite.config';

describe('vite config', () => {
  it('uses relative asset paths for the Electron file renderer', () => {
    expect(config.base).toBe('./');
    expect(config.build?.manifest).toBe(true);
  });

  it('installs the deterministic renderer entry and corpus budget gate', () => {
    const pluginNames = (config.plugins ?? []).flat().map((plugin) => plugin && 'name' in plugin ? plugin.name : null);
    expect(pluginNames).toContain('storydream-renderer-bundle-budget');
  });

  it('keeps Fluent UI and its runtime styling dependencies outside the renderer entry', () => {
    expect(rendererManualChunk('D:\\repo\\node_modules\\@fluentui\\react-components\\lib\\index.js')).toBe('fluent-ui');
    expect(rendererManualChunk('/repo/node_modules/@griffel/react/dist/index.js')).toBe('fluent-ui');
    expect(rendererManualChunk('/repo/src/app/App.tsx')).toBeUndefined();
  });

  it('keeps the shared validation runtime outside the renderer entry', () => {
    expect(rendererManualChunk('/repo/node_modules/zod/v4/index.js')).toBe('zod');
  });
});
