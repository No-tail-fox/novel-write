import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { disableLemoGlobalGitBash } from '../services/lemo-agent-worker/windows-shell';
let root: string;
beforeEach(async () => { await mkdir(resolve('.artifacts'), { recursive: true }); root = await mkdtemp(resolve('.artifacts/lemo-shell-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe('official worker Windows shell independence', () => {
  it('overrides global Bash discovery with the deliberately unavailable isolated path', async () => {
    const env = { CLAUDE_CODE_GIT_BASH_PATH: 'C:/Program Files/Git/bin/bash.exe', PATH: 'machine-path' };
    await disableLemoGlobalGitBash(env, root, 'win32');
    expect(env.CLAUDE_CODE_GIT_BASH_PATH).toBe(join(root, 'shell-unavailable/bash.exe'));
    expect(env.PATH).toBe('machine-path');
  });
  it('does not execute or accept an executable unexpectedly placed at that path', async () => {
    await mkdir(join(root, 'shell-unavailable')); await writeFile(join(root, 'shell-unavailable/bash.exe'), 'unexpected executable', 'utf8');
    await expect(disableLemoGlobalGitBash({}, root, 'win32')).rejects.toThrow('LEMO_SDK_SHELL_PATH_OCCUPIED');
  });
  it('leaves other platforms unchanged', async () => {
    const env = {}; await disableLemoGlobalGitBash(env, root, 'linux'); expect(env).toEqual({});
  });
});
