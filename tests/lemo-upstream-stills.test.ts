import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { defaultLemoUpstreamRenderCacheDir, lemoUpstreamVideoInternals, resolveLemoUpstreamRenderRuntime, stageLemoUpstreamRenderRoot } from '../electron/lemo-upstream-video';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lemoUpstreamStillsInternals, parseLemoUpstreamStillLog, renderLemoUpstreamStills } from '../electron/lemo-upstream-stills';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const temp = async () => { const root = await mkdtemp(join(tmpdir(), 'lemo-stills-unit-')); roots.push(root); return root; };

describe('upstream still host API', () => {
  it('reclaims a stage whose recorded owner process has exited', async () => {
    const root = await temp(), stage = join(root, 'stage'), ownerPid = 2_000_000_000;
    await mkdir(stage);
    await writeFile(join(stage, '.storydream-render-root.building'), JSON.stringify({ version: 1, key: 'key', ownerPid }), 'utf8');
    await writeFile(join(stage, 'partial.txt'), 'partial', 'utf8');
    expect(await lemoUpstreamVideoInternals.reclaimDeadStage(stage, 'key', ownerPid)).toBe(true);
    await expect(stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it.skipIf(!existsSync('vendor/python/Lib/site-packages/playwright/driver/node.exe'))('renders a real no-paid fixture with isolated outputs and a persisted receipt', async () => {
    const root = await temp(), cacheDir = defaultLemoUpstreamRenderCacheDir();
    const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: 'vendor/python', cacheDir });
    const upstreamRoot = await stageLemoUpstreamRenderRoot({ upstreamRoot: 'vendor/lemo-upstream', threeRoot: 'node_modules/three', playwrightCorePath: runtime.playwrightCorePath, cacheDir });
    const options = { runtime, upstreamRoot, filmDir: 'tests/fixtures/lemo-preview', outputDir: join(root, 'out'), times: [0, .5, .5], durationSeconds: 2, width: 320, height: 180, captions: 0 as const, timeoutMs: 90_000 };
    const receipt = await renderLemoUpstreamStills(options);
    expect(receipt.errors).toEqual([]);
    expect(receipt.technicalPassed).toBe(true);
    expect(receipt.revision).not.toBe('unknown');
    expect(receipt.frames).toHaveLength(3);
    for (const frame of receipt.frames) expect((await stat(frame.path)).size).toBeGreaterThan(0);
    expect(await readFile(receipt.logPath!, 'utf8')).toContain('--q captions=0');
    const again = await renderLemoUpstreamStills(options);
    expect(again.frames[0].path).not.toBe(receipt.frames[0].path);
    expect((await stat(receipt.frames[0].path)).size).toBeGreaterThan(0);
  }, 180_000);
  it.skipIf(!existsSync('vendor/python/Lib/site-packages/playwright/driver/node.exe'))('renders from a deep Windows-style review path using a short cache scratch root', async () => {
    const root = await temp(), cacheDir = join(root, 'cache');
    const runtime = await resolveLemoUpstreamRenderRuntime({ pythonRoot: 'vendor/python', cacheDir });
    const upstreamRoot = await stageLemoUpstreamRenderRoot({ upstreamRoot: 'vendor/lemo-upstream', threeRoot: 'node_modules/three', playwrightCorePath: runtime.playwrightCorePath, cacheDir });
    const outputDir = join(root, 'tasks', 'task-key-'.padEnd(64, 'a'), 'vox-production', 'pi-film', 'run-id-'.padEnd(40, 'b'), 'reviews', 'source-hash-'.padEnd(75, 'c'), 'look-1');
    const receipt = await renderLemoUpstreamStills({ runtime, upstreamRoot, filmDir: 'tests/fixtures/lemo-preview', outputDir, scratchDir: cacheDir,
      times: [0, .5], durationSeconds: 2, width: 320, height: 180, timeoutMs: 90_000 });
    expect(receipt.technicalPassed).toBe(true);
    expect(receipt.errors).toEqual([]);
    expect(receipt.frames.every(frame => frame.path.startsWith(join(defaultLemoUpstreamRenderCacheDir(), 'review-')))).toBe(true);
    expect((await readFile(join(defaultLemoUpstreamRenderCacheDir(), 'review.json'), 'utf8'))).toContain('artifactDirectory');
    expect(receipt.logPath).toContain(join(defaultLemoUpstreamRenderCacheDir(), 'review-'));
    expect(receipt.frames.every(frame => !frame.path.startsWith(outputDir))).toBe(true);
    expect(receipt.logPath).toMatch(/render\.log$/u);
  }, 180_000);
  it('parses optional resource receipts and page warnings', () => {
    expect(parseLemoUpstreamStillLog('[page] optional file missing: http://127.0.0.1:1/@film/a.png (404, requested by img; fine if fallback)\n[note] WebGL runs on software rendering\n[pageerror] boom')).toEqual({
      missingResources: [{ path: '/@film/a.png', status: 404 }],
      warnings: ['[note] WebGL runs on software rendering', '[pageerror] boom'],
    });
  });

  it('validates duration and times before touching the runtime', () => {
    const base = { runtime: {} as never, upstreamRoot: 'u', filmDir: 'f', outputDir: 'o', durationSeconds: 2, width: 320, height: 180 };
    expect(() => lemoUpstreamStillsInternals.validate({ ...base, times: [] })).toThrow('TIME_INVALID');
    expect(() => lemoUpstreamStillsInternals.validate({ ...base, times: [2] })).toThrow('TIME_INVALID');
    expect(() => lemoUpstreamStillsInternals.validate({ ...base, times: [-.1] })).toThrow('TIME_INVALID');
    expect(() => lemoUpstreamStillsInternals.validate({ ...base, durationSeconds: 0, times: [0] })).toThrow('DURATION_INVALID');
    expect(() => lemoUpstreamStillsInternals.validate({ ...base, times: [0], width: 321 })).toThrow('CANVAS_SIZE');
  });

  it('honors an already-aborted signal without launching node', async () => {
    const root = await temp();
    const controller = new AbortController(); controller.abort(new Error('user-cancelled'));
    await expect(renderLemoUpstreamStills({ runtime: {} as never, upstreamRoot: root, filmDir: root, outputDir: join(root, 'out'), times: [0], durationSeconds: 1, width: 320, height: 180, signal: controller.signal })).rejects.toThrow('user-cancelled');
  });
});
