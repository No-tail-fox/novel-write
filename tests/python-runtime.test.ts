import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { resolvePythonCommand, resolvePythonRuntimeInfo } from '@shared/python-runtime';

describe('Python runtime resolution', () => {
  it('uses the bundled Windows Python executable when it exists under resources', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-python-runtime-'));

    try {
      const pythonExe = join(dir, 'python', 'python.exe');
      await mkdir(join(dir, 'python'), { recursive: true });
      await writeFile(pythonExe, '');

      expect(resolvePythonCommand({ resourcesPath: dir, platform: 'win32' })).toBe(pythonExe);
      expect(resolvePythonRuntimeInfo({ resourcesPath: dir, platform: 'win32' })).toEqual({
        command: pythonExe,
        source: 'bundled',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to the system python command when no bundled runtime exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-python-runtime-missing-'));

    try {
      expect(resolvePythonCommand({ resourcesPath: dir, platform: 'win32' })).toBe('python');
      expect(resolvePythonRuntimeInfo({ resourcesPath: dir, platform: 'win32' })).toEqual({
        command: 'python',
        source: 'system',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
