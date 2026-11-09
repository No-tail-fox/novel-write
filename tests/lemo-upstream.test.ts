import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { LEMO_UPSTREAM_REVISION, readLemoUpstreamManifest, serveLemoUpstreamProject } from '../electron/lemo-upstream-source';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'upstream test cleanup failed');
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lemo-source-'));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 60 }));
  const library = join(root, 'library'), film = join(root, '用户影片'), three = join(root, 'three');
  for (const dir of [library, film, three]) await mkdir(dir);
  await writeFile(join(library, 'storydream-upstream.json'), JSON.stringify({ revision: LEMO_UPSTREAM_REVISION, files: [{ path: 'core/lib.js' }] }));
  await mkdir(join(library, 'core'));
  await writeFile(join(library, 'core/lib.js'), 'export const version = 1');
  await writeFile(join(film, 'index.html'), '<meta charset="utf-8"><script type="module" src="main.js"></script>');
  await writeFile(join(film, 'main.js'), 'export const text = "中文原生工程"');
  await mkdir(join(three, 'build'));
  await writeFile(join(three, 'build/three.module.js'), 'export const REVISION = "170"');
  const server = await serveLemoUpstreamProject({ upstreamRoot: library, filmDir: film, threeRoot: three });
  cleanups.push(server.close);
  return { root, library, film, three, server };
}
function rawGet(origin: string, path: string, host?: string) {
  return new Promise<number | undefined>((done, reject) => {
    const req = request(origin, { path, headers: host ? { Host: host } : undefined }, response => { response.resume(); response.on('end', () => done(response.statusCode)); });
    req.on('error', reject); req.end();
  });
}
describe('complete upstream source adapter', () => {
  it('closes active resource streams and supports repeated shutdown', async () => {
    const { film, server } = await fixture();
    await writeFile(join(film, 'large.bin'), Buffer.alloc(8 * 1024 * 1024));
    const response = await new Promise<import('node:http').IncomingMessage>((done, reject) => {
      const req = request(`${server.origin}/@film/large.bin`, res => { res.on('error', () => {}); done(res); });
      req.on('error', reject); req.end();
    });
    expect(response.statusCode).toBe(200);
    const closing = server.close();
    expect(server.close()).toBe(closing);
    await closing;
    await expect(server.close()).resolves.toBeUndefined();
    response.destroy();
    await expect(fetch(server.pageUrl)).rejects.toThrow();
  });
  it('loads the pinned full library with demo modules and director references', async () => {
    const manifest = await readLemoUpstreamManifest(resolve('vendor/lemo-upstream'));
    expect(manifest.files).toHaveLength(2519);
    for (const path of ['AGENTS.md', 'DIRECTOR.md', 'core/render/video.mjs', 'styles/paper-popup/demo/main.js', 'styles/memphis-diorama/demo/people.js']) {
      expect(manifest.files.some(file => file.path === path)).toBe(true);
    }
    expect(await readFile('vendor/lemo-upstream/README.zh-CN.md', 'utf8')).toContain('CC BY 4.0');
  });
  it('serves native ESM and Three dependencies without rewriting the film', async () => {
    const { server } = await fixture();
    expect(server.pageUrl).toBe(`${server.origin}/@film/index.html`);
    const response = await fetch(`${server.origin}/@film/main.js`);
    expect(response.headers.get('content-type')).toContain('charset=utf-8');
    expect(await response.text()).toBe('export const text = "中文原生工程"');
    for (const prefix of ['', '/@film', '/styles/paper-popup/demo']) {
      expect(await (await fetch(`${server.origin}${prefix}/node_modules/three/build/three.module.js`)).text()).toContain('170');
    }
    expect((await fetch(`${server.origin}/core/lib.js`)).status).toBe(200);
  });
  it('isolates simultaneous films and rejects traversal, foreign hosts and untracked library files', async () => {
    const one = await fixture(), two = await fixture();
    await writeFile(join(two.film, 'main.js'), 'second film');
    expect(await (await fetch(`${one.server.origin}/@film/main.js`)).text()).toContain('中文');
    expect(await (await fetch(`${two.server.origin}/@film/main.js`)).text()).toBe('second film');
    for (const path of ['/@film/../main.js', '/@film/%2e%2e/main.js', '/@film/%5c..%5csecret.js', '/@film/I:/secret.js', '/@film/%00main.js']) {
      expect(await rawGet(one.server.origin, path)).toBe(403);
    }
    expect(await rawGet(one.server.origin, '/@film/main.js', 'attacker.example')).toBe(403);
    expect((await fetch(`${one.server.origin}/@film/main.js`, { headers: { Origin: 'https://foreign.example' } })).status).toBe(403);
    expect((await fetch(`${one.server.origin}/storydream-upstream.json`)).status).toBe(404);
    expect((await fetch(`${one.server.origin}/@film/main.js`, { method: 'POST' })).status).toBe(405);
  });
  it('blocks filesystem junctions which escape the mounted film', async () => {
    const { root, film, server } = await fixture();
    const outside = join(root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'secret.js'), 'secret');
    await symlink(outside, join(film, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect((await fetch(`${server.origin}/@film/escape/secret.js`)).status).toBe(403);
  });
  it('uses integrity-checked dependency cache without rewriting tracked originals', async () => {
    const { root, library, film, three } = await fixture();
    const cache = join(root, 'resources'); await mkdir(join(cache, 'core'), { recursive: true });
    const data = Buffer.from('cached font bytes');
    await writeFile(join(cache, 'core/font.woff2'), data);
    const index = { revision: LEMO_UPSTREAM_REVISION, files: [{ path: 'core/font.woff2', sha256: createHash('sha256').update(data).digest('hex'), sourceUrl: 'https://fonts.gstatic.com/verified', license: 'OFL-1.1' }] };
    await writeFile(join(cache, 'resources.json'), JSON.stringify(index));
    const server = await serveLemoUpstreamProject({ upstreamRoot: library, filmDir: film, threeRoot: three, resourceRoot: cache });
    cleanups.push(server.close);
    expect(await (await fetch(`${server.origin}/core/font.woff2`)).text()).toBe('cached font bytes');
    expect(await (await fetch(`${server.origin}/core/lib.js`)).text()).toBe('export const version = 1');
    await writeFile(join(cache, 'core/font.woff2'), 'tampered');
    await expect(serveLemoUpstreamProject({ upstreamRoot: library, filmDir: film, threeRoot: three, resourceRoot: cache })).rejects.toThrow('LEMO_RESOURCE_INTEGRITY');
  });
  it('does not accept source code through the dependency cache', async () => {
    const { root, library, film, three } = await fixture();
    const cache = join(root, 'resources'); await mkdir(cache);
    await writeFile(join(cache, 'resources.json'), JSON.stringify({ revision: LEMO_UPSTREAM_REVISION, files: [{ path: 'core/lib.js', sha256: 'bad', sourceUrl: 'https://test.example', license: 'MIT' }] }));
    await expect(serveLemoUpstreamProject({ upstreamRoot: library, filmDir: film, threeRoot: three, resourceRoot: cache })).rejects.toThrow('LEMO_RESOURCE_MANIFEST');
  });
  it('records absent resources instead of substituting images or code', async () => {
    const { server } = await fixture();
    expect((await fetch(`${server.origin}/@film/assets/missing.hdr`)).status).toBe(404);
    expect(server.failures).toContainEqual({ path: '/@film/assets/missing.hdr', status: 404 });
  });
});
