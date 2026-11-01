import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { CREATIVE_STYLES, resolveCreativeStyle, LEMO_REVISION } from '../src/shared/creative-animation/styles';
import { creativeStyleSample, LEMO_GALLERY_URL } from '../src/shared/creative-animation/samples';
import { creativeStylePoster } from '../src/shared/creative-animation/posters';
import coverManifest from '../src/assets/creative-style-previews/manifest.json';
import { loadCreativeStyleReference } from '../electron/creative-style-references';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, voxProductionSettings, voxProductionInputErrors, voxProductionSettingsSchema } from '../src/shared/vox-production';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { VoxProductionService } from '../electron/vox-production-service';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { creativeUnsupportedClaims, creativeMinimumFontSize, creativeBackgroundMatches, creativeReviewSampleTimes } from '../src/shared/creative-animation/review';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { repairHtmlVideoPlanningSlots, buildHtmlVideoPlanningSystemPrompt } from '../src/shared/task-runtime-providers';
import { directorImageInput, directorImageInputMatches } from '../src/features/director-desk/director-generation';
import { editorialLayerPrompt } from '../src/shared/editorial-motion';
import { validateVoxAnimation } from '../src/shared/vox-animation';
import { nativeHarness, nativeHtml } from './lemo-native.fixture';

