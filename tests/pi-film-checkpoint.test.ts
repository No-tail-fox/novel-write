import { mkdtemp, rm, rename, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { piFilmCheckpoints } from '../electron/pi-film-checkpoint';
import { newCodeVideoPolicy } from '../src/shared/creative-animation/production-policy';
it('recovers only immutable same-run segment snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-checkpoint-'));
  try {
    const store = piFilmCheckpoints(root), hash = 'a'.repeat(64);
    const film = { version: 1 as const, authoringVersion: 4 as const, runId: 'run', styleId: 'impasto', policy: newCodeVideoPolicy(), sessionRef: 'sessions/session.jsonl',
      phase: 'authoring' as const, segment: 1, completedModelRequests: 2, sourceHash: hash, timelineHash: hash, assetHash: hash, actualDurationSeconds: 60, narrationPauses: [], acceptedPauseChanges: 0, message: '' };
    expect(await store.load(1, 'run')).toBeUndefined();
    await store.save(film);
    expect(await store.load(1, 'run')).toEqual(film);
    await expect(store.load(1, 'other')).rejects.toThrow('IDENTITY');
    await store.save({ ...film, phase: 'paused', completedModelRequests: 3 });
    expect(await store.load(1, 'run')).toMatchObject({ phase: 'paused', completedModelRequests: 3 });
    const segmentPath = join(root, 'segments', '1.json');
    const backupPath = segmentPath + '.interrupted.bak';
    await rename(segmentPath, backupPath);
    await writeFile(segmentPath, 'incomplete');
    expect(await store.load(1, 'run')).toMatchObject({ phase: 'paused', completedModelRequests: 3 });
    expect(await readFile(segmentPath, 'utf8')).toContain('paused');
    const ready = { ...film, phase: 'ready' as const };
    await store.save(ready);
    await expect(store.save({ ...ready, completedModelRequests: 4 })).rejects.toThrow('EXISTS');
  } finally { await rm(root, { recursive: true, force: true }); }
});
