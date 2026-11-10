import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stepLemoUpstreamAgent, lemoAgentImagePrompt, type LemoAgentImages, type LemoAgentOptions } from '../electron/lemo-upstream-agent';
import { createFfmpegLemoAssetMedia, readLemoAssetManifest, stageLemoAssets, verifyLemoAssets, type LemoAssetMedia } from '../electron/lemo-upstream-assets';
import { lemoUpstreamVideoInternals } from '../electron/lemo-upstream-video';
import { LEMO_UPSTREAM_REVISION } from '../electron/lemo-upstream-source';
import { lemoAgentAssetErrors, lemoAgentImagePolicy, lemoStyleRequiresRealMaterial } from '../src/shared/creative-animation/agent-assets';
import { voxProductionSettingsSchema } from '../src/shared/vox-production';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const json = (value: object) => '```json\n' + JSON.stringify(value) + '\n```';
const write = (path: string, source: string) => json({ tool: 'write_file', path }) + '\n```js\n' + source + '\n```';

const media = (): LemoAssetMedia & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    probe: async path => { calls.push('probe'); return /\.(?:mp4|webm)$/.test(path) ? { width: 1280, height: 720, durationSeconds: 0.5 } : { width: 800, height: 600, durationSeconds: null }; },
    frames: async (_source, dir, options) => { calls.push('frames'); const count = Math.round(0.5 * options.fps); for (let i = 1; i <= count; i++) await writeFile(join(dir, `f${String(i).padStart(5, '0')}.jpg`), `frame-${i}`); return count; },
    thumbnail: async (source, dest) => { calls.push('thumbnail'); await mkdir(join(dest, '..'), { recursive: true }); await copyFile(source, dest); },
  };
};

async function fixture(replies: string[], extra: { assets?: boolean; images?: Partial<LemoAgentImages> & { maxImages?: number } } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-assets-')); roots.push(root);
  const sources = join(root, 'sources'); await mkdir(sources);
  const photo = join(sources, 'harbor.jpg'), clip = join(sources, 'street.mp4');
  await writeFile(photo, 'real-photo-bytes'); await writeFile(clip, 'real-video-bytes');
  const model = vi.fn<LemoAgentOptions['model']>(async () => { const text = replies.shift(); if (!text) throw new Error('no mock replies'); return { text, raw: text, requestId: 'mock', finishReason: 'stop' }; });
  const generatedPng = join(sources, 'provider-output.png'); await writeFile(generatedPng, 'generated-png-bytes');
  const images: LemoAgentImages | undefined = extra.images ? {
    provider: 'mock-image', isRejection: message => message.startsWith('REJECT'),
    generate: vi.fn(async () => ({ path: generatedPng })), recover: vi.fn(async () => undefined), ...extra.images,
  } : undefined;
  const tools = media();
  const options: LemoAgentOptions = {
    root: join(root, 'run'), upstreamRoot: resolve('vendor/lemo-upstream'), model,
    context: { runId: 'asset-run', styleId: 'brick-toy', brief: '用导入的港口照片和街景视频制作影片。', durationSeconds: 3, width: 1920, height: 1080,
      ...(extra.assets ? { assets: [
        { id: 'a01', kind: 'image' as const, sha256: sha('real-photo-bytes'), description: '港口老照片', source: '市档案馆', license: 'CC0' },
        { id: 'a02', kind: 'video' as const, sha256: sha('real-video-bytes'), description: '街景', source: '自摄', license: '自有版权' },
      ] } : {}),
      ...(extra.images ? { imageGeneration: { maxImages: extra.images.maxImages ?? 2 } } : {}) },
    ...(extra.assets || extra.images ? { assetHost: { files: { a01: photo, a02: clip }, media: tools } } : {}),
    ...(images ? { images } : {}),
    review: vi.fn<LemoAgentOptions['review']>(async (directory, outputDir, times) => {
      await mkdir(outputDir, { recursive: true });
      const frames = await Promise.all(times.map(async (time, index) => { const path = join(outputDir, index + '.png'); await writeFile(path, 'png'); return { time, path }; }));
      return { revision: LEMO_UPSTREAM_REVISION, entry: directory, width: 1920, height: 1080, frames, errors: [], missingResources: [], failedFonts: [], technicalPassed: true, aestheticReview: false, durationSeconds: 3 };
    }),
  };
  return { root, options, model, images, tools, photo, clip, project: join(root, 'run', 'project') };
}

