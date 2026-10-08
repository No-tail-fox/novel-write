import { describe, expect, it } from 'vitest';
import type { MotionComicScriptBeat, MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import { beatSelection, speakerOptions, updateFailedBeat } from '../src/features/motion-comic/motion-comic-script-repair';

const beat: MotionComicScriptBeat = { key: 'beat-1', kind: 'dialogue', text: '你来了。', sourceUnitIds: ['S1'] };
const draft: MotionComicScriptDraft = {
  title: '来信', logline: '一封意外来信', props: [],
  characters: [{ key: 'character:lin:xia', name: '林夏', aliases: [], role: '主角', identityPrompt: '短发', personality: '冷静', voiceNotes: '低声', looks: [{ key: 'look', label: '日常', appearancePrompt: '短发', wardrobe: '外套', continuityNotes: '外套不变' }] }],
  sceneAssets: [{ key: 'room', label: '房间', description: '旧房间', prompt: '旧房间', continuityNotes: '夜间' }],
  scenes: [{ key: 'scene', title: '来信', actIndex: 1, actTitle: '开端', actBoundaryReason: '来信打破日常', summary: '林夏收到来信', locationKey: 'room', beats: [beat] }],
};

describe('motion comic manual speaker repair', () => {
  it('shows an unassigned dialogue instead of silently displaying narration', () => {
    expect(beatSelection(beat)).toBe('dialogue:');
    expect(speakerOptions(draft, beat).find((option) => option.value === beatSelection(beat))?.label).toBe('对白（待指定说话人）');
  });
  it('preserves complete character keys, text and source evidence without mutating the input', () => {
    const next = updateFailedBeat(draft, beat.key, 'dialogue:character:lin:xia');
    expect(next.scenes[0].beats[0]).toEqual({ ...beat, characterKey: 'character:lin:xia' });
    expect(draft.scenes[0].beats[0]).not.toHaveProperty('characterKey');
  });
  it('retains the identity of role-bound inner speech and actions in the selector', () => {
    for (const kind of ['narration', 'action'] as const) {
      const bound = { ...beat, kind, characterKey: 'character:lin:xia' };
      expect(beatSelection(bound)).toBe(kind + ':character:lin:xia');
      expect(speakerOptions(draft, bound).some((option) => option.value === beatSelection(bound))).toBe(true);
    }
  });
  it('removes the character field only when explicitly selecting an unbound type', () => {
    const bound = updateFailedBeat(draft, beat.key, 'dialogue:character:lin:xia');
    const next = updateFailedBeat(bound, beat.key, 'narration:');
    expect(next.scenes[0].beats[0]).not.toHaveProperty('characterKey');
    expect(next.scenes[0].beats[0]).toEqual({ ...beat, kind: 'narration' });
  });
  it('does not guess for invalid values, unknown characters or ambiguous duplicate beat keys', () => {
    for (const selection of ['invalid', 'narrativeGoal:', 'dialogue:unknown']) expect(updateFailedBeat(draft, beat.key, selection)).toBe(draft);
    expect(updateFailedBeat(draft, 'unknown', 'action:')).toBe(draft);
    const duplicate = { ...draft, scenes: [{ ...draft.scenes[0], beats: [beat, beat] }] };
    expect(updateFailedBeat(duplicate, beat.key, 'action:')).toBe(duplicate);
    const invalid = { ...beat, characterKey: 'unknown' };
    expect(speakerOptions(draft, invalid).find((option) => option.value === beatSelection(invalid))?.label).toContain('无效角色');
  });
});
