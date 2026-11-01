import { afterEach, describe, expect, it } from 'vitest';
import { readFile, writeFile, open, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { stageVoxRenderAssets, additionalVoxRenderAssetBytes } from '../electron/vox-render-assets';
import { buildLemoNativeHtml } from '../src/shared/creative-animation/native-html';
import { createVoxAnimation, type VoxAnimationPayload } from '../src/shared/vox-animation';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';

function payload(): VoxAnimationPayload {
  const animation = createVoxAnimation();
  animation.mode = 'code';
  animation.code.engine = 'lemo-native';
  animation.code.compiled = '<!doctype html><html><head></head><body><canvas></canvas></body></html>';
  return { animation, assets: [], cues: [], width: 1920, height: 1080, fps: 24, durationMs: 1000 };
}
afterEach(() => removeTestTempDirectories());
describe('native film asset transport', () => {
  it('serializes the asset payload exactly once and passes identical URLs to the host and generated code', () => {
    const input = payload();
    const url = 'data:image/png;base64,' + 'unique_asset_bytes_'.repeat(100);
    input.assets = [{ id: 'illustration', kind: 'image', label: '插图', url }];
    input.cues = [{ text: '</script><script>unsafe()</script>', startMs: 0, endMs: 1000 }];
    const html = buildLemoNativeHtml('', input);
    expect(html.split(url)).toHaveLength(2);
    expect(html).not.toContain('<script>unsafe()');
    let installed: VoxAnimationPayload | undefined;
    const window = { LemoHost: { install: (value: VoxAnimationPayload) => { installed = value; } }, LEMO_ASSETS: {} as Record<string, string> };
    const bootstrap = [...html.matchAll(/<script nonce="storydream-html-video">([\s\S]*?)<\/script>/g)].map(match => match[1]).find(script => script.includes('const payload='))!;
    vm.runInNewContext(bootstrap, { window });
    expect(installed).toEqual(input);
    expect(window.LEMO_ASSETS.illustration).toBe(installed!.assets[0].url);
  });
  it('copies exact original bytes to safe local filenames without changing the source or trusting asset ids', async () => {
    const directory = await createTestTempDirectory(join(tmpdir(), 'vox-stage-'));
    const source = join(directory, '原图.png');
    const original = Buffer.from('Original image bytes — no resizing, no substitutions');
    await writeFile(source, original);
    const target = join(directory, 'staged');
    const assets = await stageVoxRenderAssets(target, [{ id: '../../untrusted', kind: 'image', path: source }]);
    expect(assets[0].id).toBe('../../untrusted');
    const copied = fileURLToPath(assets[0].url);
    expect(dirname(copied)).toBe(target);
    expect(await readFile(copied)).toEqual(original);
    expect(await readFile(source)).toEqual(original);
    const html = buildLemoNativeHtml('', { ...payload(), assets }, assets.map(asset => asset.url));
    expect(html).not.toContain('data:image');
    expect(html.length).toBeLessThan(10000);
    const policy = html.match(/content="(default-src[^\"]+)"/)![1];
    expect(policy).toContain(assets[0].url);
    expect(policy).not.toContain('img-src file:');
    expect(policy).toContain("connect-src data: blob:;");
  });
  it('leaves editor preview CSP closed to local files by default', () => {
    const input = payload();
    input.assets = [{ id: 'untrusted', label: '', kind: 'image', url: 'file:///private.png' }];
    const policy = buildLemoNativeHtml('', input).match(/content="(default-src[^\"]+)"/)![1];
    expect(policy).not.toContain('file:');
    expect(policy).toContain("default-src 'none'");
  });
  it.each(['https://remote/image.png', 'file://remote/share/image.png', 'file:///image.png#x', 'file:///image.png?q=x'])(
    'rejects a non-local or ambiguous render allowlist URL: %s', url => {
      expect(() => buildLemoNativeHtml('', payload(), [url])).toThrow('LEMO_ASSET_URL');
    });
  it('encodes spaces and quotes in staged allowlist paths', () => {
    const url = pathToFileURL(join(tmpdir(), "film's assets", '原图.png')).href;
    const policy = buildLemoNativeHtml('', payload(), [url]).match(/content="(default-src[^\"]+)"/)![1];
    expect(policy).not.toContain("film's");
    expect(policy).toContain('film%27s%20assets');
  });
  it('retains size and file-type limits without loading rejected files into memory', async () => {
    const directory = await createTestTempDirectory(join(tmpdir(), 'vox-stage-invalid-'));
    const large = join(directory, 'large.png');
    const file = await open(large, 'w');
    try { await file.truncate(49 * 1024 * 1024); } finally { await file.close(); }
    await expect(stageVoxRenderAssets(join(directory, 'staged'), [{ id: 'large', kind: 'image', path: large }])).rejects.toThrow('48 MB');
    await expect(stageVoxRenderAssets(join(directory, 'staged'), [{ id: 'script', kind: 'image', path: join(directory, 'script.js') }])).rejects.toThrow('格式');
    await mkdir(join(directory, 'folder.png'));
    await expect(stageVoxRenderAssets(join(directory, 'staged'), [{ id: 'folder', kind: 'image', path: join(directory, 'folder.png') }])).rejects.toThrow('48 MB');
  });
});
it('shares identical staged bytes across reviews without linking mutable source files', async () => {
  const directory = await createTestTempDirectory(join(tmpdir(), 'vox-shared-stage-'));
  const source = join(directory, 'source.png'), cache = join(directory, 'cache');
  await writeFile(source, 'original');
  const input = [{ id: 'image', kind: 'image' as const, path: source }];
  const first = fileURLToPath((await stageVoxRenderAssets(join(directory, 'review-1'), input, cache))[0].url);
  const second = fileURLToPath((await stageVoxRenderAssets(join(directory, 'review-2'), input, cache))[0].url);
  const { stat, readdir } = await import('node:fs/promises');
  expect((await stat(first)).ino).toBe((await stat(second)).ino);
  expect((await stat(first)).ino).not.toBe((await stat(source)).ino);
  expect(await readdir(cache)).toHaveLength(1);
  await writeFile(source, 'edited original');
  expect(await readFile(first, 'utf8')).toBe('original');
  expect(await readFile(second, 'utf8')).toBe('original');
  const changed = fileURLToPath((await stageVoxRenderAssets(join(directory, 'review-3'), input, cache))[0].url);
  expect(await readFile(changed, 'utf8')).toBe('edited original');
  expect(await readdir(cache)).toHaveLength(2);
});

it('charges new, changed, and corrupt snapshots but not existing verified hard-linked bytes', async () => {
  const directory = await createTestTempDirectory(join(tmpdir(), 'vox-cache-budget-'));
  const source = join(directory, 'source.png'), cache = join(directory, 'cache');
  await writeFile(source, 'original');
  expect(await additionalVoxRenderAssetBytes(source, cache)).toBe(8);
  const staged = fileURLToPath((await stageVoxRenderAssets(join(directory, 'staged'), [{ id: 'image', kind: 'image', path: source }], cache))[0].url);
  expect(await additionalVoxRenderAssetBytes(source, cache)).toBe(0);
  await writeFile(source, 'new source');
  expect(await additionalVoxRenderAssetBytes(source, cache)).toBe(10);
  await writeFile(source, 'original');
  await writeFile(staged, 'corrupt!');
  expect(await additionalVoxRenderAssetBytes(source, cache)).toBe(8);
  expect(await readFile(source, 'utf8')).toBe('original');
});
