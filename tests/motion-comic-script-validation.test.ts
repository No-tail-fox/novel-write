import { describe, expect, it } from 'vitest';
import { motionComicScriptDraftSchema, splitMotionComicSource, validateMotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import { repairScriptTitleNarration, scriptIssueLocation } from '../src/features/motion-comic/motion-comic-script-validation';
const source = '第2章\n她推开木门。';
const script = motionComicScriptDraftSchema.parse({title:'来信',logline:'来信',characters:[],sceneAssets:[{key:'room',label:'门厅',description:'门厅',prompt:'门厅',continuityNotes:'木门'}],props:[],scenes:[{key:'scene',title:'来信',actIndex:1,actTitle:'来信',actBoundaryReason:'来信',summary:'收到来信',locationKey:'room',beats:[{key:'title',kind:'narration',text:'第2章。',sourceUnitIds:['S1']},{key:'action',kind:'action',text:'她推开木门。',sourceUnitIds:['S2']}]}]});
describe('script validation recovery', () => {
 it('fixes a standalone heading without losing text, source coverage or changing the original', () => {
  expect(validateMotionComicScriptDraft(script,splitMotionComicSource(source))[0].code).toBe('STRUCTURAL_TITLE_NARRATED');
  const repaired=repairScriptTitleNarration(script,source);
  expect(repaired.scenes[0].beats[0]).toEqual({...script.scenes[0].beats[0],kind:'action'});
  expect(script.scenes[0].beats[0].kind).toBe('narration');
  expect(validateMotionComicScriptDraft(repaired,splitMotionComicSource(source))).toEqual([]);
  expect(repairScriptTitleNarration(repaired,source)).toEqual(repaired);
 });
 it('does not silence a mixed heading and narrative or a dialogue', () => {
  const mixed=structuredClone(script);mixed.scenes[0].beats[0].text='第2章。她想起昨天。';
  expect(repairScriptTitleNarration(mixed,source)).toEqual(mixed);
  mixed.scenes[0].beats[0].text='第2章。';mixed.scenes[0].beats[0].kind='dialogue';
  expect(repairScriptTitleNarration(mixed,source)).toEqual(mixed);
 });
 it('shows one-based scene and beat positions', () => {
  expect(scriptIssueLocation('script.scenes[0].beats[13].characterKey')).toBe('第 1 场 · 第 14 条');
  expect(scriptIssueLocation('script.scenes')).toBe('本集剧本');
 });
});
