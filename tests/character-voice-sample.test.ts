import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importCharacterVoiceSample, inspectCharacterVoiceSample } from '../electron/character-voice-sample-service';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { createProductionHistoryReservations } from '../src/shared/production-history';
import { importCharacterVoiceSampleSchema } from '../src/shared/character-voice-sample';
import { buildMotionComicShotVideoRequest } from '../src/shared/motion-comic-video';
import { createHtmlVideoMediaUrl, ensureHtmlVideoTaskWorkDir, resolveHtmlVideoMediaUrl } from '../electron/html-video-runtime';
import { MotionComicScriptStore } from '../src/shared/motion-comic-script-store';
import type { MotionComicScriptTask, MotionComicScriptSnapshot } from '../src/shared/motion-comic-script-batch';
import { FileDatabase } from '../src/shared/storage';
import type { Task } from '../src/shared/types';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const now = '2026-09-18T00:00:00.000Z';
const ffmpeg = resolve('vendor/python/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v9.0.2.exe');
function wav(seconds = 1) {
  const samples = 8000 * seconds, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin(i * Math.PI * 440 / 4000) * 8000), 44 + i * 2);
  return data;
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'voice-sample-')); roots.push(root);
  const source = join(root, 'source.wav'); await writeFile(source, wav());
  let document = createMotionComicStarterProject(createMotionComicDraft({ id: 'comic', title: 'sample', premise: 'test', now }), 'one', now);
  document.characters[0].voiceId = 'existing-voice';
  const task = () => ({ id: document.id, taskType: 'motion-comic', status: 'draft', pipelineData: JSON.stringify(document) }) as Task;
  const reservations = createProductionHistoryReservations();
  const save = vi.fn(async (input: { document: typeof document; expectedUpdatedAt: string }) => {
    if (input.expectedUpdatedAt !== document.updatedAt) throw new Error('MOTION_COMIC_STALE_WRITE');
    document = parseMotionComicPipelineData({ ...input.document, updatedAt: new Date(Date.parse(document.updatedAt) + 1).toISOString() }); return task();
  });
  const deps = { getTask: async () => task(), selectFile: async () => source, workDir: () => join(root, 'task'), save,
    reserve: (doc: typeof document) => reservations.reserve(doc, { assets: 1 }), beginActivity: () => vi.fn(), inspect: (path: string) => inspectCharacterVoiceSample(path, ffmpeg) };
  return { root, source, deps, get document() { return document; }, input: () => ({ taskId: document.id, characterId: document.characters[0].id, expectedUpdatedAt: document.updatedAt }) };
}

