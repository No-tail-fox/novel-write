import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM script without type declarations
import { checkInstallLayout } from '../scripts/check-install-layout.mjs';
import { resolveLemoUpstreamRenderRuntime } from '../electron/lemo-upstream-video';

type Result = { passed: boolean; checks: Array<{ id: string; status: string; detail: string }> };
const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });

// Installed copies live under paths with spaces and non-ASCII user names (P-3).
async function userLikeDir(prefix: string) {
  const root = await mkdtemp(join(tmpdir(), `${prefix} 用户 目录-`));
  roots.push(root);
  return root;
}

async function touch(path: string, content = 'x') {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

async function packagedFixture(): Promise<string> {
  const resources = join(await userLikeDir('install'), 'Program Files', 'StoryDream', 'resources');
  const site = join(resources, 'python', 'Lib', 'site-packages');
  await touch(join(resources, 'python', 'python.exe'));
  await touch(join(site, 'playwright', 'driver', 'node.exe'));
  await touch(join(site, 'playwright', 'driver', 'package', 'package.json'), JSON.stringify({ name: 'playwright-core', version: '1.63.0' }));
  await touch(join(site, 'playwright', 'driver', 'package', 'index.mjs'));
  await touch(join(site, 'playwright', 'driver', 'package', 'browsers.json'), JSON.stringify({ browsers: [{ name: 'chromium-headless-shell', revision: '1243' }] }));
  await mkdir(join(resources, 'python', 'playwright-browsers', 'chromium_headless_shell-1243'), { recursive: true });
  await touch(join(site, 'imageio_ffmpeg', 'binaries', 'ffmpeg-win-x86_64-v7.1.exe'));
  await touch(join(resources, 'lemo-upstream', 'storydream-upstream.json'), JSON.stringify({ revision: 'f17136060781a0068a7951245a3aa7835a7230de' }));
  await touch(join(resources, 'lemo-upstream', 'core', 'render', 'video.mjs'));
  await touch(join(resources, 'lemo-upstream-deps', 'three', 'package.json'), '{"version":"0.170.0"}');
  await mkdir(join(resources, 'lemo-upstream-deps', 'three', 'build'), { recursive: true });
  await mkdir(join(resources, 'pixelle-upstream'), { recursive: true });
  await mkdir(join(resources, 'pixelle-worker'), { recursive: true });
  await touch(join(resources, 'THIRD_PARTY_NOTICES.md'));
  await mkdir(join(resources, 'THIRD_PARTY_LICENSES'), { recursive: true });
  await touch(join(resources, 'app.asar'));
  return resources;
}

const status = (result: Result, id: string) => result.checks.find(check => check.id === id)?.status;

describe('install layout check (P-3, offline part)', () => {
  it('passes a complete packaged layout under a path with spaces and Chinese', async () => {
    const resources = await packagedFixture();
    const result = checkInstallLayout(resources, { platform: 'win32' }) as Result;
    expect(result.checks.filter(check => check.status !== 'pass')).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it('fails on each missing runtime component, with the missing path in Chinese', async () => {
    const resources = await packagedFixture();
    await rm(join(resources, 'python', 'playwright-browsers', 'chromium_headless_shell-1243'), { recursive: true });
    await rm(join(resources, 'python', 'Lib', 'site-packages', 'imageio_ffmpeg'), { recursive: true });
    await rm(join(resources, 'lemo-upstream-deps'), { recursive: true });
    await rm(join(resources, 'pixelle-worker'), { recursive: true });
    const result = checkInstallLayout(resources, { platform: 'win32' }) as Result;
    expect(result.passed).toBe(false);
    expect(status(result, 'headless-chromium')).toBe('fail');
    expect(status(result, 'ffmpeg')).toBe('fail');
    expect(status(result, 'three')).toBe('fail');
    expect(status(result, 'pixelle-worker')).toBe('warn');
    expect(result.checks.find(check => check.id === 'headless-chromium')?.detail).toContain('chromium_headless_shell-1243');
  });

  it('matches the electron-builder extraResources targets', () => {
    const build = JSON.parse(readFileSync('package.json', 'utf8')).build as { extraResources: Array<{ from: string; to: string }> };
    const targets = new Set(build.extraResources.map(item => item.to));
    for (const target of ['python', 'lemo-upstream', 'lemo-upstream-deps/three', 'pixelle-upstream', 'pixelle-worker', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_LICENSES']) expect(targets.has(target)).toBe(true);
  });

  it('passes on the dev repo layout', () => {
    const result = checkInstallLayout('.', { dev: true }) as Result;
    expect(result.checks.filter(check => check.status === 'fail')).toEqual([]);
  });

  it.skipIf(process.platform !== 'win32' || !existsSync('vendor/python/python.exe'))('resolves the real bundled runtime and creates the ffmpeg alias in a user cache path with spaces and Chinese', async () => {
    const cacheDir = join(await userLikeDir('cache'), 'AppData', 'Local', 'Temp', 'storydream-lemo-upstream-render');
    const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: 'vendor/python', cacheDir });
    expect(existsSync(join(runtime.ffmpegDir, 'ffmpeg.exe'))).toBe(true);
    expect(runtime.ffmpegDir.startsWith(cacheDir)).toBe(true);
  }, 60_000);
});
