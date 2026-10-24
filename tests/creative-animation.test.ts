import { createHash } from 'node:crypto';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { CREATIVE_STYLES, resolveCreativeStyle, LEMO_REVISION } from '../src/shared/creative-animation/styles';
import { loadCreativeStyleReference } from '../electron/creative-style-references';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan, parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, voxProductionSettings, voxProductionInputErrors } from '../src/shared/vox-production';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { VoxProductionService } from '../electron/vox-production-service';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { creativeUnsupportedClaims, creativeMinimumFontSize, creativeBackgroundMatches } from '../src/shared/creative-animation/review';
import { buildDirectorRenderScenes, directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { repairHtmlVideoPlanningSlots, buildHtmlVideoPlanningSystemPrompt } from '../src/shared/task-runtime-providers';

const root = resolve('vendor/lemo-opuscar');
describe('creative code property validation', () => {
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
  });
  it('accepts CSS and typed property names without treating them as global reads', () => {
    expect(compileVoxCode('import React from "react"; type Props={top:number}; export default function Scene(props:Props){const {top:offset}=props;return <div style={{position:"absolute",top:props.top+offset}}>数据</div>}').compiled).toContain('top: props.top + offset');
  });
  it.each(['top.location', 'window.top', '({top})', '({[top]:1})', '({top:top})'])('still rejects global access: %s', expression => {
    expect(() => compileVoxCode(`import React from "react"; export default function Scene(){const value=${expression};return <div/>}`)).toThrow('不能访问');
  });
});
describe('pinned creative style references', () => {
  it('imports all 59 text styles with verified provenance and no demo media', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    expect(manifest.revision).toBe(LEMO_REVISION);
    expect(CREATIVE_STYLES).toHaveLength(59);
    expect(new Set(CREATIVE_STYLES.map(s => s.slug)).size).toBe(59);
    expect(CREATIVE_STYLES.filter(s => s.adapter)).toHaveLength(6);
    for (const file of manifest.files) {
      expect(file.path).toMatch(/\.(md|json)$|^LICENSE$/);
      expect(createHash('sha256').update(await readFile(join(root, file.path))).digest('hex')).toBe(file.sha256);
    }
    expect(resolveCreativeStyle('auto', 'data-map')?.slug).toBe('dataviz');
    expect(resolveCreativeStyle('auto', 'archival-story')?.slug).toBe('archive-lighttable');
    const reference = await loadCreativeStyleReference(root, 'halftone-dossier');
    expect(reference).toContain('<director-reference>');
    expect(reference).toContain('<technique-reference>');
    await expect(loadCreativeStyleReference(root, '../README')).rejects.toThrow('UNADAPTED');
    await expect(loadCreativeStyleReference(root, CREATIVE_STYLES.find(s => !s.adapter)!.slug)).rejects.toThrow('UNADAPTED');
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
  const nodes = buildVoxProductionNodes(d, settings);
  d.productionRun = { version: 1, id: 'r', settings, status: 'running', sourceHash: '', runtimeIdentity: '', nodes, createdAt: d.createdAt, updatedAt: d.updatedAt };
  const node = (kind: string) => ({ ...nodes.find(n => n.kind === kind && n.shotId === d.beats[0].shots[0].id)!, requestId: `request-${kind}` });
  return { d, settings, node };
}
const validSource = 'import React from "react"; export default function Scene(){return <div>真实数据</div>}';
function ops(overrides: Partial<VoxProductionOperations> = {}): VoxProductionOperations {
  const never = async (): Promise<never> => { throw new Error('unexpected paid call'); };
  return { identity: 'test', imageModel: 'test', voiceModel: 'test', voice: { provider: 'volcengine', voiceId: 'test', voiceLabel: 'test', speed: 1 }, preflight() {}, plan: never, image: never, speech: never, cutout: never, render: async d => d, verifyVideo: async () => {}, compileCode: compileVoxCode, generateCode: async () => validSource, previewCode: async () => ['a.jpg', 'b.jpg', 'c.jpg'], ...overrides };
}
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
  it('preserves locked/manual shots and legacy settings', () => {
    const { d, settings } = fixture(), shot = d.beats[0].shots[0];
    expect(voxProductionSettings().authoring).toBeUndefined();
    expect(buildVoxProductionNodes(d, { ...settings, lockedShotIds: [shot.id] }).filter(n => n.shotId === shot.id).map(n => n.kind)).toEqual(['timing', 'animation', 'compile']);
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
  it('reuses actual runtime hashes after review and preserves unknown paid requests', async () => {
    const { d, settings } = fixture(); delete d.productionRun;
    let saved = d, clock = Date.now();
    const generate = vi.fn(async () => validSource), plan = vi.fn(async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: s.title || '标题', scenePrompt: s.scenePrompt || '清晰呈现对应的真实数据和来源' }))) }));
    const runtime = createVoxProductionRuntime(ops({ generateCode: generate, plan }));
    // This test exercises durable code claims and hashes; media gates have their own fixtures.
    const execute = runtime.execute;
    runtime.execute = (document, node) => ['render', 'verify'].includes(node.kind) ? Promise.resolve(document) : execute(document, node);
    const service = new VoxProductionService({ load: async () => structuredClone(saved), save: async value => { saved = { ...value, updatedAt: new Date(++clock).toISOString() }; return saved; }, projects: async () => [d.id] }, async () => runtime);
    await service.start({ id: d.id, expectedUpdatedAt: saved.updatedAt, settings }); await service.idle(d.id);
    expect(saved.productionRun?.status, saved.productionRun?.nodes.find(n => n.status === 'failed')?.error).toBe('completed');
    const count = generate.mock.calls.length;
    await service.start({ id: d.id, expectedUpdatedAt: saved.updatedAt, settings }); await service.idle(d.id);
    expect(generate).toHaveBeenCalledTimes(count); expect(plan).toHaveBeenCalledOnce();
    expect(saved.productionRun!.nodes.filter(n => n.kind === 'code-repair').every(n => !n.paid)).toBe(true);
    generate.mockRejectedValue(new Error('network closed after submit'));
    saved.beats[0].shots[0].scenePrompt += ' changed';
    await service.start({ id: d.id, expectedUpdatedAt: saved.updatedAt, settings }); await service.idle(d.id);
    expect(saved.productionRun?.nodes.find(n => n.status === 'unknown')?.kind).toBe('code');
    await expect(service.control({ id: d.id, runId: saved.productionRun!.id, action: 'resume' })).rejects.toThrow('UNKNOWN');
  });
  it('switches template output to AI code without charging for the approved plan again', async () => {
    const { d, settings } = fixture(); delete d.productionRun;
    let saved = d, clock = Date.now();
    const plan = vi.fn(async () => ({ shots: d.beats.flatMap(b => b.shots.map(s => ({ id: s.id, title: '数据', scenePrompt: 'Compare the documented source data using clear chart labels' }))) }));
    const generate = vi.fn(async () => validSource);
    const runtime = createVoxProductionRuntime(ops({ plan, generateCode: generate }));
    const execute = runtime.execute;
    runtime.execute = (document, node) => ['render', 'verify'].includes(node.kind) ? Promise.resolve(document) : execute(document, node);
    const service = new VoxProductionService({ load: async () => structuredClone(saved), save: async value => { saved = { ...value, updatedAt: new Date(++clock).toISOString() }; return saved; }, projects: async () => [d.id] }, async () => runtime);
    const { authoring: _authoring, ...legacy } = settings;
    await service.start({ id: d.id, expectedUpdatedAt: saved.updatedAt, settings: legacy }); await service.idle(d.id);
    const planRequest = saved.productionRun!.nodes[0].requestId;
    await service.start({ id: d.id, expectedUpdatedAt: saved.updatedAt, settings }); await service.idle(d.id);
    expect(saved.productionRun?.status).toBe('completed');
    expect(plan).toHaveBeenCalledOnce();
    expect(saved.productionRun!.nodes[0].requestId).toBe(planRequest);
    expect(generate).toHaveBeenCalledTimes(d.beats.flatMap(b => b.shots).length);
    const otherSettings = { ...settings, authoring: { mode: 'ai-code' as const, styleId: 'swiss-motion' } };
    await service.start({ id: d.id, expectedUpdatedAt: saved.updatedAt, settings: otherSettings }); await service.idle(d.id);
    expect(plan).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledTimes(d.beats.flatMap(b => b.shots).length * 2);
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
