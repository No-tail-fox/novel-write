import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { assembleLemoProject, lemoProjectFiles, type LemoProject } from '../src/shared/creative-animation/native-project';
import { validateLemoFile, lemoTruncationDiagnostic } from '../electron/lemo-project-runtime';
import { LEMO_FILE_MAX_TOKENS, LEMO_NATIVE_ENGINE } from '../src/shared/creative-animation/native-film';
import { compileLemoNative } from '../electron/lemo-native-compiler';
import { buildVoxProductionNodes } from '../src/shared/vox-production';
import { voxInputHash } from '../electron/vox-production-service';

// Retained project utilities remain independently testable. Production only accepts official v4.
describe('retained multi-file project utilities', () => {
  it('reserves code headroom after reasoning and reports the exhausted token budget', () => {
    expect(LEMO_FILE_MAX_TOKENS - 11521).toBeGreaterThan(12000);
    const diagnostic = lemoTruncationDiagnostic({ text: 'const palette = {', raw: '', requestId: 'budget', finishReason: 'length',
      usage: { completion_tokens: 12000, completion_tokens_details: { reasoning_tokens: 11521, text_tokens: 479 } } });
    expect(diagnostic).toContain('12000'); expect(diagnostic).toContain('11521'); expect(diagnostic).toContain('479');
    expect(diagnostic).toContain('增加输出预算');
  });
  it('groups only editable windows and preserves their original order', () => {
    const ids = Array.from({ length: 17 }, (_, i) => 'window-' + i), locked = new Set(ids.slice(0, 8));
    const files = lemoProjectFiles(ids.filter(id => !locked.has(id)));
    expect(files.map(f => f.id)).toEqual(['shared', 'scene-1', 'scene-2', 'director']);
    expect(files[1].shotIds).toEqual(ids.slice(8, 16)); expect(files[2].shotIds).toEqual(['window-16']);
  });
  it('bounds scene groups independently of the retired production scheduler', () => {
    const ids = Array.from({ length: 500 }, (_, i) => 'shot-' + i), files = lemoProjectFiles(ids);
    const scenes = files.filter(f => f.kind === 'scene');
    expect(scenes).toHaveLength(63); expect(scenes.every(f => f.shotIds.length <= 8)).toBe(true);
    expect(scenes.flatMap(f => f.shotIds)).toEqual(ids); expect(files).toHaveLength(65);
  });
});

