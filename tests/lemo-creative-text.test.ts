import { describe, expect, it } from 'vitest';
import { LLM_RESPONSE_MAX_BYTES } from '../src/shared/llm-response-limits';
import { lemoCreativeTextSchema, lemoResponseTextSchema } from '../src/shared/creative-animation/creative-text';
import { lemoOutlineSchema, lemoPlanningMaterialsSchema, lemoScenePlanSchema } from '../src/shared/creative-animation/native-planning';
import { lemoMaterialSchema, lemoProjectFiles, lemoProjectSchema } from '../src/shared/creative-animation/native-project';
import { applyLemoEdits } from '../src/shared/creative-animation/lemo-edits';
import { nativeHarness, nativeHtml } from './lemo-native.fixture';

const scene = { fileId: 'scene-1', summary: '承接开场', shots: [{ shotId: 'shot-1', direction: '树荫渐入', materialIds: [] }] };
const baseHash = 'a'.repeat(64);

describe('creative prose guidance versus resource and structural limits', () => {
  it('preserves short, long and whitespace-padded creative prose verbatim', () => {
    for (const text of ['树荫渐入', '  中文创作说明\n' + '详述'.repeat(35000) + '  ']) {
      expect(lemoCreativeTextSchema.parse(text)).toBe(text);
      expect(lemoOutlineSchema.parse({ treatment: text, fps: 24 }).treatment).toBe(text);
    }
  });

  it.each(['', '  \n\t  '])('rejects empty creative fields without enforcing minimum character counts: %j', text => {
    expect(lemoOutlineSchema.safeParse({ treatment: text, fps: 24 }).success).toBe(false);
    expect(lemoScenePlanSchema.safeParse({ ...scene, summary: text }).success).toBe(false);
    expect(lemoScenePlanSchema.safeParse({ ...scene, shots: [{ ...scene.shots[0], direction: text }] }).success).toBe(false);
    expect(lemoMaterialSchema.safeParse({ id: 'tree', kind: 'generated', description: text }).success).toBe(false);
    expect(() => applyLemoEdits('', baseHash, JSON.stringify({ baseHash, edits: [{ search: '', replace: 'return {};' }], done: true, summary: text }))).toThrow('LEMO_EDIT_INVALID');
  });

  it('retains long material descriptions and prompts through project serialization', () => {
    const material = { id: 'tree', kind: 'generated', description: '  树冠细节'.repeat(400) + '  ', prompt: '  插画细节'.repeat(1000) + '  ' };
    expect(material.description.length).toBeGreaterThan(2000);
    expect(material.prompt.length).toBeGreaterThan(5000);
    expect(lemoPlanningMaterialsSchema.parse({ materials: [material] }).materials[0]).toEqual(material);
    const project = lemoProjectSchema.parse({ version: 2, materials: [material], files: lemoProjectFiles(['shot-1']) });
    expect(lemoProjectSchema.parse(JSON.parse(JSON.stringify(project))).materials[0]).toEqual(material);
  });

  it('retains historical empty optional summaries and material prompts', () => {
    const files = lemoProjectFiles(['shot-1']);
    files[0].attempts.push({ requestId: 'historical', source: '', rawResponse: '', summary: '' });
    expect(lemoProjectSchema.parse({ version: 2, materials: [], files }).files[0].attempts[0].summary).toBe('');
    expect(lemoMaterialSchema.parse({ id: 'tree', kind: 'generated', description: '树', prompt: '' }).prompt).toBe('');
  });

  it('still rejects invalid structures, frame rates and oversized material inventories', () => {
    expect(lemoScenePlanSchema.safeParse({ ...scene, shots: [] }).success).toBe(false);
    expect(lemoScenePlanSchema.safeParse({ ...scene, shots: Array(9).fill(scene.shots[0]) }).success).toBe(false);
    expect(lemoScenePlanSchema.safeParse({ ...scene, extra: true }).success).toBe(false);
    expect(lemoOutlineSchema.safeParse({ treatment: '完整大纲', fps: 61 }).success).toBe(false);
    expect(lemoPlanningMaterialsSchema.safeParse({ materials: Array(25).fill({ id: 'tree', kind: 'generated', description: '树' }) }).success).toBe(false);
  });

  it('measures the existing transport safeguard in UTF-8 bytes, not characters', () => {
    const text = '创'.repeat(Math.floor(LLM_RESPONSE_MAX_BYTES / 3)) + 'a'.repeat(LLM_RESPONSE_MAX_BYTES % 3);
    expect(new TextEncoder().encode(text).byteLength).toBe(LLM_RESPONSE_MAX_BYTES);
    expect(lemoResponseTextSchema.safeParse(text).success).toBe(true);
    const oversized = lemoResponseTextSchema.safeParse(text + 'a');
    expect(oversized.success).toBe(false);
    if (!oversized.success) expect(oversized.error.issues[0].message).toContain('LEMO_RESOURCE_LIMIT');
  });

  it('bounds aggregate JSON resources even when individual fields fit', () => {
    const half = 'x'.repeat(LLM_RESPONSE_MAX_BYTES / 2);
    const parsed = lemoScenePlanSchema.safeParse({ ...scene, summary: half, shots: [{ ...scene.shots[0], direction: half }] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some(issue => issue.message.startsWith('LEMO_RESOURCE_LIMIT:'))).toBe(true);
  });

  it('reports resource exhaustion rather than claiming that a valid patch has malformed JSON', () => {
    const patch = JSON.stringify({ baseHash, edits: [{ search: '', replace: 'return {};' }], done: true, summary: '完成' });
    expect(() => applyLemoEdits('', baseHash, ' '.repeat(LLM_RESPONSE_MAX_BYTES) + patch)).toThrow('LEMO_RESOURCE_LIMIT');
  });

  it('rejects an action announcement without code rather than pretending the edit succeeded', () => {
    expect(() => applyLemoEdits('return {};', baseHash, 'I will add both in one batch, then mark the shared factory done.')).toThrow('LEMO_EDIT_NO_ACTION');
  });

  it.each([false, true])('accepts long plans at the legacy entry point (project=%s) without changing the original', async projectMode => {
    const treatment = '  完整保留创意细节'.repeat(7000) + '  ';
    expect(treatment.length).toBeGreaterThan(60000);
    const sourceFor = (id: string) => id === 'shared' ? 'return {};' : 'return {render(t){},texts(t){return [];}};';
    const h = nativeHarness({ planFilm: async () => ({ treatment, fps: 24, ...(projectMode ? { materials: [] } : {}) }),
      ...(projectMode ? { authorFilmFile: async (_prompt: string, _style: string, id: string) => ({ text: sourceFor(id), raw: sourceFor(id), finishReason: 'stop', requestId: 'offline-legacy-' + id }) } : { generateFilm: async (prompt: string) => nativeHtml(JSON.parse(prompt).durationMs) }) });
    const original = h.get().sourceText;
    await h.start(); await h.idle();
    expect(h.get().productionRun?.status, h.get().productionRun?.message).toBe('completed');
    const film = h.get().creativeFilms!.find(item => item.id === h.get().productionRun!.filmId)!;
    expect(film.treatment).toBe(treatment);
    expect(h.get().sourceText).toBe(original);
  });
});
