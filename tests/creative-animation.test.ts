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
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
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
import { assembleCreativeShot } from '../src/shared/creative-animation/assemble';
import { LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { lemoProductionContext } from '../electron/lemo-upstream-production';
import { defaultLemoProductionBudget } from '../src/shared/lemo-production-budget';
import { nativeHarness } from './lemo-native.fixture';
import { readyOfficialDocument } from './creative-official.fixture';

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
  it('assembles and compiles all retained styles without image placeholders while blocking retired authoring', async () => {
    for (const style of CREATIVE_STYLES) {
      const { d } = fixture(), shot = d.beats[0].shots[0];
      const settings = { ...voxProductionSettings(), generateImages: false, narration: false, authoring: { mode: 'ai-code' as const, styleId: style.slug } };
      d.productionRun!.settings = settings;
      const nodes = buildVoxProductionNodes(d, settings, 'legacy');
      const generateCode = vi.fn(async () => validSource);
      const runtime = createVoxProductionRuntime(ops({ generateCode }));
      const before = structuredClone(d);
      for (const kind of ['animation', 'code', 'code-review', 'code-finalize', 'compile']) {
        await expect(runtime.execute(d, { ...nodes.find(node => node.kind === kind && node.shotId === shot.id)!, requestId: `no-image-${kind}` })).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
      }
      expect(generateCode).not.toHaveBeenCalled(); expect(d).toEqual(before);
      const current = structuredClone(d);
      current.beats[0].shots[0] = assembleCreativeShot(current, current.beats[0].shots[0], settings);
      const result = current.beats[0].shots[0];
      result.animation!.mode = 'code';
      result.animation!.code = { ...result.animation!.code, ...compileVoxCode(validSource) };
      expect(result.animation!.mode, style.slug).toBe('code');
      expect(validateVoxAnimation(result.animation!, current.assets), style.slug).toEqual([]);
      expect(result.animation!.template.props.assetIds, style.slug).toEqual([]);
      expect(result.cuePlan, style.slug).toBeUndefined();
      expect(buildVoxProductionNodes({ ...d, productionRun: undefined }, settings).some(n => n.kind === 'image')).toBe(false);
      expect(lemoProductionContext(current).styleId).toBe(style.slug);
      expect(await loadCreativeStyleReference(root, style.slug)).toContain(style.adapter.motionDirection);
      const scene = buildDirectorRenderScenes(rebuildEditorialTimeline(current), undefined, { shotIds: [shot.id] })[0];
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
  it('routes all 59 styles through image inputs, official direction and retained compatible templates', async () => {
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
      await expect(runtime.execute(d, get('animation'))).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
      await expect(runtime.execute(d, get('code'))).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
      expect(generate).not.toHaveBeenCalled();
      const current = structuredClone(d);
      current.beats[0].shots[0] = assembleCreativeShot(current, current.beats[0].shots[0], settings);
      const animated = current.beats[0].shots[0];
      expect(validateVoxAnimation(animated.animation!, current.assets), style.slug).toEqual([]);
      expect(animated.animation!.template.props.background).toBe(style.adapter.background);
      expect(animated.cuePlan, style.slug).toBeDefined();
      expect(animated.animation?.creativeStyle?.styleId).toBe(style.slug);
      const scene = buildDirectorRenderScenes(rebuildEditorialTimeline(current), undefined, { shotIds: [shot.id] })[0];
      expect(scene.semanticBeats, style.slug).toBeDefined();
      expect(scene.layers, style.slug).toHaveLength(animated.layers.length);
      expect(scene.animation!.template.id).toBe(animated.animation!.template.id);
      expect(await loadCreativeStyleReference(root, style.slug), style.slug).toContain(style.adapter.motionDirection);
      expect(lemoProductionContext(current).styleId).toBe(style.slug);
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
function archivedCode(status: 'generated' | 'needs-repair' | 'reviewed' | 'fallback' = 'generated', sources = [validSource]) {
  const value = fixture(), shot = value.d.beats[0].shots[0];
  value.d.beats[0].shots[0] = assembleCreativeShot(value.d, shot, value.settings);
  const animation = value.d.beats[0].shots[0].animation!;
  animation.mode = status === 'fallback' ? 'template' : 'code';
  animation.code = { ...animation.code, source: sources.at(-1)!, ...(sources.at(-1) === validSource ? compileVoxCode(validSource) : {}) };
  animation.authoring = { owner: 'creative-production', revision: 1, styleId: 'dataviz', upstreamRevision: LEMO_REVISION, status,
    attempts: sources.map((source, index) => ({ requestId: index ? 'request-code-repair' : 'request-code', source })) };
  value.d = parseEditorialCollagePipelineData(value.d);
  return value;
}
function officialHarness(initial = (() => { const { d } = fixture(); delete d.productionRun; return d; })()) {
  const generateCode = vi.fn(), generateFilm = vi.fn(), planFilm = vi.fn(), authorFilmFile = vi.fn();
  const officialStep = vi.fn<NonNullable<VoxProductionOperations['officialStep']>>(async (d, node) =>
    node.id === 'official-authoring' || node.id.startsWith('official-repair:') ? readyOfficialDocument(d) : d);
  const recoverOfficialStep = vi.fn<NonNullable<VoxProductionOperations['recoverOfficialStep']>>(async () => undefined);
  const h = nativeHarness({ officialStep, recoverOfficialStep, generateCode, generateFilm, planFilm, authorFilmFile }, initial);
  return { ...h, officialStep, recoverOfficialStep, retired: [generateCode, generateFilm, planFilm, authorFilmFile] };
}

describe('durable creative code pipeline', () => {
  it('uses cuts for retained code and fallback charts, while preserving explicit transitions and narration', () => {
    for (const state of ['generated', 'fallback'] as const) {
      const { d: current } = archivedCode(state), shot = current.beats[0].shots[0];
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
    }
  });
  it('persists a bounded author brief in official creation and repair without changing narration', async () => {
    const { settings } = fixture(), h = officialHarness();
    const brief = '大字开场，三个观点依次展开，避免快速闪烁。';
    const updated = voxProductionSettingsSchema.parse({ ...settings, authoring: { ...settings.authoring, brief },
      lemoBudget: { ...defaultLemoProductionBudget(), maxRepairRounds: 1 } });
    expect(voxProductionSettingsSchema.safeParse({ ...updated, authoring: { ...updated.authoring, brief: 'x'.repeat(2001) } }).success).toBe(false);
    const narration = structuredClone(h.get().beats.map(b => b.subtitleCues));
    await h.start(updated); await h.idle();
    const first = h.get(); expect(first.productionRun?.status, first.productionRun?.message).toBe('completed');
    const instructions = '修复构图溢出，保留大字开场和原有旁白。';
    await h.service.control({ id: first.id, runId: first.productionRun!.id, action: 'repair-shot', shotId: first.beats[0].shots[0].id, instructions }); await h.idle();
    const current = parseEditorialCollagePipelineData(h.get());
    expect(current.productionRun?.status, current.productionRun?.message).toBe('completed');
    expect(current.productionSettings?.authoring?.brief).toBe(brief);
    const authored = h.officialStep.mock.calls.filter(([, n]) => n.id === 'official-authoring' || n.id.startsWith('official-repair:'));
    expect(authored).toHaveLength(2);
    expect(authored.every(([d]) => lemoProductionContext(d).brief.includes(brief))).toBe(true);
    expect(authored[1][1].repairInstructions).toBe(instructions);
    expect(current.beats.map(b => b.subtitleCues)).toEqual(narration);
    for (const callback of h.retired) expect(callback).not.toHaveBeenCalled();
  });
  it('preserves locked/manual shots and legacy template settings', () => {
    const { d, settings } = fixture(), shot = d.beats[0].shots[0];
    expect(voxProductionSettings().authoring).toBeUndefined();
    expect(buildVoxProductionNodes(d, { ...settings, lockedShotIds: [shot.id] }, 'legacy').filter(n => n.shotId === shot.id).map(n => n.kind)).toEqual(['timing', 'animation', 'compile']);
    const nodes = buildVoxProductionNodes(d, { ...settings, lockedShotIds: [shot.id] });
    expect(nodes.filter(n => n.shotId === shot.id).map(n => n.kind)).toEqual(['timing']);
    expect(nodes.filter(n => n.shotId === shot.id).every(n => !n.paid)).toBe(true);
  });
  it('preserves a saved explicit dissolve even when it equals the legacy default', () => {
    const { d, settings } = fixture(), shot = d.beats[0].shots[0];
    shot.transitionIn = { type: 'dissolve', durationMs: 200 };
    expect(assembleCreativeShot(d, shot, settings).transitionIn).toEqual({ type: 'dissolve', durationMs: 200 });
  });
  it('retains invalid source and both historical attempts while rejecting retired repair and fallback execution', async () => {
    const { d, node } = archivedCode('fallback', ['invalid source', 'invalid repaired source']);
    const generate = vi.fn(), preview = vi.fn(), runtime = createVoxProductionRuntime(ops({ generateCode: generate, previewCode: preview }));
    const before = structuredClone(d);
    expect(() => compileVoxCode(d.beats[0].shots[0].animation!.authoring!.attempts[0].source)).toThrow();
    for (const kind of ['animation', 'code', 'code-review', 'code-repair', 'code-finalize', 'compile']) {
      await expect(runtime.execute(d, node(kind))).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    }
    expect(parseEditorialCollagePipelineData(d)).toEqual(before);
    expect(d.beats[0].shots[0].animation).toMatchObject({ mode: 'template', authoring: { status: 'fallback',
      attempts: [{ requestId: 'request-code', source: 'invalid source' }, { requestId: 'request-code-repair', source: 'invalid repaired source' }] } });
    expect(generate).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  });
  it('repairs an explicitly selected official layout and blocks another purchase after infrastructure uncertainty', async () => {
    const { settings } = fixture(), h = officialHarness();
    await h.start(settings); await h.idle(); const first = h.get();
    const request = { id: first.id, runId: first.productionRun!.id, action: 'repair-shot' as const, shotId: first.beats[0].shots[0].id, instructions: 'CREATIVE_LAYOUT: fix the text overflow in this shot.' };
    await h.service.control(request); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed');
    const successful = h.get().productionRun!.nodes.filter(n => n.status === 'completed' && n.paid).map(n => n.requestId);
    h.officialStep.mockImplementation(async (d, n) => { if (n.id.startsWith('official-repair:')) throw new Error('ENOENT runtime missing'); return d; });
    await h.service.control(request); await h.idle();
    const unknown = h.get().productionRun!.nodes.find(n => n.status === 'unknown')!;
    expect(unknown.error).toContain('ENOENT'); expect(unknown.id).toMatch(/^official-repair:/);
    const count = h.officialStep.mock.calls.length;
    await expect(h.service.control({ ...request, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    await expect(h.service.control(request)).rejects.toThrow('LEMO_REPAIR_PENDING');
    expect(h.officialStep).toHaveBeenCalledTimes(count);
    expect(successful.every(id => h.get().productionRun!.nodes.some(n => n.requestId === id && n.status === 'completed'))).toBe(true);
    for (const callback of h.retired) expect(callback).not.toHaveBeenCalled();
  });
  it('retains unsupported factual diagnostics without reopening the retired paid repair loop', async () => {
    const { d, node } = archivedCode('needs-repair');
    d.beats[0].shots[0].animation!.authoring!.error = 'CREATIVE_CONTENT: 历史最高记录';
    const generate = vi.fn(), preview = vi.fn(), runtime = createVoxProductionRuntime(ops({ generateCode: generate, previewCode: preview }));
    expect(creativeUnsupportedClaims('历史最高记录', d.sourceText ?? '')).toEqual(['历史最高记录']);
    const before = structuredClone(d);
    for (const kind of ['code-review', 'code-repair', 'code-finalize']) await expect(runtime.execute(d, node(kind))).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(d).toEqual(before); expect(d.beats[0].shots[0].animation?.authoring?.status).toBe('needs-repair');
    expect(generate).not.toHaveBeenCalled(); expect(preview).not.toHaveBeenCalled();
  });
  it('does not buy a second official repair after exhausting the shared run allowance', async () => {
    const { settings } = fixture(), h = officialHarness();
    await h.start({ ...settings, lemoBudget: { ...defaultLemoProductionBudget(), maxRepairRounds: 1 } }); await h.idle();
    const first = h.get(), originalNodes = first.productionRun!.nodes.filter(n => !['official-ready', 'render', 'verify'].includes(n.id));
    const request = { id: first.id, runId: first.productionRun!.id, action: 'repair-shot' as const, shotId: first.beats[0].shots[0].id, instructions: 'Repair the selected layout without altering the narration.' };
    await h.service.control(request); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed');
    const after = h.get();
    expect(after.productionRun!.nodes.filter(n => originalNodes.some(old => old.id === n.id))).toEqual(originalNodes);
    expect(h.officialStep).toHaveBeenCalledTimes(5);
    await expect(h.service.control(request)).rejects.toThrow('LEMO_REPAIR_BUDGET_EXHAUSTED');
    expect(h.officialStep).toHaveBeenCalledTimes(5); expect(h.get()).toEqual(after);
    expect(after.productionRun!.nodes.filter(n => n.id.startsWith('official-repair:'))).toHaveLength(1);
    for (const callback of h.retired) expect(callback).not.toHaveBeenCalled();
  });
  it('skips unrequested paid repair after successful official review and protects manual code', async () => {
    const { settings } = fixture(), h = officialHarness();
    await h.start(settings); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed');
    expect(h.officialStep.mock.calls.map(([, n]) => n.id)).toEqual(['official-treatment', 'official-style-frame', 'official-voice-lock', 'official-authoring']);
    expect(h.get().productionRun!.nodes.some(n => n.id.startsWith('official-repair:'))).toBe(false);
    const { d, node } = archivedCode('reviewed');
    delete d.beats[0].shots[0].animation!.authoring;
    expect(voxProductionInputErrors(d, settings).join()).toContain('请先锁定');
    const generate = vi.fn(), runtime = createVoxProductionRuntime(ops({ generateCode: generate }));
    await expect(runtime.execute(d, node('code-repair'))).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(generate).not.toHaveBeenCalled();
  });
  it('keeps official input hashes stable after review and preserves unknown paid requests', async () => {
    const { settings } = fixture(), h = officialHarness();
    await h.start(settings); await h.idle(); const first = h.get();
    expect(first.productionRun?.status, first.productionRun?.message).toBe('completed');
    const authoring = first.productionRun!.nodes.find(n => n.id === 'official-authoring')!;
    const input = h.runtime.input(first, authoring);
    first.upstreamFilm!.message = 'A later progress update';
    expect(h.runtime.input(first, authoring)).toEqual(input);
    await h.start(settings); await h.idle();
    expect(h.get().productionRun?.status).toBe('completed');
    expect(h.get().productionRun!.id).not.toBe(first.productionRun!.id);
    expect(h.officialStep).toHaveBeenCalledTimes(8);
    h.officialStep.mockImplementation(async (d, n) => { if (n.id === 'official-authoring') throw new Error('network closed after submit'); return d; });
    await h.start({ ...settings, authoring: { ...settings.authoring, brief: '采用一次连续横移的镜头' } }); await h.idle();
    const unknown = h.get().productionRun!.nodes.find(n => n.status === 'unknown')!;
    expect(unknown.id).toBe('official-authoring'); expect(unknown.requestId).toBeTruthy();
    await expect(h.service.control({ id: first.id, runId: h.get().productionRun!.id, action: 'resume' })).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    await h.service.control({ id: first.id, runId: h.get().productionRun!.id, action: 'reconcile' });
    expect(h.get().productionRun!.nodes.find(n => n.id === unknown.id)).toMatchObject({ status: 'unknown', requestId: unknown.requestId });
    expect(h.officialStep).toHaveBeenCalledTimes(12);
    for (const callback of h.retired) expect(callback).not.toHaveBeenCalled();
  });
  it('creates official treatment after template production and reruns it for each new style or brief', async () => {
    const { d, settings: initialSettings } = fixture(); delete d.productionRun;
    const settings = { ...initialSettings, generateImages: false };
    const plan = vi.fn(async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: '数据', scenePrompt: 'Compare the documented source data using clear chart labels' }))) }));
    const officialStep = vi.fn<NonNullable<VoxProductionOperations['officialStep']>>(async (document, n) => n.id === 'official-authoring' ? readyOfficialDocument(document) : document);
    const planFilm = vi.fn(), generateFilm = vi.fn();
    const h = nativeHarness({ plan, planFilm, generateFilm, officialStep, recoverOfficialStep: async () => undefined }, d);
    const { authoring: _authoring, ...legacy } = settings;
    await h.start(legacy); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const planRequest = h.get().productionRun!.nodes[0].requestId;
    const otherSettings = { ...settings, authoring: { mode: 'ai-code' as const, styleId: 'swiss-motion' } };
    const withBrief = { ...otherSettings, authoring: { ...otherSettings.authoring, brief: '大字开场，克制推进。' } };
    const runIds = new Set<string>();
    for (const [index, selected] of [settings, settings, otherSettings, withBrief].entries()) {
      await h.start(selected); await h.idle(); const current = h.get();
      expect(current.productionRun?.status, current.productionRun?.message).toBe('completed');
      expect(current.productionRun!.nodes[0]).toMatchObject({ id: 'official-treatment', status: 'completed' });
      expect(current.productionRun!.nodes[0].requestId).not.toBe(planRequest);
      expect(current.productionRun!.engine).toBe(LEMO_NATIVE_ENGINE);
      expect(current.productionRun!.authoringVersion).toBe(4);
      runIds.add(current.productionRun!.id);
      expect(officialStep).toHaveBeenCalledTimes((index + 1) * 4);
      expect(current.productionSettings?.authoring).toEqual(selected.authoring);
    }
    expect(runIds.size).toBe(4); expect(plan).toHaveBeenCalledOnce();
    expect(planFilm).not.toHaveBeenCalled(); expect(generateFilm).not.toHaveBeenCalled();
  });
  it('awaits failed reference preflight before writing a paid claim', async () => {
    const { d, settings } = fixture(); delete d.productionRun;
    const save = vi.fn(async value => value), generate = vi.fn(), officialStep = vi.fn(), recoverOfficialStep = vi.fn();
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate, officialStep, recoverOfficialStep, preflight: async () => { throw new Error('CREATIVE_REFERENCE_INTEGRITY'); } }));
    const service = new VoxProductionService({ load: async () => structuredClone(d), save, projects: async () => [d.id] }, async () => runtime);
    await expect(service.start({ id: d.id, expectedUpdatedAt: d.updatedAt, settings })).rejects.toThrow('INTEGRITY');
    expect(save).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
    expect(officialStep).not.toHaveBeenCalled(); expect(recoverOfficialStep).not.toHaveBeenCalled();
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