const root = resolve('vendor/lemo-opuscar');
describe('creative code property validation', () => {
  it('reviews the actual first and last rendered frames, including a one-frame shot', () => {
    const times = creativeReviewSampleTimes(3000);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBeCloseTo(71 * 1000 / 24);
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    expect(creativeReviewSampleTimes(10).every(time => time < 10)).toBe(true);
  });
  it('sets a canvas-relative type floor and rejects a dark/light theme substitution', () => {
    expect(creativeMinimumFontSize(1920, 1080)).toBe(24);
    expect(creativeMinimumFontSize(1080, 1920)).toBe(24);
    expect(creativeBackgroundMatches('rgb(244, 238, 223)', '#f4eedf')).toBe(true);
    expect(creativeBackgroundMatches('rgba(241, 235, 220, 1)', '#f4eedf')).toBe(true);
    expect(creativeBackgroundMatches('rgb(22, 27, 34)', '#f4eedf')).toBe(false);
    expect(creativeBackgroundMatches('rgba(244, 238, 223, 0)', '#f4eedf')).toBe(false);
  });
  it('rejects unsupported high-record/threshold/baseline annotations but permits supplied facts', () => {
    expect(creativeUnsupportedClaims('历史最高记录，1.0℃ 升温警戒线，BASELINE 1951-1980', 'NASA GISTEMP · 2024年 1.28℃')).toHaveLength(3);
    expect(creativeUnsupportedClaims('历史最高记录', '原文说明这是历史最高记录。')).toEqual([]);
    expect(creativeUnsupportedClaims('四个年份的观测记录，并非未来预测', '')).toEqual([]);
    expect(creativeUnsupportedClaims('SCALE 10-20 μm // SCANNING ELECTRON MICROSCOPY', '微小凸起与蜡质')).toHaveLength(2);
    expect(creativeUnsupportedClaims('10 μm', '实测尺寸为 10 μm')).toEqual([]);
    expect(creativeUnsupportedClaims('TRAPPED AIR CUSHION (接触角 > 150°)', '微小凸起与蜡质')).toEqual(['接触角 > 150°']);
    expect(creativeUnsupportedClaims('CONTACT ANGLE: 151 degrees', '')).toHaveLength(1);
    expect(creativeUnsupportedClaims('接触角 >150°', '提供的测量说明：接触角 > 150°')).toEqual([]);
  });
  it('accepts CSS and typed property names without treating them as global reads', () => {
    expect(compileVoxCode('import React from "react"; type Props={top:number}; export default function Scene(props:Props){const {top:offset}=props;return <div style={{position:"absolute",top:props.top+offset}}>数据</div>}').compiled).toContain('top: props.top + offset');
  });
  it.each(['top.location', 'window.top', '({top})', '({[top]:1})', '({top:top})'])('still rejects global access: %s', expression => {
    expect(() => compileVoxCode(`import React from "react"; export default function Scene(){const value=${expression};return <div/>}`)).toThrow('不能访问');
  });
});
describe('pinned creative style references', () => {
  it('bundles a distinct, intact offline cover for every selectable style', async () => {
    expect(coverManifest.entries.map(item => item.slug).sort()).toEqual(CREATIVE_STYLES.map(item => item.slug).sort());
    const hashes = new Set<string>();
    for (const style of CREATIVE_STYLES) {
      const cover = coverManifest.entries.find(item => item.slug === style.slug)!;
      expect(creativeStylePoster(style.slug), style.slug).toBeTruthy();
      const bytes = await readFile(resolve('src/assets/creative-style-previews', cover.file));
      expect(bytes.subarray(0, 4).toString(), style.slug).toBe('RIFF');
      expect(bytes.subarray(8, 12).toString(), style.slug).toBe('WEBP');
      expect(createHash('sha256').update(bytes).digest('hex'), style.slug).toBe(cover.previewSha256);
      expect(cover.previewSize[0]).toBeGreaterThan(0);
      expect(cover.previewSize[0]).toBeLessThanOrEqual(768);
      expect(cover.license).toBe('CC-BY-4.0');
      hashes.add(cover.previewSha256);
    }
    expect(hashes.size).toBe(59);
    expect(creativeStylePoster('unknown-style')).toBeUndefined();
    expect(creativeStylePoster('../other')).toBeUndefined();
  });
  it('provides official sample films for every selectable style and preserves voice license exceptions', async () => {
    for (const style of CREATIVE_STYLES.filter(item => item.adapter)) {
      const sample = creativeStyleSample(style.slug)!;
      expect(sample).toBeDefined();
      expect(sample.video).toBe(`${LEMO_GALLERY_URL}films/${style.slug}.mp4`);
      expect(sample.poster).toBe(`${LEMO_GALLERY_URL}img/${style.slug}_0.jpg`);
    }
    expect(creativeStyleSample('auto')).toBeUndefined();
    expect(creativeStyleSample('../other')).toBeUndefined();
    expect(creativeStyleSample('unknown-style')).toBeUndefined();
    expect(CREATIVE_STYLES.filter(style => creativeStyleSample(style.slug)?.voiceExcludedFromCc).map(style => style.slug).sort()).toEqual(['game-show', 'news-package', 'paper-lantern']);
    const html = await readFile(resolve('index.html'), 'utf8');
    const csp = html.match(/media-src[^;]+/)![0];
    expect(csp).toContain('https://lemomo-ai.github.io');
    expect(csp).not.toMatch(/https:;|\*/);
  });
  it('imports all 59 text styles with verified provenance and no demo media', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.revision).toBe(LEMO_REVISION);
    expect(CREATIVE_STYLES).toHaveLength(59);
    expect(new Set(CREATIVE_STYLES.map(s => s.slug)).size).toBe(59);
    expect(CREATIVE_STYLES.filter(s => s.adapter)).toHaveLength(59);
    for (const file of manifest.files) {
      expect(file.path).toMatch(/\.(md|json)$|^LICENSE$/);
      expect(createHash('sha256').update(await readFile(join(root, file.path))).digest('hex')).toBe(file.sha256);
    }
    expect(resolveCreativeStyle('auto', 'data-map')?.slug).toBe('dataviz');
    expect(resolveCreativeStyle('auto', 'archival-story')?.slug).toBe('archive-lighttable');
    for (const style of CREATIVE_STYLES) {
      const reference = await loadCreativeStyleReference(root, style.slug);
      expect(reference).toContain('<director-reference>');
      expect(reference).toContain('<technique-reference>');
      expect(reference).toContain(style.adapter.direction);
    }
    await expect(loadCreativeStyleReference(root, '../README')).rejects.toThrow('UNADAPTED');
    await expect(loadCreativeStyleReference(root, 'unknown-style')).rejects.toThrow('UNADAPTED');
  });
  it('rejects changed reference text before model dispatch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'creative-integrity-'));
    try {
      await mkdir(join(dir, 'styles/dataviz'), { recursive: true });
      for (const path of ['manifest.json', 'DIRECTOR.md', 'TECHNIQUE.md']) await writeFile(join(dir, path), await readFile(join(root, path)));
      await writeFile(join(dir, 'styles/dataviz/STYLE.md'), 'tampered');
      await expect(loadCreativeStyleReference(dir, 'dataviz')).rejects.toThrow('INTEGRITY');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

function fixture() {
  const d = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'creative', title: '真实数据', ratio: '16:9' }), '城市白天吸收热量。树荫帮助街道降温。', '2026-10-24T00:00:00.000Z', 15000);
  const settings = { ...voxProductionSettings('data-map'), narration: false, authoring: { mode: 'ai-code' as const, styleId: 'auto' }, data: [{ label: 'A', value: 1, source: 'test source' }, { label: 'B', value: 2, source: 'test source' }] };
  const nodes = buildVoxProductionNodes(d, settings, 'legacy');
  d.productionRun = { version: 1, id: 'r', settings, status: 'running', sourceHash: '', runtimeIdentity: '', nodes, createdAt: d.createdAt, updatedAt: d.updatedAt };
  const node = (kind: string) => ({ ...nodes.find(n => n.kind === kind && n.shotId === d.beats[0].shots[0].id)!, requestId: `request-${kind}` });
  return { d, settings, node };
}
const validSource = 'import React from "react"; export default function Scene(){return <div>真实数据</div>}';
function ops(overrides: Partial<VoxProductionOperations> = {}): VoxProductionOperations {
  const never = async (): Promise<never> => { throw new Error('unexpected paid call'); };
  return { identity: 'test', imageModel: 'test', voiceModel: 'test', voice: { provider: 'volcengine', voiceId: 'test', voiceLabel: 'test', speed: 1 }, preflight() {}, plan: never, image: never, speech: never, cutout: never, render: async d => d, verifyVideo: async () => {}, compileCode: compileVoxCode, generateCode: async () => validSource, previewCode: async () => ['a.jpg', 'b.jpg', 'c.jpg'], ...overrides };
}
describe('all creative production styles', () => {
  it('can assemble, author and compile all styles without image assets or semantic placeholders', async () => {
    for (const style of CREATIVE_STYLES) {
      const { d } = fixture(), shot = d.beats[0].shots[0];
      const settings = { ...voxProductionSettings(), generateImages: false, narration: false, authoring: { mode: 'ai-code' as const, styleId: style.slug } };
      d.productionRun!.settings = settings;
      const nodes = buildVoxProductionNodes(d, settings, 'legacy');
      const generateCode = vi.fn(async () => validSource);
      const runtime = createVoxProductionRuntime(ops({ generateCode }));
      let current = d;
      for (const kind of ['animation', 'code', 'code-review', 'code-finalize', 'compile']) {
        current = await runtime.execute(current, { ...nodes.find(node => node.kind === kind && node.shotId === shot.id)!, requestId: `no-image-${kind}` });
      }
      const result = current.beats[0].shots[0];
      expect(result.animation!.mode, style.slug).toBe('code');
      expect(result.animation!.template.props.assetIds, style.slug).toEqual([]);
      expect(result.cuePlan, style.slug).toBeUndefined();
      const request = (generateCode.mock.calls[0] as unknown as [{ prompt: string }])[0];
      expect(request.prompt).toContain('已关闭生图');
      expect(request.prompt).toContain(style.adapter.motionDirection);
      const scene = buildDirectorRenderScenes(current, undefined, { shotIds: [shot.id] })[0];
      expect(scene.semanticBeats).toBeUndefined();
      expect(scene.animationAssets).toEqual([]);
    }
  });
  it('selects different compatible templates and carries existing subtitle content into them', async () => {
    const selected: Record<string, string> = {};
    for (const styleId of ['caption-news', 'watercolor', 'swiss-motion', 'city-symphony']) {
      const { d } = fixture(), shot = d.beats[0].shots[0];
      const settings = { ...voxProductionSettings(), narration: false, authoring: { mode: 'template' as const, styleId } };
      d.productionRun!.settings = settings;
      shot.title = '城市街道与树荫';
      for (const layer of shot.layers.filter(item => !item.content)) {
        const id = `${styleId}-${layer.id}`;
        d.assets.push({ id, assetId: id, kind: 'image', localPath: `I:/fixtures/${id}.png`, createdAt: d.createdAt, backgroundRemoval: { method: 'native-alpha', transparentFraction: .5, foregroundFraction: .48, edgeFraction: .02, quality: 'passed' } });
        layer.assetVersionId = id;
      }
      const cues = d.beats[0].subtitleCues.filter(cue => shot.subtitleCueIds.includes(cue.id));
      const result = await createVoxProductionRuntime(ops()).execute(d, buildVoxProductionNodes(d, settings, 'legacy').find(node => node.kind === 'animation' && node.shotId === shot.id)!);
      const animation = result.beats[0].shots[0].animation!;
      selected[styleId] = animation.template.id;
      expect(validateVoxAnimation(animation, result.assets), styleId).toEqual([]);
      expect(animation.template.props.subtitle).toBe(cues.map(cue => cue.text).join(' '));
    }
    expect(new Set(Object.values(selected)).size).toBeGreaterThan(1);
    expect(selected['caption-news']).toBe('evidence-headline');
    expect(selected.watercolor).toBe('paper-polaroids');
    expect(selected['city-symphony']).toBe('gallery-grid');
  });
  it('routes all 59 styles through image inputs, code direction and valid compatible fallbacks', async () => {
    const prompts = new Set<string>();
    for (const style of CREATIVE_STYLES) {
      const { d } = fixture();
      const settings = { ...voxProductionSettings(), narration: false, authoring: { mode: 'ai-code' as const, styleId: style.slug } };
      d.productionSettings = settings; d.productionRun!.settings = settings;
      expect(voxProductionInputErrors(d, settings), style.slug).toEqual([]);
      const shot = d.beats[0].shots[0];
      shot.scenePrompt = 'A leafy tree shading a city street in summer';
      shot.layers = shot.layers.map(layer => {
        if (layer.content) return layer;
        const id = `image-${layer.id}`;
        d.assets.push({ id, assetId: id, kind: 'image', localPath: `I:/fixtures/${id}.png`, createdAt: d.createdAt, backgroundRemoval: { method: 'native-alpha', transparentFraction: .5, foregroundFraction: .48, edgeFraction: .02, quality: 'passed' } });
        return { ...layer, assetVersionId: id, prompt: editorialLayerPrompt(layer.kind, shot.scenePrompt) };
      });
      for (const layer of shot.layers.filter(l => !l.content)) {
        const input = directorImageInput(d, shot.id, layer.id);
        expect(input.prompt, style.slug).toContain(style.adapter.imageDirection);
        expect(input.prompt).not.toContain('Editorial documentary collage environment.');
        expect(input.prompt).not.toContain('One isolated editorial photographic cutout');
        if (layer.kind === 'background') expect(input.prompt).not.toContain('paper texture and quiet');
        if (layer.kind === 'subject') expect(input.prompt).toContain('#00FF00');
        expect(directorImageInputMatches(d, input)).toBe(true);
        prompts.add(input.prompt);
      }
      const nodes = buildVoxProductionNodes(d, settings, 'legacy');
      const get = (kind: string) => ({ ...nodes.find(n => n.kind === kind && n.shotId === shot.id)!, requestId: `style-${kind}` });
      const generate = vi.fn(async () => validSource);
      const runtime = createVoxProductionRuntime(ops({ generateCode: generate }));
      let current = await runtime.execute(d, get('animation'));
      const animated = current.beats[0].shots[0];
      expect(validateVoxAnimation(animated.animation!, current.assets), style.slug).toEqual([]);
      expect(animated.animation!.template.props.background).toBe(style.adapter.background);
      expect(animated.cuePlan, style.slug).toBeDefined();
      expect(animated.animation?.creativeStyle?.styleId).toBe(style.slug);
      const scene = buildDirectorRenderScenes(current, undefined, { shotIds: [shot.id] })[0];
      expect(scene.semanticBeats, style.slug).toBeDefined();
      expect(scene.layers, style.slug).toHaveLength(animated.layers.length);
      expect(scene.animation!.template.id).toBe(animated.animation!.template.id);
      current = await runtime.execute(current, get('code'));
      const request = (generate.mock.calls[0] as unknown as [{ prompt: string }])[0];
      expect(request.prompt, style.slug).toContain(style.adapter.motionDirection);
      expect(current.beats[0].shots[0].animation?.authoring?.styleId).toBe(style.slug);
    }
    expect(prompts.size).toBeGreaterThanOrEqual(59);
  });
  it('keeps legacy/manual prompts, makes image cache style-sensitive and ignores code-only brief changes', () => {
    const { d, settings } = fixture(), shot = d.beats[0].shots[0], layer = shot.layers.find(l => l.kind === 'subject')!;
    delete d.productionRun;
    const legacy = directorImageInput(d, shot.id, layer.id);
    expect(legacy.prompt).toContain('editorial collage image');
    d.productionSettings = { ...settings, authoring: { mode: 'template', styleId: 'watercolor' } };
    const watercolor = directorImageInput(d, shot.id, layer.id);
    expect(watercolor.prompt).toContain('Transparent watercolour');
    d.productionSettings.authoring!.brief = '缓慢展开';
    d.productionSettings.authoring!.mode = 'ai-code';
    expect(directorImageInput(d, shot.id, layer.id)).toEqual(watercolor);
    // A completed previous run must not override newly saved settings.
    d.productionRun = { ...fixture().d.productionRun!, status: 'completed' };
    expect(directorImageInput(d, shot.id, layer.id)).toEqual(watercolor);
    d.productionSettings.authoring!.styleId = 'pixel-rpg';
    expect(directorImageInputMatches(d, watercolor)).toBe(false);
    layer.prompt = 'A single blue bicycle seen from the left, no rider';
    expect(directorImageInput(d, shot.id, layer.id).prompt).toContain(layer.prompt);
    delete d.productionSettings; delete d.productionRun;
    expect(directorImageInput(d, shot.id, layer.id).prompt).toContain(layer.prompt);
  });
  it('plans content independently of the selected material and reuses the plan hash', async () => {
    const { d } = fixture();
    const plan = vi.fn(async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: '树荫', scenePrompt: 'A tree shading a city street in summer' }))) }));
    const runtime = createVoxProductionRuntime(ops({ plan }));
    d.productionRun!.settings = { ...voxProductionSettings(), authoring: { mode: 'template', styleId: 'watercolor' } };
    const node = buildVoxProductionNodes(d, d.productionRun!.settings)[0];
    const before = runtime.input(d, node);
    await runtime.execute(d, node);
    expect((plan.mock.calls[0] as unknown as [string])[0]).not.toMatch(/paper collage|watercolour|watercolor/);
    d.productionRun!.settings.authoring!.styleId = 'glass-product';
    expect(runtime.input(d, node)).toEqual(before);
  });
});
describe('durable creative code pipeline', () => {
  it('uses cuts for generated code and fallback charts, while preserving explicit transitions and narration', async () => {
    const { d, node } = fixture(), runtime = createVoxProductionRuntime(ops());
    let current = await runtime.execute(await runtime.execute(d, node('animation')), node('code'));
    const shot = current.beats[0].shots[0];
    shot.animation!.authoring!.status = 'fallback';
    const original = buildDirectorRenderScenes(current, undefined, { shotIds: [shot.id] })[0];
    expect(original.transitionIn).toEqual({ type: 'cut', durationMs: 0 });
    const fingerprint = directorDocumentRenderFingerprint(current);
    shot.transitionIn = { type: 'dissolve', durationMs: 300 };
    const changed = buildDirectorRenderScenes(current, undefined, { shotIds: [shot.id] })[0];
    expect(changed.transitionIn).toEqual(shot.transitionIn);
    expect(changed.durationMs).toBe(original.durationMs);
    expect(changed.subtitleCues).toEqual(original.subtitleCues);
    expect(changed.audioClips).toEqual(original.audioClips);
    expect(directorDocumentRenderFingerprint(current)).not.toBe(fingerprint);
  });
  it('persists a bounded author brief and passes it to both creation and repair without changing narration', async () => {
    const { d, settings, node } = fixture();
    const brief = '大字开场，三个观点依次展开，避免快速闪烁。';
    const updated = voxProductionSettingsSchema.parse({ ...settings, authoring: { ...settings.authoring, brief } });
    expect(voxProductionSettingsSchema.safeParse({ ...updated, authoring: { ...updated.authoring, brief: 'x'.repeat(2001) } }).success).toBe(false);
    d.productionSettings = updated;
    d.productionRun!.settings = updated;
    const narration = structuredClone(d.beats.map(b => b.subtitleCues));
    const generate = vi.fn(async () => validSource);
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate, previewCode: async () => { throw new Error('CREATIVE_LAYOUT: overflow'); } }));
    let current = parseEditorialCollagePipelineData(d);
    expect(current.productionSettings?.authoring?.brief).toBe(brief);
    current = await runtime.execute(await runtime.execute(current, node('animation')), node('code'));
    current = await runtime.execute(current, node('code-review'));
    current = await runtime.execute(current, node('code-repair'));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls.every(args => (args as unknown as [{ prompt: string }])[0].prompt.includes(brief))).toBe(true);
    expect(current.beats.map(b => b.subtitleCues)).toEqual(narration);
  });
  it('preserves locked/manual shots and legacy settings', () => {
    const { d, settings } = fixture(), shot = d.beats[0].shots[0];
    expect(voxProductionSettings().authoring).toBeUndefined();
    expect(buildVoxProductionNodes(d, { ...settings, lockedShotIds: [shot.id] }, 'legacy').filter(n => n.shotId === shot.id).map(n => n.kind)).toEqual(['timing', 'animation', 'compile']);
    expect(buildVoxProductionNodes(d, { ...settings, lockedShotIds: [shot.id] }).filter(n => n.shotId === shot.id).map(n => n.kind)).toEqual(['compile']);
  });
  it('preserves a saved explicit dissolve even when it equals the legacy default', async () => {
    const { d, node } = fixture();
    d.beats[0].shots[0].transitionIn = { type: 'dissolve', durationMs: 200 };
    const current = await createVoxProductionRuntime(ops()).execute(d, node('animation'));
    expect(current.beats[0].shots[0].transitionIn).toEqual({ type: 'dissolve', durationMs: 200 });
  });
  it('checkpoints invalid returned source, repairs once, then falls back retaining both attempts', async () => {
    const { d, node } = fixture();
    const generate = vi.fn(async () => 'invalid source');
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate }));
    let current = await runtime.execute(d, node('animation'));
    current = await runtime.execute(current, node('code'));
    expect(current.beats[0].shots[0].animation?.authoring?.attempts[0]).toEqual({ requestId: 'request-code', source: 'invalid source' });
    current = parseEditorialCollagePipelineData(current);
    current = await runtime.execute(current, node('code-review'));
    expect(current.beats[0].shots[0].animation?.authoring?.status).toBe('needs-repair');
    current = await runtime.execute(current, node('code-repair'));
    current = await runtime.execute(current, node('code-finalize'));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(current.beats[0].shots[0].animation).toMatchObject({ mode: 'template', authoring: { status: 'fallback', attempts: [{ requestId: 'request-code' }, { requestId: 'request-code-repair' }] } });
  });
  it('repairs explicit layout errors, but pauses infrastructure failures without spending on repair', async () => {
    const { d, node } = fixture();
    const preview = vi.fn().mockRejectedValueOnce(new Error('CREATIVE_LAYOUT: overflow')).mockResolvedValue(['a', 'b', 'c']);
    const generate = vi.fn(async () => validSource);
    const runtime = createVoxProductionRuntime(ops({ previewCode: preview, generateCode: generate }));
    let current = await runtime.execute(await runtime.execute(d, node('animation')), node('code'));
    current = await runtime.execute(current, node('code-review'));
    current = await runtime.execute(current, node('code-repair'));
    current = await runtime.execute(current, node('code-finalize'));
    expect(current.beats[0].shots[0].animation).toMatchObject({ mode: 'code', authoring: { status: 'reviewed' } });
    preview.mockRejectedValue(new Error('ENOENT runtime missing'));
    await expect(runtime.execute(current, node('code-review'))).rejects.toThrow('ENOENT');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('runs the same bounded repair for unsupported factual annotations', async () => {
    const { d, node } = fixture();
    const runtime = createVoxProductionRuntime(ops({ previewCode: async () => { throw new Error('CREATIVE_CONTENT: 历史最高记录'); } }));
    const generated = await runtime.execute(await runtime.execute(d, node('animation')), node('code'));
    expect((await runtime.execute(generated, node('code-review'))).beats[0].shots[0].animation?.authoring?.status).toBe('needs-repair');
  });
  it('does not buy a third attempt when a later review rejects already repaired code', async () => {
    const { d, node } = fixture(), generate = vi.fn(async () => validSource);
    const preview = vi.fn().mockRejectedValueOnce(new Error('CREATIVE_LAYOUT: overflow')).mockResolvedValueOnce(['a.jpg']);
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate, previewCode: preview }));
    let current = await runtime.execute(await runtime.execute(d, node('animation')), node('code'));
    current = await runtime.execute(current, node('code-review'));
    current = await runtime.execute(current, node('code-repair'));
    current = await runtime.execute(current, node('code-finalize'));
    expect(current.beats[0].shots[0].animation?.authoring?.status).toBe('reviewed');
    preview.mockRejectedValue(new Error('CREATIVE_CONTENT: 历史最高记录'));
    current = await runtime.execute(current, node('code-review'));
    expect(runtime.isPaid?.(current, node('code-repair'))).toBe(false);
    current = await runtime.execute(current, node('code-repair'));
    current = parseEditorialCollagePipelineData(await runtime.execute(current, node('code-finalize')));
    expect(generate).toHaveBeenCalledTimes(2);
    expect(current.beats[0].shots[0].animation).toMatchObject({ mode: 'template', authoring: { status: 'fallback' } });
    expect(current.beats[0].shots[0].animation?.authoring?.attempts).toHaveLength(2);
  });
  it('skips paid repair after successful preview and protects manual code', async () => {
    const { d, settings, node } = fixture(), generate = vi.fn(async () => validSource);
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate }));
    let current = await runtime.execute(await runtime.execute(d, node('animation')), node('code'));
    current = await runtime.execute(current, node('code-review'));
    expect(runtime.isPaid?.(current, node('code-repair'))).toBe(false);
    current = await runtime.execute(current, node('code-repair'));
    expect(generate).toHaveBeenCalledOnce();
    delete current.beats[0].shots[0].animation!.authoring;
    expect(voxProductionInputErrors(current, settings).join()).toContain('请先锁定');
  });
  it('reuses native runtime hashes after review and preserves unknown paid requests', async () => {
    const { d, settings } = fixture(); delete d.productionRun;
    const generateFilm = vi.fn(async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs));
    const planFilm = vi.fn(async () => ({ treatment: '以数据和来源作为叙事核心，在连续画面中先呈现道路蓄热，再移动至树荫覆盖的街道，构图与文字采用所选风格的原生表达。', fps: 24 }));
    const h = nativeHarness({ generateFilm, planFilm }, d);
    await h.start(settings); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    await h.start(settings); await h.idle();
    expect(generateFilm).toHaveBeenCalledOnce(); expect(planFilm).toHaveBeenCalledOnce();
    expect(h.get().productionRun!.nodes.filter(n => n.kind === 'film-repair').every(n => !n.paid)).toBe(true);
    generateFilm.mockRejectedValue(new Error('network closed after submit'));
    await h.start({ ...settings, authoring: { ...settings.authoring, brief: '采用一次连续横移的镜头' } }); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.status === 'unknown')?.kind).toBe('film-code');
    await expect(h.service.control({ id: d.id, runId: h.get().productionRun!.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
  });
  it('creates a native treatment when switching from legacy, then reuses only matching native inputs', async () => {
    const { d, settings: initialSettings } = fixture(); delete d.productionRun;
    const settings = { ...initialSettings, generateImages: false };
    const plan = vi.fn(async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: '数据', scenePrompt: 'Compare the documented source data using clear chart labels' }))) }));
    const planFilm = vi.fn(async () => ({ treatment: '将文案中的街道热量与树荫降温组织成完整连续的论述，保留真实数据和来源，并以所选风格独立决定全片文字、构图和运动。', fps: 24 }));
    const generateFilm = vi.fn(async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs));
    const h = nativeHarness({ plan, planFilm, generateFilm }, d);
    const { authoring: _authoring, ...legacy } = settings;
    await h.start(legacy); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const planRequest = h.get().productionRun!.nodes[0].requestId;
    await h.start(settings); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    expect(h.get().productionRun!.nodes[0].requestId).not.toBe(planRequest);
    expect(plan).toHaveBeenCalledOnce(); expect(planFilm).toHaveBeenCalledOnce(); expect(generateFilm).toHaveBeenCalledOnce();
    await h.start(settings); await h.idle();
    expect(planFilm).toHaveBeenCalledOnce(); expect(generateFilm).toHaveBeenCalledOnce();
    const otherSettings = { ...settings, authoring: { mode: 'ai-code' as const, styleId: 'swiss-motion' } };
    await h.start(otherSettings); await h.idle();
    expect(plan).toHaveBeenCalledOnce(); expect(planFilm).toHaveBeenCalledTimes(2); expect(generateFilm).toHaveBeenCalledTimes(2);
    const withBrief = { ...otherSettings, authoring: { ...otherSettings.authoring, brief: '大字开场，克制推进。' } };
    await h.start(withBrief); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    expect(h.get().productionSettings?.authoring?.brief).toBe(withBrief.authoring.brief);
    expect(plan).toHaveBeenCalledOnce(); expect(planFilm).toHaveBeenCalledTimes(3); expect(generateFilm).toHaveBeenCalledTimes(3);
  });
  it('awaits failed reference preflight before writing a paid claim', async () => {
    const { d, settings } = fixture(); delete d.productionRun;
    const save = vi.fn(async value => value), generate = vi.fn();
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate, preflight: async () => { throw new Error('CREATIVE_REFERENCE_INTEGRITY'); } }));
    const service = new VoxProductionService({ load: async () => structuredClone(d), save, projects: async () => [d.id] }, async () => runtime);
    await expect(service.start({ id: d.id, expectedUpdatedAt: d.updatedAt, settings })).rejects.toThrow('INTEGRITY');
    expect(save).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
});

describe('HyperFrames semantic authoring', () => {
  it('repairs malformed templates using narrative meaning and keeps valid author choices', () => {
    const scene = (narration: string, count: number, sceneTemplate = 'missing') => ({ index: 1, title: '', narration, captions: [narration], sceneTemplate, background: { prompt: '空间' }, elements: Array.from({ length: count }, (_, slot) => ({ slot, prompt: '物体' })) });
    const plans = repairHtmlVideoPlanningSlots([scene('过去与现在，街道发生了变化', 2), scene('沿着三个地点依次前进', 3), scene('围绕核心连接两侧关系', 3), scene('记录清楚显示了证据', 1), scene('保留作者选择', 1, 'person-focus')], true);
    expect(plans.map(p => p.sceneTemplate)).toEqual(['before-after-wipe', 'spatial-pan-stations', 'constellation-hub', 'news-focus', 'person-focus']);
    expect(plans[0].beats?.[0].purpose).toBe('compare');
    expect(buildHtmlVideoPlanningSystemPrompt({ ratio: '16:9' })).toContain('HyperFrames 0.8.40');
  });
});
