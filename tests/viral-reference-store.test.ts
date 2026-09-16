import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FileDatabase } from '../src/shared/storage';
import { readReferenceJson, referenceHash, referenceManagedFile, registerReferenceMedia, resolveReferenceMedia, writeReferenceJson } from '../src/shared/viral-reference-store';

const directories: string[] = [];
async function directory() { const value = await mkdtemp(join(tmpdir(), 'reference-store-')); directories.push(value); return value; }
afterEach(async () => { for (const value of directories.splice(0)) await rm(value, { recursive: true, force: true }); });

describe('reference artifact and database ownership', () => {
  it('checks artifact hashes and confines registered media to the managed directory', async () => {
    const dir = await directory();
    const file = await writeReferenceJson(dir, 'part', { text: '中文拆解' });
    expect(await readReferenceJson(dir, file.path, z.object({ text: z.string() }), file.hash)).toEqual({ text: '中文拆解' });
    await writeFile(join(dir, file.path), '{"text":"已被篡改"}', 'utf8');
    await expect(readReferenceJson(dir, file.path, z.unknown(), file.hash)).rejects.toThrow('CORRUPT');
    await expect(referenceManagedFile(dir, '../outside.json')).rejects.toThrow('PATH');
    await writeFile(join(dir, 'clip.mp4'), 'movie');
    await registerReferenceMedia(dir, 'source', join(dir, 'clip.mp4'), 'video/mp4');
    expect(await readFile((await resolveReferenceMedia(dir, 'source')).path, 'utf8')).toBe('movie');
    await expect(resolveReferenceMedia(dir, '../source')).rejects.toThrow();
  });

  it('rejects a nested junction while allowing a canonicalized managed root', async () => {
    const dir = await directory();
    const outside = await directory();
    await writeFile(join(outside, 'secret.txt'), 'secret');
    await symlink(outside, join(dir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(referenceManagedFile(dir, 'escape/secret.txt')).rejects.toThrow('PATH');
  });

  it('serializes generation/revision conflicts and keeps the committed pointer across reload', async () => {
    const dir = await directory();
    const path = join(dir, 'state.db');
    const db = await FileDatabase.open(path);
    let id = '';
    try {
      const record = await db.createViralAnalysis({ url: '', settings: { analysisMode: 'deep', track: '', style: '', ratio: '9:16', templateId: '' } });
      id = record.id;
      const run = await db.beginViralAnalysisRun(id);
      const hash = referenceHash('index');
      const pointer = { path: `reference/index-${hash}.json`, hash, revision: 1 };
      await db.publishViralReferenceIndex(id, run.runGeneration!, 0, pointer);
      await expect(db.publishViralReferenceIndex(id, run.runGeneration!, 0, pointer)).rejects.toThrow('CONFLICT');
      await expect(db.publishViralReferenceIndex(id, run.runGeneration! - 1, 1, { ...pointer, revision: 2 })).rejects.toThrow('STALE');
      await expect(db.configureViralReferenceRun(id, { maxAnalysisRequests: 30 })).rejects.toThrow('BUSY');
      await db.updateViralAnalysis(id, { status: 'failed' });
      await db.configureViralReferenceRun(id, { maxAnalysisRequests: 30, referenceVisualInput: 'video', referenceAudioInput: true });
      expect(await db.getViralAnalysisDetail(id)).toMatchObject({ status: 'paused', settings: { maxAnalysisRequests: 30 }, referenceIndex: pointer });
    } finally { await db.close(); }
    const reopened = await FileDatabase.open(path);
    try { expect((await reopened.getViralAnalysisDetail(id))?.referenceIndex?.revision).toBe(1); }
    finally { await reopened.close(); }
  });
});
