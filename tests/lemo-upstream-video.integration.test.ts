import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// The renderer module also hosts the legacy Electron path; the upstream engine never touches it.
vi.mock('electron', () => ({ BrowserWindow: class {}, session: {} }));
import { exportLemoUpstreamProject } from '../electron/lemo-upstream-renderer';
import {
  defaultLemoUpstreamRenderCacheDir, finalizeLemoUpstreamFilm, probeLemoMedia, resolveLemoUpstreamRenderRuntime,
} from '../electron/lemo-upstream-video';

const repo = resolve(__dirname, '..');
const pythonRoot = join(repo, 'vendor', 'python');
const upstreamRoot = join(repo, 'vendor', 'lemo-upstream');
const threeRoot = join(repo, 'node_modules', 'three');
const available = process.platform === 'win32'
  && existsSync(join(pythonRoot, 'Lib', 'site-packages', 'playwright', 'driver', 'node.exe'))
  && existsSync(join(pythonRoot, 'playwright-browsers'))
  && existsSync(join(upstreamRoot, 'core', 'render', 'video.mjs'))
  && existsSync(join(threeRoot, 'build', 'three.module.js'));

// core/README.md page contract: READY, render(t) deterministic, DUR seconds. Also proves /node_modules/three is served.
const FILM = `<!doctype html><html><head><meta charset="utf-8">
<script type="importmap">{ "imports": { "three": "/node_modules/three/build/three.module.js" } }</script>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="c" width="320" height="180"></canvas>
<script type="module">
import * as THREE from 'three';
const ctx = document.getElementById('c').getContext('2d');
window.DUR = 1;
window.render = t => {
  const hue = THREE.MathUtils.lerp(0, 300, t);
  ctx.fillStyle = 'hsl(' + hue + ',80%,50%)'; ctx.fillRect(0, 0, 320, 180);
  ctx.fillStyle = '#fff'; ctx.fillRect(10 + t * 260, 70, 40, 40);
};
window.render(0);
window.READY = true;
</script></body></html>`;

describe.skipIf(!available)('upstream video.mjs + mux.sh port with the vendored runtime', () => {
  it('renders a 1 s fixture film and finalizes it with a sine mix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-upstream-video-'));
    try {
      // Task export folders exceed Windows MAX_PATH; video.mjs's mkdtempSync next to --out fails there (ENOENT).
      const filmDir = join(root, 'film'), outputDir = join(root, 'out', 'x'.repeat(120), 'y'.repeat(120));
      expect(join(outputDir, '.native-picture_segs-XXXXXX').length).toBeGreaterThan(260);
      await (await import('node:fs/promises')).mkdir(filmDir, { recursive: true });
      await writeFile(join(filmDir, 'index.html'), FILM, 'utf8');
      const cacheDir = defaultLemoUpstreamRenderCacheDir();
      const started = Date.now();
      const { outputPath, receipt } = await exportLemoUpstreamProject({ upstreamRoot, threeRoot, filmDir, outputDir, pythonRoot, cacheDir,
        durationSeconds: 1, fps: 30, width: 320, height: 180, workers: 1, timeoutMs: 180_000 });
      const elapsed = (Date.now() - started) / 1000;
      console.log(`[lemo-upstream-video] export wall ${elapsed.toFixed(1)}s, video.mjs ${receipt.renderSeconds?.toFixed(1)}s`);
      expect(receipt.technicalPassed).toBe(true);
      expect(receipt.engine).toBe('upstream-video.mjs');
      expect(receipt.frames).toHaveLength(3);
      expect(receipt.missingResources).toEqual([]);
      for (const frame of receipt.frames) expect((await stat(frame.path)).size).toBeGreaterThan(0);
      expect(JSON.parse(await readFile(join(outputDir, 'review.json'), 'utf8')).technicalPassed).toBe(true);
      expect(existsSync(`${outputPath}.lock`)).toBe(false);

      const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot, cacheDir });
      const picture = await probeLemoMedia(runtime.ffmpegPath, outputPath);
      expect(picture.video).toMatchObject({ codec: 'h264', width: 320, height: 180 });
      expect(Math.abs((picture.durationSeconds ?? 0) - 1)).toBeLessThan(0.06);

      // Host's finished film: picture + a shorter (0.6 s) sine mix in one file → exercises loudnorm + apad.
      const film = join(root, 'final.mp4');
      const made = spawnSync(runtime.ffmpegPath, ['-y', '-loglevel', 'error', '-i', outputPath, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.6:sample_rate=44100',
        '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', film], { windowsHide: true });
      expect(made.status, made.stderr?.toString()).toBe(0);
      const t1 = Date.now();
      const result = await finalizeLemoUpstreamFilm(film, { ffmpegPath: runtime.ffmpegPath, fps: 30, grain: 2 });
      console.log(`[lemo-upstream-video] mux ${((Date.now() - t1) / 1000).toFixed(1)}s`, JSON.stringify(result));
      expect(result.outputPath).toBe(resolve(film));
      expect(result.measured).not.toBeNull();
      expect(result.warnings.some(w => w.includes('静音补齐'))).toBe(true);
      const final = await probeLemoMedia(runtime.ffmpegPath, film);
      expect(final.video?.codec).toBe('h264');
      expect(final.audio).toMatchObject({ codec: 'aac', sampleRate: 48000 });
      expect(Math.abs((final.durationSeconds ?? 0) - 1)).toBeLessThan(0.1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 300_000);

  it('kills the whole render tree on abort and leaves no lock or segment folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-upstream-abort-'));
    try {
      const filmDir = join(root, 'film'), outputDir = join(root, 'out');
      await (await import('node:fs/promises')).mkdir(filmDir, { recursive: true });
      await writeFile(join(filmDir, 'index.html'), FILM.replace('window.DUR = 1;', 'window.DUR = 600;'), 'utf8');
      const controller = new AbortController();
      const cacheDir = defaultLemoUpstreamRenderCacheDir(), scratch = join(cacheDir, 'out');
      const { readdir } = await import('node:fs/promises');
      const scratchBefore = new Set(await readdir(scratch).catch(() => [] as string[]));
      const pending = exportLemoUpstreamProject({ upstreamRoot, threeRoot, filmDir, outputDir, pythonRoot, cacheDir,
        durationSeconds: 600, fps: 30, width: 320, height: 180, workers: 2, signal: controller.signal });
      // Abort once video.mjs has started writing segments (in its short scratch --out folder).
      const segmenting = async () => { for (const n of await readdir(scratch).catch(() => [] as string[])) if (!scratchBefore.has(n) && (await readdir(join(scratch, n)).catch(() => [] as string[])).some(f => f.startsWith('.native-picture_segs-'))) return true; return false; };
      for (let i = 0; i < 300 && !await segmenting(); i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 1500));
      const t0 = Date.now();
      controller.abort(new Error('user-cancelled'));
      await expect(pending).rejects.toThrow('user-cancelled');
      console.log(`[lemo-upstream-video] abort settled in ${Date.now() - t0}ms`);
      const left = await readdir(outputDir);
      expect(left.filter(n => n.endsWith('.lock') || n.includes('_segs-'))).toEqual([]);
      expect((await readdir(scratch)).filter(n => !scratchBefore.has(n))).toEqual([]);
      expect(JSON.parse(await readFile(join(outputDir, 'review.json'), 'utf8')).technicalPassed).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
