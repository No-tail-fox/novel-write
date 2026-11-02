import { describe, expect, it, vi } from 'vitest';
import { nativeDocument, nativeHarness, nativeSettings } from './lemo-native.fixture';
import { buildVoxProductionNodes, voxProductionNeedsTextModel } from '../src/shared/vox-production';
import { LEMO_NATIVE_ENGINE, lemoPlanRequest } from '../src/shared/creative-animation/native-film';
import { lemoOutlineSchema, lemoScenePlanSchema } from '../src/shared/creative-animation/native-planning';

// Retired planner dispatch is rejected; retained pure tests cover library contracts only.
describe('official SDK replaces staged planner dispatch', () => {
  it.each([1,2,3])('rejects authoring v%i before constructing a retired planner graph', version => {
    expect(()=>buildVoxProductionNodes(nativeDocument(),nativeSettings(),LEMO_NATIVE_ENGINE,version,1)).toThrow('LEMO_WORKFLOW_UNSUPPORTED');
  });
  it('never falls back to staged planner callbacks when the official session is missing', async () => {
    const planFilm=vi.fn(),authorFilmFile=vi.fn(),editFilmFile=vi.fn();
    const h=nativeHarness({nativePlanningVersion:1,planFilm,authorFilmFile,editFilmFile});
    await expect(h.start()).rejects.toThrow('LEMO_OFFICIAL_UNAVAILABLE');
    expect(planFilm).not.toHaveBeenCalled();expect(authorFilmFile).not.toHaveBeenCalled();expect(editFilmFile).not.toHaveBeenCalled();
    expect(h.get().productionRun).toBeUndefined();expect(h.calls).toEqual([]);
  });
  it('bounds 500 official shot timings with a single voice lock before final authoring', () => {
    const d=nativeDocument(),first=d.beats[0].shots[0];
    d.beats=Array.from({length:5},(_,b)=>({...d.beats[0],id:'beat-'+b,shots:Array.from({length:100},(_,i)=>({...first,beatId:'beat-'+b,id:'window-'+(b*100+i)}))}));
    const nodes=buildVoxProductionNodes(d,nativeSettings(),LEMO_NATIVE_ENGINE,4);
    expect(nodes.filter(n=>n.kind==='timing')).toHaveLength(500);
    const author=nodes.filter(n=>n.kind==='film-edit');
    expect(author.map(n=>n.id)).toEqual(['official-treatment','official-style-frame','official-voice-lock','official-authoring']);
    expect(nodes.find(n=>n.id==='official-voice-lock')!.dependencies).toEqual(nodes.filter(n=>n.kind==='timing').map(n=>n.id));
    expect(nodes.find(n=>n.id==='official-voice-lock')!.dependencies).toHaveLength(500);
    expect(nodes.find(n=>n.id==='official-authoring')!.dependencies).toEqual(['official-voice-lock']);
    expect(nodes.every((n,i)=>n.dependencies.every(id=>{const index=nodes.findIndex(p=>p.id===id);return index>=0&&index<i;}))).toBe(true);
    expect(nodes.some(n=>['plan','film-plan-materials','film-plan-scene'].includes(n.kind))).toBe(false);
    expect(voxProductionNeedsTextModel(author)).toBe(true);
    expect(voxProductionNeedsTextModel(nodes.filter(n=>n.kind==='film-finalize'))).toBe(false);
  });
});
describe('retained planning library contracts', () => {
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
