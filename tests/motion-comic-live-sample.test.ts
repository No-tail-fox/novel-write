import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfiguredJsonLlm } from '@shared/llm-provider';
import { createMotionComicDraft, createMotionComicStarterProject, parseMotionComicPipelineData } from '@shared/motion-comic';
import { applyMotionComicPlan, collectMotionComicPlanAdjustments, estimateMotionComicDialogueMs, motionComicScriptDraftSchema, motionComicStoryboardDraftSchema, normalizeMotionComicScriptRaw, normalizeMotionComicStoryboardRaw, parseMotionComicPlanDraft, splitMotionComicSource, validateMotionComicScriptDraft, validateMotionComicStoryboard } from '@shared/motion-comic-planning';
import { generateMotionComicScript } from '@shared/motion-comic-planner';

// Recorded genuine provider output. These regression tests make NO network calls.
const sample = JSON.parse(readFileSync(resolve('tests/fixtures/motion-comic-live-gemini-20260928.json'), 'utf8'));
const now = '2026-09-28T05:06:00.000Z';
const units = splitMotionComicSource(sample.sourceText);
const original = motionComicScriptDraftSchema.parse(normalizeMotionComicScriptRaw(sample.script, units));
const document = () => createMotionComicStarterProject(createMotionComicDraft({ id: 'live-sample', title: '雨停之前', premise: sample.sourceText, now }), '第一集', now);
function editedScript() {
  const script = structuredClone(original);
  const beat = script.scenes.flatMap(s => s.beats).find(b => b.kind === 'dialogue' && b.text.includes('留下'))!;
  beat.text = sample.editedText;
  return script;
}

describe('captured real-model motion-comic acceptance sample', () => {
  it('retains both scenes, contiguous acts, all source units and four explicitly attributed dialogue lines', () => {
    expect(validateMotionComicScriptDraft(original, units)).toEqual([]);
    expect(original.scenes.map(s => s.actIndex)).toEqual([1, 2]);
    const cast = new Map(original.characters.map(c => [c.key, c.name]));
    const dialogue = original.scenes.flatMap(s => s.beats).filter(b => b.kind === 'dialogue');
    expect(dialogue.map(b => cast.get(b.characterKey!))).toEqual(['林夏', '周沉', '周沉', '林夏']);
    expect(dialogue.map(b => b.text)).toEqual(['这封信是你留下的吗？', '不是。我们去钟楼看看邮戳。', '邮戳上的图案就在这里。', '先记下图案，明早再来核对。']);
  });
  it('labels human changes as manual, preserves them and does not call a model for validation', async () => {
    const run = vi.fn(() => { throw new Error('No paid calls in regression tests'); });
    const result = await generateMotionComicScript({ id: 'live-sample', expectedUpdatedAt: now, sourceText: sample.sourceText, scriptDraft: editedScript(), stage: 'script' }, document(), { protocol: 'openai', run } as unknown as ConfiguredJsonLlm, { model: sample.provenance.model, manualRepairBase: {script:original, adjustments:[]} });
    expect(run).not.toHaveBeenCalled();
    expect(result.adjustments).toEqual([expect.objectContaining({kind:'manual', before:'这封信是你留下的吗？', after:sample.editedText})]);
    expect(result.script).toEqual(editedScript());
  });
  it('widens the real 4-second shot to 5 seconds and preserves all ten ordered beat claims', () => {
    const script = editedScript();
    const storyboard = motionComicStoryboardDraftSchema.parse(normalizeMotionComicStoryboardRaw(sample.storyboard, script));
    expect(sample.storyboard.shots[2].durationSec).toBe(4);
    expect(storyboard.shots[2].durationSec).toBe(5);
    expect(storyboard.shots).toHaveLength(10);
    expect(validateMotionComicStoryboard(script, storyboard.shots)).toEqual([]);
    expect(storyboard.shots.flatMap(s => s.beatKeys)).toEqual(script.scenes.flatMap(s => s.beats.map(b => b.key)));
  });
  it('applies a serializable episode with valid cue timing, entities, and complete evidence', () => {
    const script = editedScript();
    const storyboard = motionComicStoryboardDraftSchema.parse(normalizeMotionComicStoryboardRaw(sample.storyboard, script));
    const adjustments = collectMotionComicPlanAdjustments(sample.storyboard, storyboard, 'storyboard');
    const plan = parseMotionComicPlanDraft({version:1,sourceText:sample.sourceText,sourceUnits:units,script,shots:storyboard.shots,model:sample.provenance.model,createdAt:now,adjustments});
    const applied = applyMotionComicPlan(document(), plan, {replaceStarter:true,reviewedAdjustments:true,now});
    const reread = parseMotionComicPipelineData(JSON.stringify(applied));
    expect(reread).toEqual(applied);
    const episode = reread.episodes[0];
    expect(episode.dialogueCues.map(c => c.text)).toContain(sample.editedText);
    expect(episode.planningEvidence!.shotClaims.flatMap(c => c.beatIds)).toEqual(episode.planningEvidence!.beats.map(b => b.id));
    for (const cue of episode.dialogueCues) {
      const clip = episode.timeline.clips.find(c => c.shotId === cue.shotId)!;
      expect(cue.startMs).toBeGreaterThanOrEqual(clip.startMs);
      expect(cue.endMs).toBeLessThanOrEqual(clip.startMs + clip.durationMs);
      expect(cue.endMs - cue.startMs).toBeGreaterThanOrEqual(estimateMotionComicDialogueMs(cue.text) - 1);
      expect(reread.characters.some(c => c.id === cue.characterId)).toBe(true);
    }
  });
});