describe('Lemo v3 material channel (P1-4)', () => {
  it('leaves runs without material byte-identical: same context hash, no assets dir, no material prompt', async () => {
    const { options, model, project } = await fixture([write('index.html', 'x')]);
    await stepLemoUpstreamAgent(options);
    const journal = JSON.parse(await readFile(join(options.root, 'journal.json'), 'utf8'));
    expect(journal.contextHash).toBe(sha(JSON.stringify(options.context)));
    expect(existsSync(join(project, 'assets'))).toBe(false);
    expect(model.mock.calls[0][0].messages[0].content).not.toContain('MANIFEST');
  });

  it('stages images and video frame sequences, lists only the manifest and lets the agent view a thumbnail', async () => {
    const { options, model, project } = await fixture([json({ tool: 'list_files', scope: 'project' }), json({ tool: 'view_asset', id: 'a02' }), write('index.html', 'x')], { assets: true });
    await stepLemoUpstreamAgent(options);
    const manifest = (await readLemoAssetManifest(project))!;
    expect(manifest.assets.map(a => [a.id, a.kind, a.file ?? a.frames?.pattern])).toEqual([['a01', 'image', 'assets/a01.jpg'], ['a02', 'video', 'assets/a02/f%05d.jpg']]);
    expect(manifest.assets[1].frames).toMatchObject({ count: 12, fps: 24, durationSeconds: 0.5 });
    expect(await readFile(join(project, 'assets/a01.jpg'), 'utf8')).toBe('real-photo-bytes');
    expect(model.mock.calls[0][0].messages[0].content).toContain('港口老照片');
    const listing = JSON.parse(JSON.parse(await readFile(join(options.root, 'journal.json'), 'utf8')).turns[0].observation);
    expect(listing.map((f: { path: string }) => f.path)).toEqual(['assets/MANIFEST.json']);
    const viewed = await stepLemoUpstreamAgent(options);
    expect(viewed.assetPreview?.id).toBe('a02');
    await stepLemoUpstreamAgent(options);
    const next = model.mock.calls[2][0].messages.at(-1)!;
    expect(next.images?.map(image => image.label)).toEqual(['Asset a02 (thumbnail)']);
    expect(next.images?.[0].dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('refuses agent writes under assets/ and rejects tampering before export', async () => {
    const { options, project } = await fixture([write('assets/MANIFEST.json', '{}')], { assets: true });
    const film = await stepLemoUpstreamAgent(options);
    expect(film.message).toContain('LEMO_AGENT_WRITE_DENIED');
    await expect(verifyLemoAssets(project)).resolves.toBeDefined();
    await writeFile(join(project, 'assets/a02/f00003.jpg'), 'edited');
    await expect(verifyLemoAssets(project)).rejects.toThrow('LEMO_ASSET_INTEGRITY');
  });

  it('invalidates the run when an imported file changes', async () => {
    const { options, photo } = await fixture([write('index.html', 'x')], { assets: true });
    await stepLemoUpstreamAgent(options);
    await writeFile(photo, 'different');
    const changed = { ...options, context: { ...options.context, assets: options.context.assets!.map(a => a.id === 'a01' ? { ...a, sha256: sha('different') } : a) } };
    await expect(stepLemoUpstreamAgent(changed)).rejects.toThrow('LEMO_AGENT_CONTEXT_CHANGED');
    await expect(stageLemoAssets({ projectDir: join(options.root, 'project'), previewDir: join(options.root, 'p'), inputs: changed.context.assets!, files: options.assetHost!.files, media: media(), canvas: { width: 1920, height: 1080 } })).rejects.toThrow('LEMO_ASSET_CHANGED');
  });

  it('rejects unsupported and over-long media with LEMO_ASSET_* codes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-assets-bad-')); roots.push(root);
    const gif = join(root, 'a.gif'); await writeFile(gif, 'gif');
    const base = { projectDir: join(root, 'project'), previewDir: join(root, 'preview'), media: media(), canvas: { width: 1920, height: 1080 } };
    await expect(stageLemoAssets({ ...base, inputs: [{ id: 'a01', kind: 'image', sha256: sha('gif'), description: 'x', source: 's', license: 'l' }], files: { a01: gif } })).rejects.toThrow('LEMO_ASSET_UNSUPPORTED');
    const long = join(root, 'long.mp4'); await writeFile(long, 'long');
    const slow = { ...media(), probe: async () => ({ width: 640, height: 360, durationSeconds: 95 }) };
    await expect(stageLemoAssets({ ...base, media: slow, inputs: [{ id: 'a01', kind: 'video', sha256: sha('long'), description: 'x', source: 's', license: 'l' }], files: { a01: long } })).rejects.toThrow('LEMO_ASSET_TOO_LONG');
    await expect(stageLemoAssets({ ...base, inputs: [{ id: 'a01', kind: 'image', sha256: sha('x'), description: 'x', source: 's', license: 'l' }], files: { a01: join(root, 'missing.jpg') } })).rejects.toThrow('LEMO_ASSET_MISSING');
  });
});

