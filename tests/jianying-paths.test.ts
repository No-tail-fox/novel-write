import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import {
  candidateJianyingDraftPaths,
  detectJianyingDraftPath,
  detectJianyingDraftPathResult,
  legacyDefaultJianyingDraftPath,
  resolveRuntimeJianyingDraftPath,
} from '@shared/jianying-paths';

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

  it('reads the target computer custom draft path before checking standard locations', () => {
    const localAppData = join('D:', 'Profiles', 'Alice', 'AppData', 'Local');
    const customDraftPath = join('E:', 'Video Work', 'Jianying Drafts');
    const configPath = join(localAppData, 'JianyingPro', 'User Data', 'Config', 'globalSetting');
    const standardPath = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');

    expect(
      detectJianyingDraftPathResult({
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('D:', 'Profiles', 'Alice') },
        readTextFile: (path) => path === configPath
          ? `[General]\ncurrentCustomDraftPath=${customDraftPath.replace(/\\/gu, '\\\\')}\n`
          : null,
        pathExists: (path) => path === customDraftPath || path === standardPath,
        pathIsDirectory: () => true,
        pathWritable: () => true,
        directoryEntries: () => [{ name: 'Alice draft', isDirectory: true }],
      }),
    ).toMatchObject({
      status: 'pass',
      path: customDraftPath,
      draftCount: 1,
    });
  });

  it('derives LOCALAPPDATA from the target user profile and supports CapCut UserData', () => {
    const homeDir = join('F:', 'Users', 'Editor');
    const expected = join(homeDir, 'AppData', 'Local', 'CapCut', 'UserData', 'Projects', 'com.lveditor.draft');

    expect(
      detectJianyingDraftPath({
        env: {},
        homeDir,
        pathExists: (path) => path === expected,
      }),
    ).toBe(expected);
  });

  it('does not probe the old machine-specific G drive unless Jianying config declares it', () => {
    expect(candidateJianyingDraftPaths({
      env: { LOCALAPPDATA: join('C:', 'Users', 'new-user', 'AppData', 'Local') },
      homeDir: join('C:', 'Users', 'new-user'),
      readTextFile: () => null,
    })).not.toContain(legacyDefaultJianyingDraftPath);
  });

  it('reports a validated writable Jianying directory with metadata and draft count', () => {
    const localAppData = join('C:', 'Users', 'pc', 'AppData', 'Local');
    const expected = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');

    expect(
      detectJianyingDraftPathResult({
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: (path) => path === expected,
        pathIsDirectory: (path) => path === expected,
        pathWritable: (path) => path === expected,
        directoryEntries: () => [
          { name: 'root_meta_info.json', isDirectory: false },
          { name: '.recycle_bin', isDirectory: true },
          { name: 'Draft one', isDirectory: true },
          { name: 'Draft two', isDirectory: true },
        ],
      }),
    ).toMatchObject({
      status: 'pass',
      reason: 'detected',
      path: expected,
      draftCount: 2,
      checks: { isDirectory: true, writable: true, hasJianyingMetadata: true },
    });
  });

  it('rejects file and unwritable candidates instead of treating existence as success', () => {
    const localAppData = join('C:', 'Users', 'pc', 'AppData', 'Local');
    const fileCandidate = join(localAppData, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
    const unwritableCandidate = join(localAppData, 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');

    expect(
      detectJianyingDraftPathResult({
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: (path) => path === fileCandidate || path === unwritableCandidate,
        pathIsDirectory: (path) => path === unwritableCandidate,
        pathWritable: () => false,
      }),
    ).toMatchObject({
      status: 'warn',
      reason: 'unusable-draft-directory',
      path: '',
    });
  });

  it('distinguishes an installed Jianying profile from a missing draft directory', () => {
    const localAppData = join('C:', 'Users', 'pc', 'AppData', 'Local');
    const userData = join(localAppData, 'JianyingPro', 'User Data');

    expect(
      detectJianyingDraftPathResult({
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'pc') },
        pathExists: (path) => path === userData,
      }),
    ).toMatchObject({
      status: 'warn',
      reason: 'missing-draft-directory',
      path: '',
      installationDetected: true,
    });
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

  it('prefers the target computer custom path over an existing legacy G drive setting', () => {
    const localAppData = join('C:', 'Users', 'portable-user', 'AppData', 'Local');
    const configPath = join(localAppData, 'JianyingPro', 'User Data', 'Config', 'globalSetting');
    const detected = join('D:', 'Portable Drafts');

    expect(
      resolveRuntimeJianyingDraftPath(legacyDefaultJianyingDraftPath, {
        env: { LOCALAPPDATA: localAppData, USERPROFILE: join('C:', 'Users', 'portable-user') },
        readTextFile: (path) => path === configPath
          ? `[General]\ncurrentCustomDraftPath=${detected.replace(/\\/gu, '\\\\')}\n`
          : null,
        pathExists: (path) => path === legacyDefaultJianyingDraftPath || path === detected,
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
