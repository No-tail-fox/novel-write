import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { piFilmStateSchema, type PiFilmState } from '../src/shared/creative-animation/pi-film';

/** Immutable completed segment snapshots, outside model-writable project source. */
export function piFilmCheckpoints(stateRoot: string) {
  const directory = join(stateRoot, 'segments');
  const path = (segment: number) => {
    if (!Number.isSafeInteger(segment) || segment < 1 || segment > 1000) throw new Error('PI_SEGMENT_NUMBER');
    return join(directory, `${segment}.json`);
  };
  return {
    async load(segment: number, runId: string): Promise<PiFilmState | undefined> {
      const target = path(segment);
      const backupPrefix = `${segment}.json.`;
      const candidates = [target];
      for (const name of await readdir(directory).catch(error => (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : Promise.reject(error))) {
        if (name.startsWith(backupPrefix) && name.endsWith('.bak')) candidates.push(join(directory, name));
      }
      let missing = true;
      let invalidTarget: unknown;
      for (const candidate of candidates) {
        try {
          const film = piFilmStateSchema.parse(JSON.parse(await readFile(candidate, 'utf8')));
          if (film.runId !== runId || film.segment !== segment) throw new Error('PI_CHECKPOINT_IDENTITY');
          missing = false;
          if (candidate !== target) {
            const hasTarget = await readFile(target, 'utf8').then(() => true, error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; return true; });
            if (hasTarget) {
              const corrupt = target + '.' + randomUUID() + '.corrupt';
              await rename(target, corrupt);
              try { await rename(candidate, target); }
              catch (error) { await rename(corrupt, target).catch(() => {}); throw error; }
              await unlink(corrupt).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
            } else {
              await rename(candidate, target);
            }
            return film;
          }
          return film;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            if (candidate === target) { invalidTarget = error; continue; }
            throw error;
          }
        }
      }
      if (invalidTarget) throw invalidTarget;
      return undefined;
    },
    async save(film: PiFilmState): Promise<void> {
      const validated = piFilmStateSchema.parse(film);
      const target = path(validated.segment);
      await mkdir(directory, { recursive: true });
      const prior = await this.load(validated.segment, validated.runId);
      if (prior?.phase === 'ready') throw new Error('PI_CHECKPOINT_EXISTS');
      if (prior && (prior.styleId !== validated.styleId || prior.sourceHash !== validated.sourceHash
        || prior.timelineHash !== validated.timelineHash || prior.assetHash !== validated.assetHash)) throw new Error('PI_CHECKPOINT_IDENTITY');
      const temp = target + '.' + randomUUID() + '.tmp';
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(validated), 'utf8'); await file.sync(); }
      finally { await file.close(); }
      if (!prior) {
        await rename(temp, target);
        return;
      }
      const backup = target + '.' + randomUUID() + '.bak';
      await rename(target, backup);
      try { await rename(temp, target); }
      catch (replaceError) {
        await rename(backup, target).catch(() => {});
        throw replaceError;
      }
      await unlink(backup).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
    },
  };
}
