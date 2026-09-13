import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashDirectorRenderOutput } from '../electron/director-render-output';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';

const directories: string[] = [];
afterAll(() => removeTestTempDirectories(...directories));

describe('director render output digest', () => {
  it('hashes a file spanning many read chunks including a partial final chunk', async () => {
    const directory = await createTestTempDirectory(join(tmpdir(), 'director-output-digest-'));
    directories.push(directory);
    const path = join(directory, 'final.mp4');
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 137);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    await writeFile(path, bytes);
    expect(await hashDirectorRenderOutput(path, bytes.length)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('refuses to register a truncated or empty output', async () => {
    const directory = await createTestTempDirectory(join(tmpdir(), 'director-output-size-'));
    directories.push(directory);
    const path = join(directory, 'final.mp4');
    await writeFile(path, 'short');
    await expect(hashDirectorRenderOutput(path, 500)).rejects.toMatchObject({ code: 'DIRECTOR_RENDER_OUTPUT_CHANGED' });
    await writeFile(path, '');
    await expect(hashDirectorRenderOutput(path, 0)).rejects.toMatchObject({ code: 'DIRECTOR_RENDER_OUTPUT_CHANGED' });
  });
});