describe('retired multi-file production entry points', () => {
  it.each([1, 2, 3])('refuses to construct retired graph v%s', version => {
    expect(() => buildVoxProductionNodes(nativeDocument(), nativeSettings(), LEMO_NATIVE_ENGINE, version)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
  });
  it.each([undefined, 2] as const)('rejects saved project version %s before any provider, checkpoint or document mutation', async version => {
    const d = nativeDocument(), settings = nativeSettings();
    d.productionRun = { version: 1, id: 'retired-project', status: 'paused', engine: LEMO_NATIVE_ENGINE, authoringVersion: version, settings,
      nodes: [{ id: 'film-code:shared', kind: 'film-code', fileId: 'shared', dependencies: [], status: 'unknown', paid: true, attempt: 1, requestId: 'original-paid-request', inputHash: 'original-input' }],
      sourceHash: voxInputHash(d.sourceText), runtimeIdentity: 'native-offline-test', createdAt: d.createdAt, updatedAt: d.updatedAt };
    const authorFilmFile = vi.fn(), planFilm = vi.fn(), previewCode = vi.fn(), officialStep = vi.fn(), recoverOfficialStep = vi.fn(), preflight = vi.fn();
    const h = nativeHarness({ authorFilmFile, planFilm, previewCode, officialStep, recoverOfficialStep, preflight }, d);
    const save = vi.spyOn(h.store, 'save'), checkpoint = vi.spyOn(h.store, 'checkpoint');
    await expect(h.start()).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    for (const action of ['resume', 'reconcile', 'recheck-code', 'retry-unknown', 'confirm-no-result', 'pause', 'cancel'] as const) {
      await expect(h.service.control({ id: d.id, runId: d.productionRun.id, action, nodeId: 'film-code:shared', evidence: 'Offline retained receipt fixture' })).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    }
    const node = d.productionRun.nodes[0];
    expect(() => h.runtime.expand!(d)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    expect(() => h.runtime.input(d, node)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.runtime.execute(d, node)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    await expect(h.runtime.recover!(d, node)).rejects.toThrow('LEMO_WORKFLOW_UNSUPPORTED');
    for (const operation of [authorFilmFile, planFilm, previewCode, officialStep, recoverOfficialStep, preflight, save, checkpoint]) expect(operation).not.toHaveBeenCalled();
    expect(h.receipts.size).toBe(0); expect(h.get()).toEqual(d);
  });
});
describe('factory assembly integrity and continuous time', () => {
  it('accepts and executes hoisted helpers declared after the complete factory return', async () => {
    const source = 'return {render, texts}; function render(t){return twice(t);} function texts(t){return [{text:String(t)}];} function twice(t){return 2*t;}';
    expect(() => validateLemoFile(source, 'scene')).not.toThrow();
    const factory = vm.runInNewContext('(async function(){' + source + '})');
    const api = await factory();
    expect(api.render(3)).toBe(6);
    expect(api.texts(4)).toEqual([{text: '4'}]);
    expect(() => validateLemoFile('return {draw}; function draw(){return 7;}', 'shared')).not.toThrow();
  });
  it.each(['const unreachable=1;', 'class Unreachable {}', 'draw();', 'if (true) { return {}; }'])('rejects executable statements after the factory return: %s', tail => {
    expect(() => validateLemoFile('return {render(){},texts(){}}; ' + tail, 'scene')).toThrow('LEMO_FILE_INCOMPLETE');
  });
  it('identifies unreachable initialization precisely, including a second trailing return', () => {
    const source = 'return {fields}; const fields={radial(){}}; return {fields};';
    expect(() => validateLemoFile(source, 'shared')).toThrow('const fields=');
    expect(() => validateLemoFile(source, 'shared')).toThrow('移到最终 return');
    expect(() => validateLemoFile('const fields={}; return {fields}; function draw(){};', 'shared')).not.toThrow();
  });
  it('still rejects truncated hoisted helpers and missing scene APIs', () => {
    expect(() => validateLemoFile('return {render, texts}; function render(){} function texts(){', 'scene')).toThrow('LEMO_');
    expect(() => validateLemoFile('return {render}; function render(){}', 'scene')).toThrow('LEMO_FILE_CONTRACT');
  });
  it.each(['return {', 'const x = 1;', 'return {render(){}};'])('rejects incomplete scene factories: %s', source => expect(() => validateLemoFile(source, 'scene')).toThrow('LEMO_'));
  it.each([false, true])('passes absolute nonsequential time through the visible canvas (sample=%s) and safely embeds literals', async sample => {
    const project: LemoProject = { version: 2, materials: [], bindings: {}, files: lemoProjectFiles(['shot']), repairFileIds: [], samplePaths: [] };
    project.files = project.files.map(f => ({...f, status: 'valid', source: f.id === 'shared' ? 'return {calls: []};' : f.id === 'director' ? 'return {render(t){ scenes["scene-1"].render(t); }, texts(t){return scenes["scene-1"].texts(t);}};' : 'return {render(t){globalThis.lastTime=t;input.canvas.getContext("2d").fillRect(t);},texts(t){return [{text:input.script, t}];}};' }));
    const html = assembleLemoProject(project, { canvas: {width: 1280, height: 720}, script: '</script><script>throw Error("injected")</script>' }, 3000, sample);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    const compiled = compileLemoNative(html).compiled;
    const draws: number[] = [];
    const stage = { style: {}, dataset: {}, width: 0, height: 0, getContext: () => ({ fillRect: (t: number) => draws.push(t) }) };
    const mounted: unknown[] = [];
    const context = vm.createContext({ window: {LemoHost: {require:()=>({}), fail: (e: Error)=>{throw e;}}, LEMO_ASSETS:{}}, document: { createElement: () => stage, body: { style: {}, appendChild: (canvas: unknown) => mounted.push(canvas) }, fonts: { ready: Promise.resolve() } } });
    vm.runInContext(compiled.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1], context);
    await new Promise(resolve => setImmediate(resolve));
    expect(context.window.READY).toBe(true);
    expect(mounted).toEqual([stage]);
    expect([stage.width, stage.height]).toEqual([1280, 720]);
    for (const t of [2.9, 0, 1.2, 2.9]) { context.window.render(t); expect(context.lastTime).toBe(t); expect(context.window.TEXTS(t)[0].t).toBe(t); }
    expect(context.window.TEXTS(0)[0].text).toContain('</script>');
    expect(draws).toEqual([2.9, 0, 1.2, 2.9]);
  });
});
