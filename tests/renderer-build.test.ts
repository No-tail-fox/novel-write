import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';

const runnerUrl = new URL('../scripts/build-renderer.mjs', import.meta.url);

async function runBuildWithViteFixture(overrides: NodeJS.ProcessEnv = {}, fail = false) {
  const root = await mkdtemp(join(tmpdir(), 'storydream-renderer-build-'));
  try {
    const viteRoot = join(root, 'node_modules', 'vite');
    await mkdir(viteRoot, { recursive: true });
    await copyFile(runnerUrl, join(root, 'build-renderer.mjs'));
    await writeFile(join(viteRoot, 'package.json'), JSON.stringify({ type: 'module', exports: './index.mjs' }), 'utf8');
    await writeFile(join(viteRoot, 'index.mjs'), [
      'const workersAtImport = { rolldown: process.env.ROLLDOWN_WORKER_THREADS, rayon: process.env.RAYON_NUM_THREADS };',
      'export async function build() {',
      fail ? 'throw new Error("build fixture failed");' : 'console.log(JSON.stringify(workersAtImport));',
      '}',
    ].join('\n'), 'utf8');
    const env = { ...process.env };
    delete env.ROLLDOWN_WORKER_THREADS;
    delete env.RAYON_NUM_THREADS;
    Object.assign(env, overrides);
    return spawnSync(process.execPath, [join(root, 'build-renderer.mjs')], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('renderer build entry', () => {
  it('minifies shipped renderer code and omits source maps', async () => {
    const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
    expect(config).toContain("minify: 'esbuild'");
    expect(config).toContain('sourcemap: false');
    expect(config).toContain('cssMinify: true');
  });
  it('bounds native concurrency before importing Vite', async () => {
    const result = await runBuildWithViteFixture();
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ rolldown: '2', rayon: '2' });
  });

  it('preserves explicitly configured worker limits', async () => {
    const result = await runBuildWithViteFixture({ ROLLDOWN_WORKER_THREADS: '1', RAYON_NUM_THREADS: '3' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ rolldown: '1', rayon: '3' });
  });

  it('propagates build failures to the launcher', async () => {
    const result = await runBuildWithViteFixture({}, true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('build fixture failed');
  });

  it('is shared by one-click startup, development builds, and installer builds', async () => {
    for (const path of ['../start-storydream.ps1', '../scripts/build.ps1', '../scripts/package-win.ps1']) {
      const source = await readFile(new URL(path, import.meta.url), 'utf8');
      expect(source).toMatch(/scripts[\\/]build-renderer\.mjs/u);
      expect(source).not.toMatch(/vite[\\/]bin[\\/]vite\.js["']? build/u);
    }
  });

  it('bundles every shared configuration export for browsers without Node networking', async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/shared/config-utils.ts', import.meta.url))],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    const inputs = Object.keys(result.metafile!.inputs).map((path) => path.replaceAll('\\', '/'));
    expect(inputs.some((path) => path.endsWith('/config-utils.ts'))).toBe(true);
    expect(inputs.filter((path) => /(?:undici|network-policy|config-test-runtime|openai-image\.ts)/u.test(path))).toEqual([]);
  });
});