describe('Lemo v3 optional illustration channel (P2-4)', () => {
  const request = (id: string, transparent = false) => json({ tool: 'request_image', id, prompt: 'a hand-painted lighthouse keeper in warm gouache', transparent });

  it('is unavailable unless enabled', async () => {
    const { options } = await fixture([request('g1')]);
    expect((await stepLemoUpstreamAgent(options)).message).toContain('LEMO_IMAGE_DISABLED');
  });

  it('generates once, appends the manifest, enforces the per-film cap and adds host guard rails', async () => {
    const { options, images, project, model } = await fixture([request('g1', true), request('g2')], { images: { maxImages: 1 } });
    const first = await stepLemoUpstreamAgent({ ...options, requestId: 'node-1' });
    expect(first.message).toContain('"remaining":0');
    expect(model.mock.calls[0][0].messages[0].content).toContain('at most 1 generated image');
    const call = vi.mocked(images!.generate).mock.calls[0][0];
    expect(call.prompt).toBe(lemoAgentImagePrompt('a hand-painted lighthouse keeper in warm gouache', true));
    expect(call.prompt).toContain('#00FF00');
    expect(call.prompt).toContain('No text');
    const manifest = (await readLemoAssetManifest(project))!;
    expect(manifest.assets).toEqual([expect.objectContaining({ id: 'g1', origin: 'generated', file: 'assets/generated/g1.png', transparent: true })]);
    expect(await readFile(join(project, 'assets/generated/g1.png'), 'utf8')).toBe('generated-png-bytes');
    const second = await stepLemoUpstreamAgent({ ...options, requestId: 'node-2' });
    expect(second.message).toContain('LEMO_IMAGE_BUDGET');
    expect(images!.generate).toHaveBeenCalledTimes(1);
  });

  it('never re-sends an unknown image request; recovers it free or retries only with explicit authority', async () => {
    const { options, images, model } = await fixture([request('g1')], { images: {} });
    vi.mocked(images!.generate).mockRejectedValueOnce(new Error('socket hang up'));
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'node-1' })).rejects.toThrow('LEMO_IMAGE_REQUEST_UNKNOWN');
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'node-2' })).rejects.toThrow('LEMO_IMAGE_REQUEST_UNKNOWN');
    expect(images!.generate).toHaveBeenCalledTimes(1);
    expect(images!.recover).toHaveBeenCalledTimes(1);
    expect(vi.mocked(images!.recover!).mock.calls[0][0].requestId).toBe(vi.mocked(images!.generate).mock.calls[0][0].requestId);
    // The user confirmed with the provider that node-1 produced nothing.
    const film = await stepLemoUpstreamAgent({ ...options, requestId: 'node-3', retryOfRequestId: 'node-1' });
    expect(film.message).toContain('"id":"g1"');
    expect(images!.generate).toHaveBeenCalledTimes(2);
    expect(model).toHaveBeenCalledTimes(1);
    const turnDir = join(options.root, 'turn-0001');
    expect((await readdir(turnDir)).some(name => name.startsWith('image-abandoned-'))).toBe(true);
  });

  it('adopts a recovered provider result without charging again', async () => {
    const { options, images } = await fixture([request('g1')], { images: {} });
    vi.mocked(images!.generate).mockRejectedValueOnce(new Error('timeout'));
    await expect(stepLemoUpstreamAgent({ ...options, requestId: 'n1' })).rejects.toThrow('UNKNOWN');
    vi.mocked(images!.recover!).mockImplementationOnce(async () => ({ path: join(options.root, '..', 'sources', 'provider-output.png') }));
    const film = await stepLemoUpstreamAgent({ ...options, requestId: 'n2' });
    expect(film.message).toContain('"origin":"generated"');
    expect(images!.generate).toHaveBeenCalledTimes(1);
  });

  it('feeds a definitive provider refusal back to the agent without marking it unknown', async () => {
    const { options, images } = await fixture([request('g1')], { images: {} });
    vi.mocked(images!.generate).mockRejectedValueOnce(new Error('REJECT: content policy'));
    const film = await stepLemoUpstreamAgent({ ...options, requestId: 'n1' });
    expect(film.message).toContain('LEMO_IMAGE_REJECTED');
    expect(film.turn).toBe(1);
  });

  it('free replay never submits a new image request', async () => {
    const { options, images } = await fixture([request('g1')], { images: {} });
    const mustNotCharge = async (): Promise<never> => { throw new Error('LEMO_RECOVERY_MUST_NOT_CHARGE'); };
    // Persist the paid model response first, as if the process died before executing it.
    await mkdir(join(options.root, 'turn-0001'), { recursive: true });
    await writeFile(join(options.root, 'turn-0001', 'response.json'), JSON.stringify({ text: request('g1'), raw: '', requestId: 'm', finishReason: 'stop' }));
    await expect(stepLemoUpstreamAgent({ ...options, model: mustNotCharge, images: { ...images!, recoveryOnly: true, generate: mustNotCharge } })).rejects.toThrow('LEMO_RECOVERY_MUST_NOT_CHARGE');
    expect(existsSync(join(options.root, 'turn-0001', 'image.json'))).toBe(false);
    expect(images!.generate).not.toHaveBeenCalled();
  });
});

