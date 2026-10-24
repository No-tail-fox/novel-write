import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BACKGROUND_REMOVAL_MODEL, ensureBackgroundRemovalModel } from '../electron/background-removal-model';

const bytes = Buffer.from('local model installer fixture');
const descriptor = { ...DEFAULT_BACKGROUND_REMOVAL_MODEL, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

async function isolated(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'storydream-cutout-model-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

describe('shared cutout model installation', () => {
  it('deduplicates concurrent installs and reuses verified cached weights without downloading again', async () => isolated(async (directory) => {
    let downloads = 0;
    const options = { descriptor, download: async () => { downloads++; return bytes; } };
    const models = await Promise.all([ensureBackgroundRemovalModel(directory, options), ensureBackgroundRemovalModel(directory, options)]);
    expect(downloads).toBe(1);
    expect(models[0]).toEqual(models[1]);
    expect(models[0].revision).toBe(descriptor.revision);
    expect(await readFile(models[0].path)).toEqual(bytes);
    await ensureBackgroundRemovalModel(directory, options);
    expect(downloads).toBe(1);
  }));

  it('rejects corrupt downloads before publication and permits an independent retry', async () => isolated(async (directory) => {
    await expect(ensureBackgroundRemovalModel(directory, { descriptor, download: async () => Buffer.from('broken') })).rejects.toThrow('BACKGROUND_REMOVAL_MODEL_INVALID');
    expect(await readdir(directory)).toEqual([]);
    await ensureBackgroundRemovalModel(directory, { descriptor, download: async () => bytes });
    expect(await readFile(join(directory, descriptor.file))).toEqual(bytes);
  }));

  it('rejects corrupted cached weights without overwriting or silently redownloading', async () => isolated(async (directory) => {
    await writeFile(join(directory, descriptor.file), 'broken');
    let downloads = 0;
    await expect(ensureBackgroundRemovalModel(directory, { descriptor, download: async () => { downloads++; return bytes; } })).rejects.toThrow('BACKGROUND_REMOVAL_MODEL_INVALID');
    expect(downloads).toBe(0);
    expect(await readFile(join(directory, descriptor.file), 'utf8')).toBe('broken');
  }));
});
