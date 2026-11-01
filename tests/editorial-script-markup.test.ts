import { lemoStagedPlanningInput } from '../electron/lemo-staged-planning';
import { describe, expect, it } from 'vitest';
import { editorialPresentationCues, editorialScriptPlainText } from '../src/shared/editorial-script-markup';
import { planEditorialScript } from '../src/shared/editorial-script';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { timeline } from '../electron/lemo-production-document';

describe('one source-format contract for creative captions', () => {
  it('parses before splitting, retaining all heading and emphasized words', () => {
    const source = '## 原稿标题\n\n这是**完整的重点**。\n### 第二节\n继续叙述。';
    const plain = '原稿标题 这是完整的重点。 第二节 继续叙述。';
    expect(editorialScriptPlainText(source)).toBe(plain);
    expect(planEditorialScript(source, 'auto').beats.map(b => b.narration).join('')).toBe(plain);
    const draft = createEditorialCollageDraft({ id: 'markup', title: '格式', now: '2026-10-30T00:00:00Z' });
    const d = createEditorialCollageStarterPlan(draft, source, '2026-10-30T00:00:00Z', 'auto');
    expect(d.sourceText).toBe(source);
    expect(d.beats.flatMap(b => b.subtitleCues).map(c => c.text).join('')).toBe(plain);
  });
  it('projects paired markers split across cues and a mid-cue legacy heading', () => {
    const source = '## 标题\n这就是**重点内容**。\n### 下一节\n正文。';
    const cues = ['## 标题 这就是**重','点内容**。 ### 下','一节 正文。'].map((text, i) => ({id: String(i), text, startMs:i*1000, endMs:(i+1)*1000, tokens:[{text:'保留',startMs:1,endMs:2}]}));
    const before = JSON.stringify(cues);
    const result = editorialPresentationCues(source, cues);
    expect(result.map(c=>c.text)).toEqual([' 标题 这就是重','点内容。  下','一节 正文。']);
    expect(JSON.stringify(cues)).toBe(before);
    expect(result.map(({text: _, ...c})=>c)).toEqual(cues.map(({text: _, ...c})=>c));
  });
  it.each(['C# 和 #标签，2 * 3，2**8，file__name__part。', '保留未闭合的**记号。', '`**字面量**` 与 `# 标题`', '\\**不删转义**'])('preserves literal symbols: %s', source => {
    expect(editorialScriptPlainText(source)).toBe(source);
  });
  it('does not reinterpret hand-edited caption content or guessed format-only cues', () => {
    const edited = [{text:'## 用户自定义字幕'}];
    expect(editorialPresentationCues('## 原稿', edited)[0]).toBe(edited[0]);
    const separated = [{text:'## '},{text:'原稿'}];
    expect(editorialPresentationCues('## 原稿', separated)).toEqual(separated);
  });
  it('supports Unicode offsets without dropping emoji or later punctuation', () => {
    const cues = [{text:'## 😀 **重'},{text:'点**：保留#标签。'}];
    expect(editorialPresentationCues('## 😀 **重点**：保留#标签。',cues).map(c=>c.text)).toEqual([' 😀 重','点：保留#标签。']);
  });
  it('preserves legacy captions when no source is available', () => {
    const cues = [{ id: 'legacy', text: '## Explicit caption', startMs: 0, endMs: 1000 }];
    expect(editorialPresentationCues(undefined, cues)[0]).toBe(cues[0]);
    expect(editorialPresentationCues('', cues)[0]).toBe(cues[0]);
  });
  it('retains original staged planning receipt inputs for legacy Markdown', () => {
    const cue = {id:'c',text:'## 标题',startMs:0,endMs:1000};
    const d = {sourceText:'## 标题',beats:[{subtitleCues:[cue],shots:[{id:'s',subtitleCueIds:['c'],durationMs:1000}]}],
      productionRun:{filmId:'f',settings:{lockedShotIds:[]}},creativeFilms:[{id:'f',project:{materials:[],planning:{outline:{},units:[{id:'scene-1',shotIds:['s']}]}}}]} as any;
    const input = lemoStagedPlanningInput(d, {kind:'film-plan-scene',fileId:'scene-1'} as any, {}) as {timeline: {cues: {text: string}[]}[]};
    expect(input.timeline[0].cues[0].text).toBe(cue.text);
    expect(timeline(d)[0].cues[0].text).toBe(' 标题');
  });
  it('supplies canonical native captions without mutating saved paid inputs', () => {
    const raw = {id:'c',text:'## 原稿 **重点**',startMs:0,endMs:1000};
    const d = {sourceText:'## 原稿 **重点**',beats:[{subtitleCues:[raw],shots:[{id:'s',subtitleCueIds:['c'],durationMs:1000}]}],timeline:{clips:[{shotId:'s',startMs:0}]},productionRun:{settings:{lockedShotIds:[]}}} as any;
    expect(timeline(d)[0].cues[0].text).toBe(' 原稿 重点');
    expect(timeline(d,false)[0].cues[0].text).toBe(raw.text);
    expect(d.beats[0].subtitleCues[0]).toBe(raw);
  });
});