import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { activateLemoRelease, hashLemoReleaseFile, LEMO_RELEASE_FILES, listLemoReleaseFiles,
  resolvePackagedLemoRelease, rollbackLemoRelease, verifyLemoRelease, type LemoReleaseManifest } from '../electron/lemo-official-release';

let root: string;
beforeEach(async () => { await mkdir(resolve('.artifacts'), { recursive: true }); root = await mkdtemp(resolve('.artifacts/lemo-release-test-')); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function fixture(name = 'candidate', content = 'worker') {
  const directory = join(root, name);
  const values: Record<string, string> = {
    [LEMO_RELEASE_FILES.worker]: content, [LEMO_RELEASE_FILES.node]: 'standalone node fixture', 'node/LICENSE': 'Node license',
    [LEMO_RELEASE_FILES.sdk]: JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk', version: '0.3.314', claudeCodeVersion: '2.1.314' }),
    [LEMO_RELEASE_FILES.cliPackage]: JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk-win32-x64', version: '0.3.314' }),
    [LEMO_RELEASE_FILES.cli]: 'native CLI fixture', 'lemo-agent-worker/package.json': JSON.stringify({ dependencies: { '@anthropic-ai/claude-agent-sdk': '0.3.314' } }),
    'lemo-agent-worker/package-lock.json': '{"lockfileVersion":3}',
    'lemo-agent-worker/node_modules/@anthropic-ai/claude-agent-sdk/README.md': 'SDK license terms',
    'lemo-agent-worker/node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/LICENSE.md': 'CLI license terms',
  };
  for (const [path, text] of Object.entries(values)) { await mkdir(dirname(join(directory, path)), { recursive: true }); await writeFile(join(directory, path), text, 'utf8'); }
  const manifest: LemoReleaseManifest = { schema: 1, platform: 'win32', arch: 'x64', sdkVersion: '0.3.314', cliVersion: '2.1.314', nodeVersion: 'v22.20.0',
    workerLockSha256: await hashLemoReleaseFile(join(directory, 'lemo-agent-worker/package-lock.json')), files: await listLemoReleaseFiles(directory) };
  const digest = await saveManifest(directory, manifest);
  return { directory, manifest, digest };
}
async function saveManifest(directory: string, manifest: LemoReleaseManifest) {
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest), 'utf8'); return hashLemoReleaseFile(join(directory, 'manifest.json'));
}
const probe = vi.fn(async () => {});
const installation = () => join(root, 'resources', 'lemo-official');
const activate = async (f: Awaited<ReturnType<typeof fixture>>, check = probe) => activateLemoRelease({
  sourceRoot: f.directory, installationRoot: installation(), trustedManifestSha256: f.digest, probe: check,
});

