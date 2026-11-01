import { describe, expect, it, vi } from 'vitest';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { buildVoxProductionNodes, voxProductionNeedsTextModel, voxProductionRunSchema } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE, lemoPlanRequest } from '../src/shared/creative-animation/native-film';
import { lemoOutlineSchema, lemoScenePlanSchema, lemoPlanningShotIds } from '../src/shared/creative-animation/native-planning';
import { LlmJsonParseError } from '../src/shared/llm-provider';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import { VoxProductionService, voxInputHash } from '../electron/vox-production-service';
import { rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import type { VoxProductionOperations } from '../electron/vox-production-runtime';

const treatment = '以树荫作为城市热岛的视觉论点，先展开吸热的街道，再以连续镜头推至树下，文字和水彩笔触共同呈现降温机制。';
const direction = '镜头沿街道连续推进，水彩轮廓呈现吸热与遮荫关系，字幕跟随原始时间窗口逐字清晰展示并保留读完时间。';
const respond = (prompt: string) => {
  const p = JSON.parse(prompt);
  if (p.planningStage === 'outline') return { treatment, fps: 24 };
  if (p.planningStage === 'materials') return { materials: [] };
  if (p.planningStage === 'scene') return { fileId: p.file.id, summary: '连续展示街道与树荫的对比，以统一水彩视觉保持前后段衔接。', shots: p.file.shotIds.map((shotId: string) => ({ shotId, direction, materialIds: [] })) };
  return { treatment, fps: 24, materials: [] };
};
const source = (id: string) => id === 'shared' ? 'return {calls: []};' : id === 'director' ? 'return {render(t){for(const scene of Object.values(scenes))scene.render(t);},texts(t){return Object.values(scenes).flatMap(s=>s.texts(t));}};' : 'return {render(t){shared.calls.push(t);},texts(t){return [];}};';
const author = () => vi.fn(async (_p: string, _s: string, id: string) => ({ text: source(id), raw: source(id), finishReason: 'stop', requestId: 'code-' + id }));
const doc = (count = 17) => {
  const d = nativeDocument(), first = d.beats[0].shots[0];
  const cue = d.beats[0].subtitleCues[0];
  d.beats = [{ ...d.beats[0], durationMs: count * first.durationMs,
    subtitleCues: Array.from({ length: count }, (_, i) => ({ ...cue, id: 'cue-' + i, shotId: 'window-' + i, startMs: i * first.durationMs, endMs: (i + 1) * first.durationMs, tokens: undefined })),
    shots: Array.from({ length: count }, (_, i) => ({ ...first, id: 'window-' + i, subtitleCueIds: ['cue-' + i], cuePlan: undefined })) }];
  return rebuildEditorialTimeline(d);
};
const setup = (overrides: Partial<VoxProductionOperations> = {}, initial = doc()) => {
  const planFilm = vi.fn(async (prompt: string) => respond(prompt));
  const authorFilmFile = author();
  const h = nativeHarness({ nativePlanningVersion: 1, authorFilmFile, planFilm, ...overrides }, initial);
  return { ...h, planFilm, authorFilmFile };
};
const film = (h: ReturnType<typeof setup>) => h.get().creativeFilms!.find(f => f.id === h.get().productionRun!.filmId)!;
const finished = (h: ReturnType<typeof setup>) => expect(h.get().productionRun?.status, h.get().productionRun?.message ?? String(h.errors)).toBe('completed');
const resume = async (h: ReturnType<typeof setup>) => { await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' }); await h.idle(); };

describe('checkpointed Lemo planning', () => {
  it('preserves a longer real-world outline through the complete staged workflow', async () => {
    const expanded = treatment.repeat(1300);
    expect(expanded.length).toBeGreaterThan(60000);
    const h = setup({ planFilm: async prompt => JSON.parse(prompt).planningStage === 'outline' ? { treatment: expanded, fps: 24 } : respond(prompt) });
    await h.start(); await h.idle(); finished(h);
    expect(film(h).project!.planning!.outline.treatment).toBe(expanded);
    expect(film(h).treatment).toContain(expanded);
  });
  it('runs one outline, one inventory and bounded scenes before free validation and code', async () => {
    const h = setup(); const original = h.get().sourceText;
    await h.start(); await h.idle(); finished(h);
    expect(h.get().sourceText).toBe(original);
    expect(h.get().productionRun?.planningVersion).toBe(1);
    const payloads = h.planFilm.mock.calls.map(c => JSON.parse(c[0]));
    expect(payloads.map(p => p.planningStage)).toEqual(['outline', 'materials', 'scene', 'scene', 'scene']);
    expect(payloads[0].script).toBe(original);
    expect(payloads.slice(2).map(p => p.file.shotIds.length)).toEqual([8, 8, 1]);
    expect(payloads.slice(2).every(p => !('script' in p) && p.provisionalTimeline.length <= 8)).toBe(true);
    const planning = film(h).project!.planning!;
    expect(planning.complete).toBe(true); expect(planning.scenes).toHaveLength(3);
    expect(h.calls.indexOf('film-plan-finalize')).toBeLessThan(h.calls.indexOf('film-code'));
    expect(h.get().productionRun?.nodes.find(n => n.kind === 'film-plan-finalize')?.paid).toBe(false);
    const scenePrompt = JSON.parse(h.authorFilmFile.mock.calls.find(c => c[2] === 'scene-2')![0]);
    expect(scenePrompt.scenePlans).toHaveLength(1); expect(scenePrompt.scenePlans[0].shots.map((s: {shotId: string}) => s.shotId)).toEqual(planning.units[1].shotIds);
    expect(film(h).treatment.length).toBeLessThan(60000);
    expect(h.errors).toEqual([]); expect(() => voxProductionRunSchema.parse(h.get().productionRun)).not.toThrow();
  });

  it('bounds 500-shot planning and retains a topologically ordered graph', () => {
    const nodes = buildVoxProductionNodes(doc(500), nativeSettings(), LEMO_NATIVE_ENGINE, 2, 1);
    expect(nodes.filter(n => n.kind === 'film-plan-scene')).toHaveLength(63);
    expect(nodes.every((n, i) => n.dependencies.every(id => nodes.findIndex(p => p.id === id) < i))).toBe(true);
    expect(voxProductionNeedsTextModel(nodes.filter(n => n.kind === 'film-plan-scene'))).toBe(true);
    expect(voxProductionNeedsTextModel(nodes.filter(n => n.kind === 'film-plan-materials'))).toBe(true);
    expect(voxProductionNeedsTextModel(nodes.filter(n => n.kind === 'film-plan-finalize'))).toBe(false);
  });

  it('restarts after an invalid second scene without re-buying successful stages', async () => {
    let broken = true;
    const planFilm = vi.fn(async (p: string) => {
      const payload = JSON.parse(p);
      if (broken && payload.planningStage === 'scene' && payload.file.id === 'scene-2') return { fileId: 'scene-2', summary: '这一段缺少原始镜头，需要被校验拒绝。', shots: [] };
      return respond(p);
    });
    const h = setup({ planFilm }); await h.start(); await h.idle();
    expect(h.get().productionRun?.nodes.find(n => n.id === 'film-plan-scene:scene-2')?.status).toBe('failed');
    expect(film(h).status).toBe('planning'); expect(film(h).project!.planning!.complete).toBe(false);
    expect(h.authorFilmFile).not.toHaveBeenCalled();
    const before = h.get().productionRun!.nodes.filter(n => n.status === 'completed').map(n => [n.id, n.requestId]);
    broken = false;
    const restarted = new VoxProductionService(h.store, async () => h.runtime);
    await restarted.restore(); await restarted.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'resume' }); await restarted.idle(h.get().id); finished(h);
    expect(planFilm.mock.calls.map(c => {const p = JSON.parse(c[0]);return p.file?.id ?? p.planningStage;})).toEqual(['outline', 'materials', 'scene-1', 'scene-2', 'scene-2', 'scene-3']);
    for (const [id, requestId] of before) expect(h.get().productionRun!.nodes.find(n => n.id === id)?.requestId).toBe(requestId);
  });

  it.each(['materials', 'scene'])('checkpoints a complete truncated %s reply as failed, not unknown or success', async stage => {
    const raw = '{"unfinished":';
    const h = setup({ planFilm: async p => {
      if (JSON.parse(p).planningStage === stage) throw new LlmJsonParseError('max_tokens', raw, { text: raw, raw, requestId: 'provider-truncated', finishReason: 'max_tokens', usage: { output_tokens: 4096 } });
      return respond(p);
    } });
    await h.start(); await h.idle();
    const failed = h.get().productionRun!.nodes.find(n => n.status === 'failed')!;
    expect(failed).toMatchObject({ resultReceived: true, llmResponse: { text: raw, requestId: 'provider-truncated', finishReason: 'max_tokens' } });
    expect(h.receipts.has(failed.requestId!)).toBe(true); expect(h.authorFilmFile).not.toHaveBeenCalled();
  });

  it('blocks automatic resend after an interrupted scene and only retries on explicit action', async () => {
    let interrupted = true;
    const planFilm = vi.fn(async (p: string) => {
      if (interrupted && JSON.parse(p).planningStage === 'scene') throw new LlmTextInterruptedError({ text: '{', raw: '{', requestId: 'inflight' }, Error('socket closed'));
      return respond(p);
    });
    const h = setup({ planFilm }, doc(2)); await h.start(); await h.idle();
    expect(h.get().productionRun!.nodes.find(n => n.id === 'film-plan-scene:scene-1')).toMatchObject({ status: 'unknown', llmResponse: { requestId: 'inflight' } });
    await expect(resume(h)).rejects.toThrow('VOX_PRODUCTION_UNKNOWN'); expect(planFilm).toHaveBeenCalledTimes(3);
    interrupted = false;
    await h.service.control({ id: h.get().id, runId: h.get().productionRun!.id, action: 'retry-unknown', nodeId: 'film-plan-scene:scene-1' }); await h.idle(); finished(h);
    expect(planFilm).toHaveBeenCalledTimes(4);
  });

  it.each(['materials', 'scene'])('classifies an explicit %s HTTP 400 as a known rejection', async stage => {
    const h = setup({ planFilm: async p => { if (JSON.parse(p).planningStage === stage) throw Error('LLM API error (400) at step 1 planning via https://provider.example/v1/messages: unsupported'); return respond(p); } });
    await h.start(); await h.idle();
    expect(h.get().productionRun!.nodes.some(n => n.status === 'unknown')).toBe(false);
    expect(h.get().productionRun!.nodes.some(n => n.status === 'failed')).toBe(true);
  });

  it.each(['missing', 'duplicate', 'unknown-material'])('rejects %s shot assignments before creation', async bad => {
    const h = setup({ planFilm: async p => {
      const result = respond(p);
      if ('shots' in result && result.shots) {
        if (bad === 'missing') result.shots.pop();
        if (bad === 'duplicate') result.shots[1] = result.shots[0];
        if (bad === 'unknown-material') result.shots[0].materialIds = ['fake'];
      }
      return result;
    } });
    await h.start(); await h.idle(); expect(h.get().productionRun?.status).toBe('failed'); expect(h.authorFilmFile).not.toHaveBeenCalled();
  });

  it('rejects generated material requests when the user disabled images', async () => {
    const h = setup({ planFilm: async p => JSON.parse(p).planningStage === 'materials' ? { materials: [{id: 'fake',kind: 'generated',description: 'illustration'}] } : respond(p) });
    await h.start(); await h.idle(); expect(h.get().productionRun?.message).toContain('已关闭生图'); expect(h.calls).not.toContain('film-plan-scene');
  });

  it('adopts legacy successes without changing their plan or charging for migration', async () => {
    const h = setup({ nativePlanningVersion: undefined }); await h.start(); await h.idle(); finished(h);
    const originalFilm = film(h).id; h.runtime.nativePlanningVersion = 1;
    await h.start(); await h.idle(); finished(h);
    expect(h.planFilm).toHaveBeenCalledTimes(1); expect(film(h).id).toBe(originalFilm);
    expect(h.get().productionRun?.planningVersion).toBeUndefined();
    expect(h.get().productionRun?.nodes.some(n => n.kind === 'film-plan-scene')).toBe(false);
  });

  it('upgrades a failed legacy plan on resume without changing source or provider identity', async () => {
    let legacy = true;
    const planFilm = vi.fn(async (p: string) => { if (legacy) throw new LlmJsonParseError('truncated', '{', {text:'{',raw:'{',finishReason:'max_tokens',requestId:'old'}); return respond(p); });
    const h = setup({ nativePlanningVersion: undefined, planFilm }); await h.start(); await h.idle();
    const before = h.get(); legacy = false; h.runtime.nativePlanningVersion = 1; await resume(h); finished(h);
    expect(h.get().sourceText).toBe(before.sourceText); expect(h.get().productionRun?.settings).toEqual(before.productionRun?.settings);
    expect(h.get().productionRun?.runtimeIdentity).toBe(before.productionRun?.runtimeIdentity); expect(h.get().productionRun?.planningVersion).toBe(1);
    expect(h.get().productionRun?.nodes.find(n => n.id === 'plan')?.attempt).toBe(2);
  });

  it('reuses all planning receipts when only code generation fails', async () => {
    let invalid = true;
    const authorFilmFile = vi.fn(async (_p: string, _s: string, id: string) => ({ text: invalid ? 'return {' : source(id), raw: '', finishReason: 'stop', requestId: null }));
    const h = setup({ authorFilmFile }); await h.start(); await h.idle();
    const count = h.planFilm.mock.calls.length; invalid = false; await resume(h); finished(h); expect(h.planFilm).toHaveBeenCalledTimes(count);
    await h.start(); await h.idle(); finished(h); expect(h.planFilm).toHaveBeenCalledTimes(count);
  });

  it('keeps planning node inputs independent of their own outputs and source repairs', async () => {
    const h = setup(); await h.start(); await h.idle(); finished(h);
    const before = h.get(); const node = before.productionRun!.nodes.find(n => n.kind === 'film-plan-scene')!;
    const hash = voxInputHash(h.runtime.input(before, node)); const active = before.creativeFilms!.find(f => f.id === before.productionRun!.filmId)!;
    active.project!.files[0].source = 'changed downstream code'; active.project!.planning!.scenes[0].summary = 'changed own output'; active.treatment = 'changed assembled output';
    expect(voxInputHash(h.runtime.input(before, node))).toBe(hash);
  });


  it('feeds scene plans into incremental edits and resumes only the failed code batch', async () => {
    let broken = true;
    const editFilmFile = vi.fn(async (prompt: string) => {
      const p = JSON.parse(prompt);
      const text = broken && p.file.id === 'scene-2' ? '{' : JSON.stringify({ baseHash: p.batch.baseHash, edits: [{search: '', replace: source(p.file.id)}], done: true, summary: '完成本段代码' });
      return { text, raw: text, finishReason: 'stop', requestId: 'edit-' + p.file.id };
    });
    const h = setup({ editFilmFile }); await h.start(); await h.idle();
    expect(h.get().productionRun?.status).toBe('failed');
    const planningCalls = h.planFilm.mock.calls.length;
    expect(film(h).project!.planning!.complete).toBe(true);
    broken = false; await resume(h); finished(h);
    expect(h.planFilm).toHaveBeenCalledTimes(planningCalls); expect(h.authorFilmFile).not.toHaveBeenCalled();
    const p = JSON.parse(editFilmFile.mock.calls.find(c => JSON.parse(c[0]).file.id === 'scene-2')![0]);
    expect(p.scenePlans[0].shots.map((s: { shotId: string }) => s.shotId)).toEqual(film(h).project!.planning!.units[1].shotIds);
  });

  it('does not upgrade or resubmit a legacy request with an unknown outcome', async () => {
    const planFilm = vi.fn(async () => { throw new LlmTextInterruptedError({text:'{',raw:'{',requestId:'legacy-inflight'}, Error('socket closed')); });
    const h = setup({ nativePlanningVersion: undefined, planFilm }); await h.start(); await h.idle();
    h.runtime.nativePlanningVersion = 1;
    await expect(resume(h)).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    await expect(h.start()).rejects.toThrow('VOX_PRODUCTION_UNKNOWN');
    expect(h.get().productionRun?.planningVersion).toBeUndefined(); expect(planFilm).toHaveBeenCalledTimes(1);
  });

  it('refuses finalization and authoring when a saved scene checkpoint is missing', async () => {
    const h = setup(); await h.start(); await h.idle(); finished(h);
    const d = h.get(); const p = d.creativeFilms!.find(f => f.id === d.productionRun!.filmId)!.project!;
    p.planning!.scenes.pop(); p.planning!.complete = false;
    const calls = h.authorFilmFile.mock.calls.length;
    await expect(h.runtime.execute(d, d.productionRun!.nodes.find(n => n.kind === 'film-plan-finalize')!)).rejects.toThrow('未完整覆盖');
    await expect(h.runtime.execute(d, d.productionRun!.nodes.find(n => n.kind === 'film-code')!)).rejects.toThrow('LEMO_PLAN_INCOMPLETE');
    expect(h.authorFilmFile).toHaveBeenCalledTimes(calls);
  });

  it.each(['source', 'style'] as const)('invalidates saved plans when %s changes', async change => {
    const h = setup({}, doc(2)); await h.start(); await h.idle(); finished(h);
    const count = h.planFilm.mock.calls.length;
    if (change === 'source') { const d = h.get(); d.sourceText += '原稿新增一句。'; h.set(d); }
    await h.start(change === 'style' ? nativeSettings({authoring:{mode:'ai-code',styleId:'ink-wash'}}) : nativeSettings());
    await h.idle(); finished(h);
    expect(h.planFilm.mock.calls.length).toBeGreaterThan(count);
    expect(JSON.parse(h.planFilm.mock.calls[count][0]).planningStage).toBe('outline');
  });

  it.each([4200, 36000])('reuses planning after measured narration (%i ms) and maps split shots to their original directions', async durationMs => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os'); const { join, dirname } = await import('node:path');
    const directory = await mkdtemp(join(tmpdir(), 'lemo-staged-test-'));
    try {
      const path = join(directory, 'voice.wav'); await writeFile(path, 'offline voice fixture');
      const speech: VoxProductionOperations['speech'] = async (input, requestId) => ({durationMs, record:{id:requestId,text:input.text,provider:input.provider,voiceId:input.voiceId,voiceLabel:input.voiceLabel,speed:input.speed,audioPath:path,status:'generated',errorMessage:'',createdAt:'2026-10-29T00:00:00.000Z',finishedAt:'2026-10-29T00:00:00.000Z'}});
      let broken = true;
      const editFilmFile = vi.fn(async (prompt: string) => {
        const p = JSON.parse(prompt); const text = broken ? '{' : JSON.stringify({baseHash:p.batch.baseHash,edits:[{search:'',replace:source(p.file.id)}],done:true,summary:'完成本段代码'});
        return {text,raw:text,finishReason:'stop',requestId:null};
      });
      const h = setup({speech, editFilmFile}, doc(2)); const settings = nativeSettings({narration:true});
      await h.start(settings); await h.idle(); expect(h.get().productionRun?.status).toBe('failed');
      expect(h.get().productionRun!.nodes.find(n => n.status === 'failed')?.kind, h.get().productionRun?.message).toBe('film-edit');
      const planningCalls = h.planFilm.mock.calls.length, units = film(h).project!.planning!.units;
      const receipts = h.get().productionRun!.nodes.filter(n => ['plan','film-plan-materials','film-plan-scene'].includes(n.kind)).map(n => [n.id,n.requestId]);
      if (durationMs > 15000) expect(h.get().beats[0].shots.length).toBeGreaterThan(2);
      broken = false; await resume(h); finished(h);
      expect(h.planFilm).toHaveBeenCalledTimes(planningCalls); expect(film(h).project!.planning!.units).toEqual(units);
      for (const [id, requestId] of receipts) expect(h.get().productionRun!.nodes.find(n => n.id === id)?.requestId).toBe(requestId);
      const scene = JSON.parse(editFilmFile.mock.calls.find(c => JSON.parse(c[0]).file.kind === 'scene')![0]);
      const ids = new Set(scene.scenePlans.flatMap((p: {shots:{shotId:string}[]}) => p.shots.map(s => s.shotId)));
      for (const id of scene.file.shotIds) { const shot = h.get().beats.flatMap(b => b.shots).find(s => s.id === id)!; expect(ids.has(shot.narrationSplit?.sourceShotId ?? id)).toBe(true); }
      await h.start(settings); await h.idle(); finished(h); expect(h.planFilm).toHaveBeenCalledTimes(planningCalls);
      await expect(h.runtime.execute(h.get(), h.get().productionRun!.nodes.find(n => n.kind === 'film-plan-finalize')!)).resolves.toBeDefined();
    } finally { expect(dirname(directory)).toBe(tmpdir()); await rm(directory, {recursive:true,force:true}); }
  });

  it('uses the direct plan assignment when a previously split film is replanned', async () => {
    const h = setup({}, doc(2)); await h.start(); await h.idle(); finished(h);
    const project = film(h).project!;
    project.planning!.units = [{id:'scene-1',shotIds:['original','child']}];
    const shots = [{id:'original'}, {id:'child',narrationSplit:{sourceShotId:'original'}}, {id:'new-child',narrationSplit:{sourceShotId:'original'}}];
    expect(lemoPlanningShotIds(project, shots, shots.map(s => s.id))).toEqual(['original','child','original']);
  });

  it('retains detailed directions beyond the prompt target through every planning checkpoint', async () => {
    const expanded = direction.repeat(50);
    expect(expanded.length).toBeGreaterThan(2000);
    const h = setup({ planFilm: async prompt => {
      const result = respond(prompt);
      return JSON.parse(prompt).planningStage === 'scene' ? { ...result, shots: result.shots!.map((shot: { shotId: string; direction: string; materialIds: string[] }) => ({ ...shot, direction: expanded })) } : result;
    } });
    await h.start(); await h.idle(); finished(h);
    expect(film(h).project!.planning!.scenes.flatMap(scene => scene.shots).every(shot => shot.direction === expanded)).toBe(true);
  });

  it('preserves safe verbose outputs without removing structural or size guards', () => {
    expect(lemoOutlineSchema.parse({ treatment: 'x'.repeat(6000), fps: 24 }).treatment).toHaveLength(6000);
    expect(lemoOutlineSchema.parse({ treatment: 'x'.repeat(20001), fps: 24 }).treatment).toHaveLength(20001);
    const scene = { fileId: 'scene-1', summary: 'x'.repeat(60), shots: [{ shotId: 'shot-1', direction: 'x'.repeat(738), materialIds: [] }] };
    expect(lemoScenePlanSchema.parse(scene).shots[0].direction).toHaveLength(738);
    expect(lemoScenePlanSchema.parse({ ...scene, shots: [{ ...scene.shots[0], direction: 'x'.repeat(2001) }] }).shots[0].direction).toHaveLength(2001);
    expect(lemoScenePlanSchema.parse({ ...scene, summary: 'x'.repeat(601) }).summary).toHaveLength(601);
    expect(() => lemoScenePlanSchema.parse({ ...scene, shots: [] })).toThrow();
  });

  it.each(['openai', 'responses', 'anthropic'] as const)('routes every planning stage through the existing %s adapter', protocol => {
    for (const planningStage of ['outline', 'materials', 'scene']) {
      const request = lemoPlanRequest('style-reference-fixture', JSON.stringify({ projectVersion: 2, planningVersion: 1, planningStage }), protocol);
      expect(request.messages[0].content).toContain('ONE checkpointed planning stage');
      expect(request.messages[0].content).not.toContain('second-by-second beats, camera staging');
      expect(request.messages[0].content).toContain('style-reference-fixture');
      expect(request.defaultMaxTokens).toBe(65536);
      expect(request.maxRetries).toBe(0); expect(request.jsonMode).toBe(protocol === 'anthropic' ? 'none' : 'required');
    }
  });
});
