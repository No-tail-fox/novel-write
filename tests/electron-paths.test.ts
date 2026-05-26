import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { getRendererIndexPath } from '../electron/paths';

describe('electron paths', () => {
  it('resolves the renderer index beside dist-electron', () => {
    const mainDir = join('I:', 'opc', 'dist-electron', 'electron');

    expect(getRendererIndexPath(mainDir)).toBe(join('I:', 'opc', 'dist-renderer', 'index.html'));
  });
});