const bundledFfmpeg = resolve('vendor/python/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe');
describe.skipIf(!existsSync(bundledFfmpeg))('bundled ffmpeg media adapter', () => {
  it('probes, extracts a deterministic 24 fps sequence and writes thumbnails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lemo-assets-ffmpeg-')); roots.push(root);
    const clip = join(root, 'clip.mp4'), still = join(root, 'still.png');
    const { runProcess } = lemoUpstreamVideoInternals;
    expect((await runProcess(bundledFfmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=1', '-pix_fmt', 'yuv420p', clip])).code).toBe(0);
    expect((await runProcess(bundledFfmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x200', '-frames:v', '1', still])).code).toBe(0);
    const ffmpeg = createFfmpegLemoAssetMedia(bundledFfmpeg);
    const project = join(root, 'project'), preview = join(root, 'preview');
    const manifest = await stageLemoAssets({ projectDir: project, previewDir: preview, media: ffmpeg, canvas: { width: 1920, height: 1080 },
      inputs: [{ id: 'a01', kind: 'image', sha256: sha(await readFile(still)), description: 'still', source: 's', license: 'l' },
        { id: 'a02', kind: 'video', sha256: sha(await readFile(clip)), description: 'clip', source: 's', license: 'l' }],
      files: { a01: still, a02: clip } });
    expect(manifest.assets[0]).toMatchObject({ width: 320, height: 200 });
    expect(manifest.assets[1]).toMatchObject({ width: 640, height: 360, frames: { count: 24, fps: 24 } });
    expect(existsSync(join(preview, 'a01.jpg')) && existsSync(join(preview, 'a02.jpg'))).toBe(true);
    await expect(verifyLemoAssets(project)).resolves.toBeDefined();
  }, 60000);
});

describe('material policy', () => {
  const base = voxProductionSettingsSchema.parse({ version: 1, presetId: 'paper-explainer', presetVersion: 1, authoring: { mode: 'ai-code', styleId: 'kino-montage' } });
  it('is off by default and forbidden for documentary / evidence styles', () => {
    expect(lemoAgentImagePolicy(base).enabled).toBe(false);
    expect(lemoStyleRequiresRealMaterial('kino-montage')).toBe(true);
    expect(lemoStyleRequiresRealMaterial('satellite-briefing')).toBe(true);
    expect(lemoStyleRequiresRealMaterial('brick-toy')).toBe(false);
    expect(lemoAgentImagePolicy({ ...base, agentImages: { enabled: true, maxImages: 6 } })).toMatchObject({ enabled: false, denied: expect.any(String) });
    expect(lemoAgentImagePolicy({ ...base, authoring: { mode: 'ai-code', styleId: 'brick-toy' }, agentImages: { enabled: true, maxImages: 6 } })).toEqual({ enabled: true, maxImages: 6 });
    expect(lemoAgentAssetErrors({ assets: [] }, { ...base, agentImages: { enabled: true, maxImages: 6 } }).join()).toContain('纪实/证据类');
  });
  it('accepts imported videos for the Lemo route and reports missing files', () => {
    const settings = { ...base, archives: [{ assetVersionId: 'v1', source: '自摄', license: '自有' }] };
    expect(lemoAgentAssetErrors({ assets: [{ id: 'v1', assetId: 'v1', kind: 'video', localPath: 'C:/clip.mp4', createdAt: new Date().toISOString() } as never] }, settings)).toEqual([]);
    expect(lemoAgentAssetErrors({ assets: [] }, settings).join()).toContain('找不到');
  });
});
