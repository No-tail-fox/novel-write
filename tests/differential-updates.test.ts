import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap';
import { parseBlockmap, PinnedRangeExecutor, tryDifferentialUpdate } from '../electron/differential-update';
import { LicenseService } from '../electron/license-service';
import { LicenseTransport, verifyRelease, type LicensePublicConfig } from '../electron/license-security';
import { UpdateService } from '../electron/update-service';
import type { ReleaseManifest, SignedEnvelope } from '../src/shared/licensing';

const chunkSize = 32 * 1024;
function mapFor(data: Buffer): Buffer {
  const sizes: number[] = [], checksums: string[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    const block = data.subarray(i, i + chunkSize);
    sizes.push(block.length); checksums.push(createHash('sha256').update(block).digest('base64'));
  }
  return gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes, checksums }] }));
}

describe('isolated TLS differential updates using the real upstream engine', () => {
  let directory: string, config: LicensePublicConfig, server: ChildProcess, license: LicenseService;
  let old: ReleaseManifest, release: ReleaseManifest;
  const before = Buffer.concat(Array.from({ length: 8 }, (_, i) => Buffer.alloc(chunkSize, i + 1)));
  before.write('MZ');
  const after = Buffer.from(before);
  after.fill(55, chunkSize * 4, chunkSize * 5);
  const python = process.env.STORYDREAM_TEST_PYTHON || 'python';
  const cwd = resolve('services/license-server');
  const command = (...args: string[]) => JSON.parse(execFileSync(python, ['server.py', '--data', join(directory, 'server'), ...args], { cwd, encoding: 'utf8', windowsHide: true }));
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'storydream-differential-'));
    config = command('init', '--host', '127.0.0.1');
    for (const [version, data] of [['1.0.0', before], ['2.0.0', after]] as const) {
      const path = join(directory, `${version}.exe`);
      await writeFile(path, data);
      await buildBlockMap(path, 'gzip', `${path}.blockmap`);
      const envelope = command('publish', '--file', path, '--blockmap', `${path}.blockmap`, '--version', version, '--notes', 'isolated differential test');
      const manifest = verifyRelease(envelope, config, Math.floor(Date.now() / 1000));
      if (version === '1.0.0') old = manifest; else release = manifest;
    }
    const script = [
      'import sys; from pathlib import Path; from server import LicenseStore, LicenseHTTPServer, handler_for',
      'store=LicenseStore(sys.argv[1])',
      'class TestHandler(handler_for(store)):',
      ' def do_GET(self):',
      '  flag=store.directory / "ignore-range"',
      '  if flag.exists() and self.headers.get("Range"): del self.headers["Range"]',
      '  return super().do_GET()',
      's=LicenseHTTPServer(("127.0.0.1",0),store); s.RequestHandlerClass=TestHandler',
      'print(s.server_address[1],flush=True); s.serve_forever()',
    ].join('\n');
    server = spawn(python, ['-u', '-c', script, join(directory, 'server')], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('TLS server startup timeout')), 10000);
      server.stdout!.once('data', data => { clearTimeout(timer); accept(data.toString().trim()); });
      server.once('error', reject); server.once('exit', code => reject(new Error(`TLS server exited ${code}`)));
    });
    config.baseUrl = `https://127.0.0.1:${port}`;
    license = new LicenseService({ config, vaultPath: join(directory, 'vault'), packaged: true, machineId: async () => 'a'.repeat(64),
      encryption: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() } });
    await license.initialize();
  }, 30000);
  afterAll(async () => {
    license?.close();
    if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
    if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  });
  async function cache(): Promise<string> {
    const path = await mkdtemp(join(directory, 'cache-'));
    await copyFile(join(directory, '1.0.0.exe'), join(path, old.filename));
    return path;
  }
  function service(path: string): UpdateService {
    return new UpdateService({ license, directory: path, version: '1.0.0', packaged: false, canInstall: () => true, quit() {} });
  }
  it('reuses seven of eight blocks and verifies a complete installer', async () => {
    const path = await cache();
    const result = await tryDifferentialUpdate({ transport: license.transport!, directory: path, currentVersion: '1.0.0', release,
      now: license.now(), progress() {} });
    expect(result).toEqual({ transferred: chunkSize, reused: chunkSize * 7 });
    expect(await readFile(join(path, release.filename))).toEqual(after);
    expect((await readdir(path)).filter(name => name.startsWith('.differential-'))).toEqual([]);
  });
  it('integrates differential download with existing announcements and ready state', async () => {
    const path = await cache();
    const result = await service(path).download();
    expect(result.phase).toBe('ready');
    expect(result.message).toContain('差分更新已验证');
    expect(result.announcements.some(notice => notice.version === '2.0.0')).toBe(true);
    expect(result.downloaded).toBe(after.length);
    expect(await readFile(join(path, release.filename))).toEqual(after);
  });
  it('preserves an existing full-download resume without requesting differential metadata', async () => {
    const path = await cache();
    await writeFile(join(path, `${release.filename}.part`), after.subarray(0, chunkSize));
    const json = vi.spyOn(license.transport!, 'json');
    try {
      const result = await service(path).download();
      expect(result.phase).toBe('ready');
      expect(result.message).not.toContain('差分更新已验证');
      expect(json.mock.calls.some(([endpoint]) => endpoint.includes('/differential/'))).toBe(false);
      expect(await readFile(join(path, release.filename))).toEqual(after);
    } finally { json.mockRestore(); }
  });
  it.each(['missing-base', 'corrupt-base', 'corrupt-blockmap', 'unsupported-range', 'tampered-metadata', 'metadata-unavailable'])('falls back to verified full download: %s', async scenario => {
    const path = await cache();
    const mapPath = join(directory, 'server', 'releases', `${release.filename}.blockmap`);
    const savedMap = await readFile(mapPath);
    const flag = join(directory, 'server', 'ignore-range');
    const original = LicenseTransport.prototype.json.bind(license.transport!);
    const json = vi.spyOn(license.transport!, 'json').mockImplementation(async (endpoint, body) => {
      if (endpoint.includes('/differential/') && scenario === 'metadata-unavailable') throw new Error('NOT_FOUND');
      const value = await original(endpoint, body);
      if (endpoint.includes('/differential/') && scenario === 'tampered-metadata') {
        const data = value as { differential: SignedEnvelope };
        data.differential.payload = data.differential.payload.replace('"kind":"differential"', '"kind":"tampered"');
        // JSON serialization may include spaces; always change the signed bytes.
        data.differential.payload += ' ';
      }
      return value;
    });
    try {
      if (scenario === 'missing-base') await rm(join(path, old.filename));
      if (scenario === 'corrupt-base') await writeFile(join(path, old.filename), Buffer.alloc(before.length, 99));
      if (scenario === 'corrupt-blockmap') await writeFile(mapPath, Buffer.alloc(savedMap.length, 99));
      if (scenario === 'unsupported-range') await writeFile(flag, 'test');
      const result = await service(path).download();
      expect(result.phase).toBe('ready');
      expect(result.message).not.toContain('差分更新已验证');
      expect(await readFile(join(path, release.filename))).toEqual(after);
      expect((await readdir(path)).filter(name => name.startsWith('.differential-'))).toEqual([]);
    } finally { json.mockRestore(); await writeFile(mapPath, savedMap); await rm(flag, { force: true }); }
  });
  it('rejects reconstructed data when a signed blockmap incorrectly claims unchanged blocks', async () => {
    const path = await cache();
    const basePath = join(directory, 'server', 'releases', old.filename);
    const original = await readFile(basePath);
    // A wrong blockmap of a different same-size installer passes structural checks, but never final hashes.
    const source = join(directory, 'wrong.exe');
    await writeFile(source, after);
    await copyFile(join(directory, '1.0.0.exe.blockmap'), `${source}.blockmap`);
    const envelope = command('publish', '--file', source, '--blockmap', `${source}.blockmap`, '--version', '3.0.0');
    const wrong = verifyRelease(envelope, config, license.now());
    expect(await tryDifferentialUpdate({ transport: license.transport!, directory: path, currentVersion: '1.0.0', release: wrong,
      now: license.now(), progress() {} })).toBeNull();
    expect(await readdir(path)).toEqual([old.filename]);
    expect(await readFile(basePath)).toEqual(original);
    expect((await service(path).download()).phase).toBe('ready');
    expect(await readFile(join(path, wrong.filename))).toEqual(after);
  });
  it('rejects requests outside the pinned artifact and unsafe ranges', () => {
    const executor = new PinnedRangeExecutor(new LicenseTransport(config), release.filename, release.size, () => {});
    expect(() => executor.createRequest({ protocol: 'https:', hostname: 'attacker.invalid', path: '/download', headers: { range: 'bytes=0-1' } }, () => {})).toThrow();
  });
});

it('bounds blockmap expansion and validates coverage, counts and offsets', () => {
  const good = mapFor(Buffer.alloc(chunkSize));
  expect(parseBlockmap(good, chunkSize).files[0].sizes).toEqual([chunkSize]);
  expect(() => parseBlockmap(good, chunkSize + 1)).toThrow();
  for (const sizes of [[-1], [0], [1.5], [Number.MAX_SAFE_INTEGER]]) {
    const data = gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, sizes, checksums: ['x'] }] }));
    expect(() => parseBlockmap(data, chunkSize)).toThrow();
  }
  expect(() => parseBlockmap(gzipSync(Buffer.alloc(32 * 1024 ** 2 + 1)), chunkSize)).toThrow();
});
