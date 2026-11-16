import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listInstalledInstruments, packagePath, readStarterManifest, stageAudioRuntime, verifyStarterPack, type SamplerIndex } from '../services/lemo-audio/starter-pack';

const pack = resolve('vendor/lemo-instrument-starter');
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const temp = async () => { const root = await mkdtemp(join(tmpdir(), 'lemo-starter-test-')); roots.push(root); return root; };
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('CC0 Lemo instrument starter pack', () => {
  it('verifies every real packaged file and stays within the complete directory budget', async () => {
    const manifest = await verifyStarterPack(pack);
    expect(manifest.license).toBe('CC0 1.0');
    expect(manifest.bytes + (await readFile(join(pack, 'MANIFEST.json'))).length).toBeLessThanOrEqual(100 * 1024 * 1024);
    expect(manifest.source.sha256).toBe('b72822ac2f6569ed33b376448784d542bf039478fbf521db0c4bdc7ee766cac4');
    expect(manifest.files.some(f => /license/i.test(f.path))).toBe(true);
    const samples = manifest.files.filter(f => f.path.endsWith('.flac'));
    expect(samples.length).toBeGreaterThan(100);
    for (const sample of samples) expect((await readFile(join(pack, sample.path))).subarray(0, 4).toString()).toBe('fLaC');
  });
  it('lists only installed instruments and retains all indexed zones and velocity layers', async () => {
    const manifest = await readStarterManifest(pack);
    const index = JSON.parse(await readFile(join(pack, 'instruments/index.json'), 'utf8')) as SamplerIndex;
    expect(Object.keys(index).sort()).toEqual([...manifest.instruments].sort());
    expect(await listInstalledInstruments(join(pack, 'instruments'))).toEqual(['alto_sax', 'erhu', 'jazz_bass']);
    expect(new Set(index.alto_sax.zones.map(z => z.vel)).size).toBe(2);
    expect(index.erhu.zones.length).toBeGreaterThan(0);
    expect(index.jazz_bass.zones.length).toBeGreaterThan(0);
    expect(index).not.toHaveProperty('piano');
    expect(index).not.toHaveProperty('drum_kit');
  });
  it('stages an isolated runtime with unchanged Python and sample paths', async () => {
    const parent = await temp();
    const before = digest(await readFile(join(pack, 'MANIFEST.json')));
    const staged = await stageAudioRuntime({ upstreamRoot: resolve('vendor/lemo-upstream'), starterRoot: pack, runtimeRoot: join(parent, 'runtime') });
    expect(staged.instruments).toEqual(['alto_sax', 'erhu', 'jazz_bass']);
    expect(await listInstalledInstruments(staged.instrumentsRoot)).toEqual(staged.instruments);
    for (const [name, hash] of Object.entries(staged.pythonHashes)) expect(digest(await readFile(join(staged.audioRoot, name)))).toBe(hash);
    expect(digest(await readFile(join(pack, 'MANIFEST.json')))).toBe(before);
    await expect(stageAudioRuntime({ upstreamRoot: resolve('vendor/lemo-upstream'), starterRoot: pack, runtimeRoot: staged.root })).rejects.toThrow();
  }, 30000);
  it('does not advertise missing samples or accept package path escapes', async () => {
    const root = await temp();
    await mkdir(join(root, 'karoryfer'));
    await writeFile(join(root, 'index.json'), JSON.stringify({ absent: { zones: [{ f: 'karoryfer/missing.flac' }], octave_fix: 0 } }));
    expect(await listInstalledInstruments(root)).toEqual([]);
    for (const path of ['../escape', '/absolute', 'x/../../escape', 'C:/escape', 'x\\escape', 'x//escape']) expect(() => packagePath(root, path)).toThrow('LEMO_AUDIO_PATH');
  });
});
