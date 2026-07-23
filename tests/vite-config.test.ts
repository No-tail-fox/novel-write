import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('vite config', () => {
  it('uses relative asset paths for the Electron file renderer', () => {
    expect(config.base).toBe('./');
    expect(config.build?.manifest).toBe(true);
  });

  it('installs the deterministic renderer entry and corpus budget gate', () => {
    const pluginNames = (config.plugins ?? []).flat().map((plugin) => plugin && 'name' in plugin ? plugin.name : null);
    expect(pluginNames).toContain('storydream-renderer-bundle-budget');
  });
});