describe('character voice samples local lifecycle', () => {
  it('probes and fully decodes WAV, saves, replaces while preserving old media/voice/timeline and serves task media', async () => {
    const f = await fixture(); const before = structuredClone(f.document.episodes);
    const identity = await ensureHtmlVideoTaskWorkDir(f.root, 'sample-task');
    f.deps.workDir = () => identity.workDir.canonicalPath;
    await importCharacterVoiceSample(f.input(), f.deps);
    const first = f.document.assets.at(-1)!;
    expect(first).toMatchObject({ kind: 'audio', durationMs: 1000 });
    expect(await readFile(first.localPath!)).toEqual(wav());
    const url = await createHtmlVideoMediaUrl('comic', identity, first.localPath!);
    expect(await resolveHtmlVideoMediaUrl(url, () => identity)).toBe(first.localPath);
    await expect(createHtmlVideoMediaUrl('comic', identity, f.source)).rejects.toThrow();
    await importCharacterVoiceSample(f.input(), f.deps);
    expect(f.document.characters[0].voiceSampleAssetVersionId).toBe(f.document.assets.at(-1)!.id);
    expect(f.document.characters[0].voiceId).toBe('existing-voice');
    expect(f.document.assets.some(a => a.id === first.id)).toBe(true);
    expect(await readFile(first.localPath!)).toEqual(wav());
    expect(f.document.episodes).toEqual(before);
    delete f.document.characters[0].voiceSampleAssetVersionId;
    expect(parseMotionComicPipelineData(f.document).assets).toHaveLength(f.document.assets.length);
  }, 30_000);
  it('cancels without writes and removes copies on failed save or stale CAS', async () => {
    const f = await fixture();
    expect(await importCharacterVoiceSample(f.input(), { ...f.deps, selectFile: async () => null })).toBeNull();
    expect(f.deps.save).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual(['source.wav']);
    await expect(importCharacterVoiceSample(f.input(), { ...f.deps, save: async () => { throw new Error('save failed'); } })).rejects.toThrow('save failed');
    expect(await readdir(join(f.root, 'task', 'character-voice-samples'))).toEqual([]);
    await expect(importCharacterVoiceSample({ ...f.input(), expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }, f.deps)).rejects.toThrow('STALE');
  }, 30_000);
  it('rejects empty, fake, oversized, overlong files and renderer paths', async () => {
    const f = await fixture();
    for (const bytes of [Buffer.alloc(0), Buffer.from('not audio'), Buffer.alloc(20 * 1024 * 1024 + 1), wav(61)]) {
      await writeFile(f.source, bytes);
      await expect(importCharacterVoiceSample(f.input(), f.deps)).rejects.toThrow();
    }
    const mislabeled = join(f.root, 'mislabeled.mp3'); await writeFile(mislabeled, wav());
    await expect(importCharacterVoiceSample(f.input(), { ...f.deps, selectFile: async () => mislabeled })).rejects.toThrow('FORMAT');
    expect(f.deps.save).not.toHaveBeenCalled();
    expect(importCharacterVoiceSampleSchema.safeParse({ ...f.input(), path: f.source }).success).toBe(false);
  }, 30_000);
  it('persists through database reopen and rejects archived projects without writing media', async () => {
    const f = await fixture(); const file = join(f.root, 'db.sqlite');
    let db = await FileDatabase.open(file);
    try {
      const created = await db.createMotionComicTask({ title: 'saved sample', premise: 'test', ratio: '9:16' });
      const doc = parseMotionComicPipelineData(created.pipelineData);
      const saved = await importCharacterVoiceSample({ taskId: created.id, characterId: doc.characters[0].id, expectedUpdatedAt: doc.updatedAt }, {
        ...f.deps, getTask: id => db.getTaskDetail(id), save: input => db.saveMotionComicTask(input),
      });
      const sampleId = parseMotionComicPipelineData(saved!.pipelineData).characters[0].voiceSampleAssetVersionId;
      await db.close(); db = await FileDatabase.open(file);
      const reopened = (await db.getTaskDetail(created.id))!;
      const persisted = parseMotionComicPipelineData(reopened.pipelineData);
      expect(persisted.characters[0].voiceSampleAssetVersionId).toBe(sampleId);
      await db.archiveTask(created.id);
      await expect(importCharacterVoiceSample({ taskId: created.id, characterId: doc.characters[0].id, expectedUpdatedAt: persisted.updatedAt }, {
        ...f.deps, getTask: id => db.getTaskDetail(id), save: input => db.saveMotionComicTask(input),
      })).rejects.toThrow('READONLY');
      expect(await readFile(persisted.assets.find(a => a.id === sampleId)!.localPath!)).toEqual(wav());
    } finally { await db.close(); }
  }, 30_000);
  it('excludes sample binding from script input fingerprints', async () => {
    const f = await fixture();
    f.document.sourceDocument = { kind: 'novel', adaptationMode: 'novel-adaptation', fileName: 'test.txt', originalText: 'test', importedAt: now, episodes: [{ id: 'source', number: 1, title: 'one', sourceText: 'test' }] };
    const store = new MotionComicScriptStore(() => { throw new Error('no db expected'); }, async mutation => mutation(), async () => {});
    const task = { sourceEpisodeId: 'source', bibleAssetIds: { characters: f.document.characters.map(c => c.id), sceneAssets: [], props: [] }, instructions: '', targetDurationSec: 60, provider: 'test', model: 'test', promptVersion: 'test' } as unknown as MotionComicScriptTask;
    const snapshot = { tasks: [], candidates: [] } as unknown as MotionComicScriptSnapshot;
    const before = store.dependencies(f.document, task, snapshot).inputFingerprint;
    f.document.characters[0].voiceSampleAssetVersionId = 'sample';
    expect(store.dependencies(f.document, task, snapshot).inputFingerprint).toBe(before);
  });
  it('releases capacity if activity acquisition fails', async () => {
    const f = await fixture(); const release = vi.fn();
    await expect(importCharacterVoiceSample(f.input(), { ...f.deps,
      reserve: () => ({ consume: vi.fn(), release }), beginActivity: () => { throw new Error('busy'); },
    })).rejects.toThrow('busy');
    expect(release).toHaveBeenCalledOnce();
  });
  it('keeps old documents valid, enforces audio references and rejects sample video use', async () => {
    const f = await fixture(); expect(() => parseMotionComicPipelineData(f.document)).not.toThrow();
    f.document.characters[0].voiceSampleAssetVersionId = 'missing';
    expect(() => parseMotionComicPipelineData(f.document)).toThrow();
    f.document.assets.push({ id: 'missing', assetId: 'image', kind: 'image', createdAt: now });
    expect(() => parseMotionComicPipelineData(f.document)).toThrow();
    delete f.document.characters[0].voiceSampleAssetVersionId;
    const asset = f.document.assets.at(-1)!; asset.kind = 'audio'; asset.assetId = 'character-voice-sample:old'; asset.localPath = f.source;
    const shot = f.document.episodes[0].scenes[0].shots[0]; shot.renderStrategy = 'remote-video';
    shot.characterLookIds = []; shot.sceneAssetId = ''; shot.propAssetIds = [];
    shot.firstFrameAssetVersionId = 'frame';
    f.document.assets.push({ id: 'frame', assetId: 'frame', kind: 'image', localPath: 'C:/frame.png', createdAt: now });
    shot.videoProduction = { version: 1, referenceMode: 'references', audioMode: 'audio-driven', referenceAudioAssetVersionIds: ['missing'] };
    expect(() => buildMotionComicShotVideoRequest(f.document, shot)).toThrow('VOICE_SAMPLE_UNSUPPORTED');
  });
});
