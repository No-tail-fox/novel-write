import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { detectJianyingDraftPath, legacyDefaultJianyingDraftPath, resolveRuntimeJianyingDraftPath } from '@shared/jianying-paths';

describe('Jianying draft path resolution', () => {
  it('does not ship a machine-specific draft path as the default config', () => {
    expect(defaultConfig.jianying.draftPath).toBe('');
  });

  it('detects common Jianying project folders under LOCALAPPDATA', () => {
    const localAppData = join('C:', 'Users', 'pc', 'AppData', 'Local');
    const expected = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
    const existing = new Set([expected]);

    expect(
      detectJianyingDraftPath({
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: (path) => existing.has(path),
      }),
    ).toBe(expected);
  });

  it('replaces a missing legacy default path with a detected local draft path', () => {
    const localAppData = join('C:', 'Users', 'pc', 'AppData', 'Local');
    const detected = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
    const existing = new Set([detected]);

    expect(
      resolveRuntimeJianyingDraftPath(legacyDefaultJianyingDraftPath, {
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: (path) => existing.has(path),
      }),
    ).toBe(detected);
  });

  it('preserves an explicit user path even when it is not a common auto-detected location', () => {
    const explicit = join('D:', 'VideoDrafts', 'Jianying');

    expect(
      resolveRuntimeJianyingDraftPath(explicit, {
        env: { LOCALAPPDATA: join('C:', 'Users', 'pc', 'AppData', 'Local'), USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: () => false,
      }),
    ).toBe(explicit);
  });

  it('re-detects the local draft folder when a migrated explicit path is stale', () => {
    const oldMachinePath = join('C:', 'Users', 'old-pc', 'Documents', 'JianyingPro Drafts');
    const localAppData = join('D:', 'Users', 'new-pc', 'AppData', 'Local');
    const detected = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
    const existing = new Set([detected]);

    expect(
      resolveRuntimeJianyingDraftPath(oldMachinePath, {
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('D:', 'Users', 'new-pc') },
        pathExists: (path) => existing.has(path),
      }),
    ).toBe(detected);
  });

  it('keeps an existing custom draft folder ahead of auto-detected locations', () => {
    const custom = join('E:', 'Portable', 'Jianying Drafts');
    const localAppData = join('C:', 'Users', 'pc', 'AppData', 'Local');
    const detected = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
    const existing = new Set([custom, detected]);

    expect(
      resolveRuntimeJianyingDraftPath(custom, {
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: (path) => existing.has(path),
      }),
    ).toBe(custom);
  });
});
