import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, lstat, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, relative, sep } from 'node:path';

export type StarterFile = { path: string; size: number; sha256: string; source: string; license: string };
export type StarterManifest = {
  schemaVersion: number; pack: string; license: string; licenseUrl?: string;
  source: { repo: string; tag: string; asset: string; file: string; size: number; sha256: string; url: string };
  instruments: string[]; bytes: number; files: StarterFile[];
};
export type SamplerIndex = Record<string, { zones: Array<{ f: string; vel: number | null; [key: string]: unknown }>; octave_fix: number }>;
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Only normal relative package paths; links and junctions are rejected separately. */
export function packagePath(root: string, name: string): string {
  if (!name || name.includes('\\') || name.includes(':') || isAbsolute(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw new Error(`LEMO_AUDIO_PATH:${name}`);
  return join(root, ...name.split('/'));
}
async function regularFile(root: string, name: string): Promise<string> {
  const path = packagePath(root, name);
  let parent = root;
  for (const part of name.split('/')) {
    parent = join(parent, part);
    if ((await lstat(parent)).isSymbolicLink()) throw new Error(`LEMO_AUDIO_LINK:${name}`);
  }
  if (!(await lstat(path)).isFile()) throw new Error(`LEMO_AUDIO_NOT_FILE:${name}`);
  return path;
}
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`LEMO_AUDIO_LINK:${path}`);
      if (entry.isDirectory()) await visit(path); else out.push(relative(root, path).split(sep).join('/'));
    }
  };
  await visit(root);
  return out.sort();
}
export async function readStarterManifest(packRoot: string): Promise<StarterManifest> {
  return JSON.parse(await readFile(await regularFile(resolve(packRoot), 'MANIFEST.json'), 'utf8')) as StarterManifest;
}

/** Reads installed bytes only; never repairs, downloads, or writes to the package. */
export async function verifyStarterPack(packRoot: string): Promise<StarterManifest> {
  const root = resolve(packRoot);
  const manifest = await readStarterManifest(root);
  if (manifest.schemaVersion !== 1 || manifest.license !== 'CC0 1.0' || !manifest.instruments.length || !manifest.files.length) throw new Error('LEMO_STARTER_MANIFEST');
  const listed = new Map(manifest.files.map(file => [file.path, file]));
  if (listed.size !== manifest.files.length || new Set(manifest.instruments).size !== manifest.instruments.length) throw new Error('LEMO_STARTER_DUPLICATE');
  const actual = (await walk(root)).filter(p => p !== 'MANIFEST.json');
  if (actual.length !== listed.size || actual.some(p => !listed.has(p))) throw new Error('LEMO_STARTER_UNLISTED');
  for (const entry of manifest.files) {
    const bytes = await readFile(await regularFile(root, entry.path));
    if (bytes.length !== entry.size || sha(bytes) !== entry.sha256) throw new Error(`LEMO_STARTER_HASH_MISMATCH:${entry.path}`);
  }
  const total = manifest.files.reduce((sum, entry) => sum + entry.size, 0);
  if (total !== manifest.bytes || total + (await readFile(join(root, 'MANIFEST.json'))).length > 100 * 1024 * 1024) throw new Error('LEMO_STARTER_SIZE');
  const index = JSON.parse(await readFile(join(root, 'instruments/index.json'), 'utf8')) as SamplerIndex;
  if (Object.keys(index).sort().join(',') !== [...manifest.instruments].sort().join(',')) throw new Error('LEMO_STARTER_INDEX');
  for (const [name, entry] of Object.entries(index)) {
    if (!entry.zones?.length) throw new Error(`LEMO_STARTER_EMPTY:${name}`);
    for (const zone of entry.zones) if (!listed.has(`instruments/${zone.f}`)) throw new Error(`LEMO_STARTER_SAMPLE:${name}:${zone.f}`);
  }
  return manifest;
}

/** Inventory is the installed index, never sampler.REG (which lists uninstalled libraries). */
export async function listInstalledInstruments(instrumentsRoot: string): Promise<string[]> {
  const root = resolve(instrumentsRoot);
  const index = JSON.parse(await readFile(await regularFile(root, 'index.json'), 'utf8')) as SamplerIndex;
  const installed: string[] = [];
  for (const [name, entry] of Object.entries(index)) {
    if (!entry.zones?.length) continue;
    try { for (const zone of entry.zones) await regularFile(root, zone.f); installed.push(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return installed.sort();
}

/** Creates a fresh runtime; original packages and upstream Python stay read-only.
 * Caller grants sandbox read access to the returned root and sets PYTHONPATH to it.
 * Additional packs are preinstalled instruments directories; only complete index entries merge.
 */
export async function stageAudioRuntime(options: { upstreamRoot: string; starterRoot: string; runtimeRoot: string; additionalInstrumentRoots?: string[] }) {
  await verifyStarterPack(options.starterRoot);
  const target = resolve(options.runtimeRoot);
  const sources = [resolve(options.upstreamRoot), resolve(options.starterRoot), ...(options.additionalInstrumentRoots ?? []).map(p => resolve(p))];
  for (const source of sources) {
    const rel = relative(await realpath(source), target);
    if (!rel || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))) throw new Error('LEMO_AUDIO_RUNTIME_OVERLAPS_SOURCE');
  }
  // exclusive mkdir: do not overwrite an existing runtime or user files.
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target);
  const audio = join(target, 'core/audio');
  const instruments = join(audio, 'instruments');
  await mkdir(instruments, { recursive: true });
  const pythonHashes: Record<string, string> = {};
  const upstreamAudio = join(resolve(options.upstreamRoot), 'core/audio');
  for (const name of (await readdir(upstreamAudio)).filter(n => n.endsWith('.py'))) {
    const source = await regularFile(upstreamAudio, name);
    const dest = join(audio, name);
    await copyFile(source, dest, constants.COPYFILE_EXCL);
    const expected = sha(await readFile(source));
    if (sha(await readFile(dest)) !== expected) throw new Error(`LEMO_AUDIO_COPY:${name}`);
    pythonHashes[name] = expected;
  }
  const merged: SamplerIndex = {};
  for (const root of [join(resolve(options.starterRoot), 'instruments'), ...(options.additionalInstrumentRoots ?? []).map(p => resolve(p))]) {
    const names = await listInstalledInstruments(root);
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as SamplerIndex;
    for (const name of names) merged[name] = index[name];
    for (const file of (await walk(root)).filter(p => p !== 'index.json')) {
      const from = await regularFile(root, file);
      const to = packagePath(instruments, file);
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      if (sha(await readFile(from)) !== sha(await readFile(to))) throw new Error(`LEMO_AUDIO_COPY:${file}`);
    }
  }
  await writeFile(join(instruments, 'index.json'), JSON.stringify(merged, null, 2) + '\n');
  await writeFile(join(target, 'runtime-manifest.json'), JSON.stringify({ pythonHashes, instruments: Object.keys(merged).sort() }, null, 2) + '\n');
  return { root: target, pythonPath: target, audioRoot: audio, instrumentsRoot: instruments, instruments: Object.keys(merged).sort(), pythonHashes };
}
