import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeWindowsManagedFile } from '../electron/windows-managed-file';

const cleanupRoots: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.runIf(process.platform === 'win32')('Windows managed file writer', () => {
  it('writes through an identity-pinned non-reparse directory handle', async () => {
    const root = await temporaryRoot('storydream-windows-managed-file-');
    const directory = join(root, 'managed');
    const destination = join(directory, 'imported.png');
    await mkdir(directory);
    const identity = await stat(directory, { bigint: true });
    const bytes = Buffer.from('validated bytes');

    await writeWindowsManagedFile(directory, destination, identityJson(identity), bytes);

    expect(await readFile(destination)).toEqual(bytes);
  }, 30_000);

  it('rejects a replaced directory before creating the destination', async () => {
    const root = await temporaryRoot('storydream-windows-managed-file-race-');
    const directory = join(root, 'managed');
    const displaced = join(root, 'managed-displaced');
    const destination = join(directory, 'imported.png');
    await mkdir(directory);
    const identity = await stat(directory, { bigint: true });
    await rename(directory, displaced);
    await mkdir(directory);

    await expect(writeWindowsManagedFile(directory, destination, identityJson(identity), Buffer.from('validated bytes'))).rejects.toThrow(/identity|changed/i);
    expect(await readdir(directory)).toEqual([]);
  }, 30_000);
});

function identityJson(value: { dev: bigint; ino: bigint }): string {
  return JSON.stringify({ version: 1, dev: String(value.dev), ino: String(value.ino) });
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}
