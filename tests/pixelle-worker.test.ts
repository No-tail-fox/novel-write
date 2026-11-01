import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pixelleWorkerEnvironment, runPixelleWorker } from '../src/shared/pixelle-worker';
import { pixelleParameterLabel, pixelleTemplateLabel } from '../src/features/tasks/pixelle-presentation';
import { PIXELLE_REVISION, type PixelleCatalog, type PixelleRenderFrameRequest } from '../src/shared/pixelle';

const appRoot = resolve('.');
let workDir: string;
let catalog: PixelleCatalog;
let imagePath: string;
const options = { appRoot };
function frame(name = 'image_default.html', patch: Partial<PixelleRenderFrameRequest> = {}): PixelleRenderFrameRequest {
  const template = catalog.templates.find(item => item.ref.path.endsWith(`/${name}`));
  if (!template) throw new Error(`Missing upstream template: ${name}`);
  return { mode: 'render-frame', workDir, templateRef: template.ref, title: '原版模板测试', text: '安全渲染与真实透明图层。', imagePath, ...patch };
}
async function pngSize(path: string) {
  const bytes = await readFile(path);
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'storydream-pixelle-test-'));
  imagePath = join(workDir, 'fixture.png');
  await writeFile(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=', 'base64'));
  catalog = await runPixelleWorker({ mode: 'catalog', workDir }, options);
}, 30_000);
afterAll(async () => { if (workDir) await rm(workDir, { recursive: true, force: true }); });

describe('isolated original Pixelle runtime', () => {
  it('retains all 31 immutable templates and their original parameter DSL', () => {
    expect(catalog.revision).toBe(PIXELLE_REVISION);
    expect(catalog.templates).toHaveLength(31);
    expect(catalog.templates.reduce((counts, item) => ({ ...counts, [item.type]: (counts[item.type] || 0) + 1 }), {} as Record<string, number>)).toEqual({ image: 26, static: 2, video: 2, asset: 1 });
    expect(catalog.templates.reduce((count, item) => count + Object.keys(item.parameters).length, 0)).toBe(54);
    for (const item of catalog.templates) {
      expect(item.ref.provider).toBe('pixelle');
      expect(item.ref.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(item).not.toHaveProperty('templateId');
    }
  });
  it('localizes all 31 template names and 54 parameter controls without mutating upstream metadata', () => {
    const original = structuredClone(catalog);
    for (const item of catalog.templates) {
      expect(pixelleTemplateLabel(item)).toMatch(/[\u4e00-\u9fff]/u);
      for (const [key, parameter] of Object.entries(item.parameters)) {
        expect(pixelleParameterLabel(key, parameter)).toMatch(/[\u4e00-\u9fff]/u);
      }
    }
    expect(catalog).toEqual(original);
    expect(pixelleParameterLabel('future', { type: 'text', default: '', label: 'Future label' })).toBe('Future label');
    expect(pixelleTemplateLabel({ name: 'Future template', ref: { ...catalog.templates[0].ref, path: '1080x1920/future.html' } })).toBe('Future template');
  });
  it('does not pass credentials, proxy settings or code injection environment into Python', () => {
    const env = pixelleWorkerEnvironment({ Path: 'safe', TEMP: 'safe', GEEKAI_API_KEY: 'secret', ANTHROPIC_API_KEY: 'secret', NODE_OPTIONS: 'bad', PYTHONPATH: 'bad', HTTPS_PROXY: 'bad', PLAYWRIGHT_BROWSERS_PATH: 'bad' }, 'bundled');
    expect(env).toEqual({ Path: 'safe', TEMP: 'safe', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', PLAYWRIGHT_BROWSERS_PATH: 'bundled' });
  });
  it('renders an unchanged original image template at its native dimensions', async () => {
    const result = await runPixelleWorker(frame('image_default.html', { output: 'original.png', text: '<script>throw new Error("must remain text")</script>' }), options);
    expect(result.kind).toBe('frame');
    expect(result.requiresVideoComposition).toBe(false);
    expect(result.paidRequests).toBe(0);
    expect(await pngSize(result.path)).toEqual([1080, 1920]);
  }, 30_000);
  it.each(['video_default.html', 'asset_default.html'])('never treats %s video overlays as finished video', async name => {
    const result = await runPixelleWorker(frame(name, { mediaKind: 'video', imagePath: undefined, output: name + '.png' }), options);
    expect(result.kind).toBe('video-overlay');
    expect(result.requiresVideoComposition).toBe(true);
    expect(await pngSize(result.path)).toEqual([1080, 1920]);
  }, 30_000);
  it('fails loudly for missing default resources without overwriting a successful output', async () => {
    const output = 'preserved.png';
    await writeFile(join(workDir, output), 'prior-success');
    await expect(runPixelleWorker(frame('static_default.html', { imagePath: undefined, output }), options)).rejects.toThrow('PIXELLE_RESOURCE_REQUIRED');
    expect(await readFile(join(workDir, output), 'utf8')).toBe('prior-success');
  }, 30_000);
  it.each(['revision', 'sha256', 'path'] as const)('rejects stale or traversing %s references', async key => {
    const request = frame();
    const templateRef = { ...request.templateRef, [key]: key === 'path' ? '../../worker.py' : 'stale' } as typeof request.templateRef;
    await expect(runPixelleWorker({ ...request, templateRef }, options)).rejects.toThrow('stale visualTemplateRef');
  }, 15_000);
  it.each<Record<string, import('../src/shared/pixelle').PixelleTemplateValue>>([{ image: 'override' }, { index: 3 }, { nonexistent: 'value' }])('rejects reserved or unknown parameters %j', async parameters => {
    await expect(runPixelleWorker(frame('image_default.html', { parameters }), options)).rejects.toThrow('Unknown or reserved');
  }, 15_000);
  it('rejects output paths outside the work directory', async () => {
    await expect(runPixelleWorker(frame('image_default.html', { output: '../escape.png' }), options)).rejects.toThrow('Path escapes');
  }, 15_000);
  it('rejects invalid media combinations rather than silently switching to a still frame', async () => {
    await expect(runPixelleWorker(frame('video_default.html'), options)).rejects.toThrow('require video media');
  }, 15_000);
  it('cancels worker execution and always deletes its request file', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 200);
    try { await expect(runPixelleWorker(frame(), { ...options, signal: controller.signal })).rejects.toThrow(/cancel|abort/i); }
    finally { clearTimeout(timer); }
    expect((await readdir(workDir)).filter(name => name.startsWith('pixelle-request-'))).toEqual([]);
  }, 15_000);
});