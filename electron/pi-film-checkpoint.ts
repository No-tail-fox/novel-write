import { mkdir, open, readFile, rename } from 'node:fs/promises';
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
      try {
        const film = piFilmStateSchema.parse(JSON.parse(await readFile(path(segment), 'utf8')));
        if (film.runId !== runId || film.segment !== segment) throw new Error('PI_CHECKPOINT_IDENTITY');
        return film;
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    },
    async save(film: PiFilmState): Promise<void> {
      const validated = piFilmStateSchema.parse(film);
      const target = path(validated.segment);
      await mkdir(directory, { recursive: true });
      try { await readFile(target); throw new Error('PI_CHECKPOINT_EXISTS'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const temp = target + '.' + randomUUID() + '.tmp';
      const file = await open(temp, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(validated), 'utf8'); await file.sync(); }
      finally { await file.close(); }
      await rename(temp, target);
    },
  };
}
