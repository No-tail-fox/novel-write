import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach } from 'vitest';
import type { EditorialCollagePipelineData } from '../src/shared/editorial-collage';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

/** A real local file and hash receipt for scheduler tests, not artistic acceptance. */
export async function readyOfficialDocument(document: EditorialCollagePipelineData): Promise<EditorialCollagePipelineData> {
  const base = resolve('.artifacts/capability-tests-tmp/creative-official');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'film-'));
  directories.push(directory);
  const bytes = Buffer.from('<html>offline official scheduler fixture</html>');
  await writeFile(join(directory, 'index.html'), bytes);
  const sourceHash = hash(JSON.stringify([{ path: 'index.html', sha256: hash(bytes), bytes: bytes.length }]));
  return { ...document, upstreamFilm: {
    version: 1, runId: document.productionRun!.id, styleId: document.productionRun!.settings.authoring?.styleId ?? 'watercolor',
    directory, turn: 1, status: 'ready', sourceHash, lastTool: 'official-finish',
    message: 'Offline test receipt',
    review: { sourceHash, technicalPassed: true, frames: [], durationSeconds: document.timeline!.durationMs / 1000 },
    visualReview: { sourceHash, notes: 'Offline test-only visual receipt; no artistic acceptance is claimed.', turn: 1 },
  } };
}