describe('official release integrity and installed resource discovery', () => {
  it('finds a complete relocatable resource bundle and uses only its standalone Node', async () => {
    const f = await fixture(); const pointer = await activate(f);
    const installed = await resolvePackagedLemoRelease(join(root, 'resources'));
    expect(pointer).toEqual({ schema: 1, current: f.digest });
    expect(installed.nodeExecutable).toBe(join(installation(), 'releases', f.digest, 'node/node.exe'));
    expect(installed.workerPath).toBe(join(installation(), 'releases', f.digest, LEMO_RELEASE_FILES.worker));
    expect(installed.manifest.sdkVersion).toBe('0.3.314');
  });
  it('rejects a missing bundle instead of falling back to global Node', async () => {
    await expect(resolvePackagedLemoRelease(join(root, 'absent'))).rejects.toThrow('LEMO_RELEASE_MISSING');
  });
  it('requires a trusted manifest digest before reading or executing a candidate', async () => {
    const f = await fixture(); await expect(verifyLemoRelease(f.directory, '')).rejects.toThrow('TRUST_REQUIRED');
    await expect(verifyLemoRelease(f.directory, 'a'.repeat(64))).rejects.toThrow('MANIFEST_CHANGED');
  });
  it.each([LEMO_RELEASE_FILES.worker, LEMO_RELEASE_FILES.node, LEMO_RELEASE_FILES.cli])('rejects modified executable %s', async path => {
    const f = await fixture(); await writeFile(join(f.directory, path), 'tampered', 'utf8');
    await expect(verifyLemoRelease(f.directory, f.digest)).rejects.toThrow('FILE_CHANGED');
  });
  it('rejects missing runtime modules and unexpected injectable modules', async () => {
    const f = await fixture(); await rm(join(f.directory, LEMO_RELEASE_FILES.cli));
    await expect(verifyLemoRelease(f.directory, f.digest)).rejects.toThrow('FILE_SET_CHANGED');
    const g = await fixture('other'); await writeFile(join(g.directory, 'node/injected.js'), 'attack', 'utf8');
    await expect(verifyLemoRelease(g.directory, g.digest)).rejects.toThrow('FILE_SET_CHANGED');
  });
  it.each(['../outside', 'C:/outside', 'node/../outside', 'node\\outside', 'node/node.exe '])('rejects manifest path %s', async path => {
    const f = await fixture(); f.manifest.files[0].path = path; const digest = await saveManifest(f.directory, f.manifest);
    await expect(verifyLemoRelease(f.directory, digest)).rejects.toThrow('MANIFEST_INVALID');
  });
  it('rejects duplicate paths, incompatible versions, and absent license files', async () => {
    const f = await fixture(); f.manifest.files.push({ ...f.manifest.files[0], path: f.manifest.files[0].path.toUpperCase() });
    await expect(verifyLemoRelease(f.directory, await saveManifest(f.directory, f.manifest))).rejects.toThrow('MANIFEST_INVALID');
    const g = await fixture('versions'); g.manifest.sdkVersion = '0.3.315';
    await expect(verifyLemoRelease(g.directory, await saveManifest(g.directory, g.manifest))).rejects.toThrow('MANIFEST_INVALID');
    const h = await fixture('licenses'); h.manifest.files = h.manifest.files.filter(e => e.path !== 'node/LICENSE');
    await expect(verifyLemoRelease(h.directory, await saveManifest(h.directory, h.manifest))).rejects.toThrow('INCOMPLETE');
  });
  it('checks SDK and CLI package identity independently of manifest metadata', async () => {
    const f = await fixture(); await writeFile(join(f.directory, LEMO_RELEASE_FILES.sdk), JSON.stringify({ name: 'replacement', version: '0.3.314', claudeCodeVersion: '2.1.314' }), 'utf8');
    f.manifest.files = await listLemoReleaseFiles(f.directory);
    await expect(verifyLemoRelease(f.directory, await saveManifest(f.directory, f.manifest))).rejects.toThrow('VERSION_MISMATCH');
  });
  it('refuses linked directories even when their files are unchanged', async () => {
    const f = await fixture(); const outside = join(root, 'outside'); await mkdir(outside);
    await symlink(outside, join(f.directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(verifyLemoRelease(f.directory, f.digest)).rejects.toThrow('LINK_OR_PATH');
  });
});

describe('transactional release preparation and rollback', () => {
  it('keeps the old pointer byte-for-byte when the new runtime cannot initialize', async () => {
    const first = await fixture('first'), next = await fixture('next', 'new worker'); await activate(first);
    const before = await readFile(join(installation(), 'active.json'), 'utf8');
    await expect(activate(next, vi.fn(async () => { throw new Error('SDK init failed'); }))).rejects.toThrow('SDK init failed');
    expect(await readFile(join(installation(), 'active.json'), 'utf8')).toBe(before);
    expect((await resolvePackagedLemoRelease(join(root, 'resources'))).manifestSha256).toBe(first.digest);
  });
  it('rejects corruption during preparation before changing the active release', async () => {
    const first = await fixture('first'), next = await fixture('next', 'new worker'); await activate(first);
    await expect(activateLemoRelease({ sourceRoot: next.directory, installationRoot: installation(), trustedManifestSha256: next.digest,
      probe: async staged => { await writeFile(staged.workerPath, 'changed after validation', 'utf8'); } })).rejects.toThrow('FILE_CHANGED');
    expect((await resolvePackagedLemoRelease(join(root, 'resources'))).manifestSha256).toBe(first.digest);
  });
  it('activates a verified update, retains the previous release and rolls back without copying over it', async () => {
    const first = await fixture('first'), next = await fixture('next', 'new worker'); await activate(first);
    expect(await activate(next)).toEqual({ schema: 1, current: next.digest, previous: first.digest });
    expect(await rollbackLemoRelease({ installationRoot: installation(), expectedCurrent: next.digest, probe }))
      .toEqual({ schema: 1, current: first.digest, previous: next.digest });
    expect((await resolvePackagedLemoRelease(join(root, 'resources'))).manifestSha256).toBe(first.digest);
  });
  it('does not steal a lock left by a concurrent or interrupted updater', async () => {
    const f = await fixture(); await mkdir(installation(), { recursive: true });
    await writeFile(join(installation(), '.update.lock'), 'owner evidence', 'utf8');
    await expect(activate(f)).rejects.toThrow('UPDATE_LOCKED');
    expect(await readFile(join(installation(), '.update.lock'), 'utf8')).toBe('owner evidence');
  });
  it('refuses rollback with a stale current identity or corrupted previous files', async () => {
    const first = await fixture('first'), next = await fixture('next', 'new worker'); await activate(first); await activate(next);
    await expect(rollbackLemoRelease({ installationRoot: installation(), expectedCurrent: first.digest, probe })).rejects.toThrow('ROLLBACK_UNAVAILABLE');
    await writeFile(join(installation(), 'releases', first.digest, LEMO_RELEASE_FILES.worker), 'bad', 'utf8');
    await expect(rollbackLemoRelease({ installationRoot: installation(), expectedCurrent: next.digest, probe })).rejects.toThrow('FILE_CHANGED');
    expect((await resolvePackagedLemoRelease(join(root, 'resources'))).manifestSha256).toBe(next.digest);
  });
  it('rejects malformed active state and unsafe source/destination overlap', async () => {
    const f = await fixture(); await mkdir(installation(), { recursive: true }); await writeFile(join(installation(), 'active.json'), '{', 'utf8');
    await expect(activate(f)).rejects.toThrow('POINTER_INVALID');
    await expect(activateLemoRelease({ sourceRoot: f.directory, installationRoot: join(f.directory, 'child'), trustedManifestSha256: f.digest, probe })).rejects.toThrow('SOURCE_DESTINATION_OVERLAP');
  });
  it('is idempotent without replacing or losing a valid previous release', async () => {
    const first = await fixture('first'), next = await fixture('next', 'new worker'); await activate(first); const pointer = await activate(next);
    expect(await activate(next)).toEqual(pointer);
  });
});
