import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';
import { createSceneShotDraft, MotionComicSceneShotEditor, sceneShotDraftPatch, validateSceneShotDraft } from '../src/features/motion-comic/MotionComicSceneShotEditor';

const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'scene-editor', title: '编辑分镜', premise: '测试', now: '2026-01-01T00:00:00Z' }), '第一集', '2026-01-01T00:00:00Z');
const episode = document.episodes[0];
const shot = episode.scenes[0].shots[0];
const cues = episode.dialogueCues.filter((cue) => shot.dialogueCueIds.includes(cue.id));

describe('scene shot editor', () => {
  it('displays authoritative shot details and an explicit edit action', () => {
    const html = renderToStaticMarkup(createElement(MotionComicSceneShotEditor, { document, shot, cues, onUpdateShot: () => {} }));
    expect(html).toContain(`编辑镜头 ${shot.index}`);
    for (const label of ['画面', '动作 / 运镜', '起始状态', '结束状态', '画面方向 / 视线', '动作节拍', '对白与旁白']) expect(html).toContain(label);
    expect(html).toContain(shot.title);
    for (const cue of cues) expect(html).toContain(cue.text);
  });
  it('renders a compact shot header and a supplied resolved preview before authoring text', () => {
    const html = renderToStaticMarkup(createElement(MotionComicSceneShotEditor, { document, shot, cues, preview: createElement('img', { src: '/resolved-shot.png', alt: '已选镜头画面' }), hasPreview: true }));
    expect(html).toContain(`镜头${String(shot.index).padStart(2, '0')}`);
    expect(html).toContain(`aria-label="编辑镜头 ${shot.index}"`);
    expect(html).toContain('景别');
    expect(html).toContain('时长');
    expect(html).toContain('已有画面');
    expect(html).toContain('src="/resolved-shot.png"');
    expect(html.indexOf('comic-scene-shot__thumbnail')).toBeLessThan(html.indexOf('comic-scene-shot__content'));
    expect(html).not.toContain('暂无镜头画面');
    expect(html).not.toContain('已核对');
  });
  it('keeps optional preview status explicit and continuity and references in collapsed details', () => {
    const html = renderToStaticMarkup(createElement(MotionComicSceneShotEditor, { document, shot, cues }));
    expect(html).toContain('暂无镜头画面');
    expect(html).not.toContain('已有画面');
    expect(html).not.toContain('待生成画面');
    expect(html).toContain('<details class="comic-scene-shot__references"><summary>连续性与资产引用</summary>');
    const details = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
    for (const label of ['起始状态', '结束状态', '画面方向 / 视线', '动作节拍', '角色造型', '场景 / 道具']) expect(details).toContain(label);
    expect(details).not.toContain(shot.prompt);
    const pending = renderToStaticMarkup(createElement(MotionComicSceneShotEditor, { document, shot, cues: [], hasPreview: false }));
    expect(pending).toContain('待生成画面');
    expect(pending).toContain('本镜未配置对白或旁白');
  });
  it('retains millisecond precision and rejects invalid persisted durations', () => {
    const draft = createSceneShotDraft(shot, cues);
    for (const duration of ['', ' ', 'NaN', 'Infinity', '0', '-2', '61', '0.0001']) expect(validateSceneShotDraft({ ...draft, duration }).duration).toBeTruthy();
    expect(sceneShotDraftPatch(draft, { ...draft, duration: '3.125' })).toEqual({ durationMs: 3125 });
  });
  it('only submits changed authoring fields, preserving unrelated production references', () => {
    const draft = createSceneShotDraft(shot, cues);
    expect(sceneShotDraftPatch(draft, draft)).toEqual({});
    expect(sceneShotDraftPatch(draft, { ...draft, title: ' 修改后的标题 ' })).toEqual({ title: '修改后的标题' });
  });
  it('requires complete continuity when any continuity field is supplied', () => {
    const draft = { ...createSceneShotDraft(shot, cues), startState: '站在门口', endState: '', screenDirection: '', actionBeats: '' };
    const errors = validateSceneShotDraft(draft);
    expect(errors.endState).toBeTruthy();
    expect(errors.screenDirection).toBeTruthy();
    expect(errors.actionBeats).toBeTruthy();
    const complete = { ...draft, endState: '进入房间', screenDirection: '向右', actionBeats: ' 推门 \n\n 进入房间 ' };
    expect(validateSceneShotDraft(complete)).toEqual({});
    const cleared = { ...complete, startState: '', endState: '', screenDirection: '', actionBeats: '' };
    expect(Object.keys(validateSceneShotDraft(cleared, complete))).toEqual(['startState', 'endState', 'screenDirection', 'actionBeats']);
    expect(sceneShotDraftPatch(createSceneShotDraft(shot, cues), complete).continuity).toEqual({ startState: '站在门口', endState: '进入房间', screenDirection: '向右', actionBeats: ['推门', '进入房间'] });
  });
  it('rejects empty dialogue without changing cue identity or timing', () => {
    const draft = createSceneShotDraft(shot, cues);
    expect(validateSceneShotDraft({ ...draft, dialogue: { cue: ' ' } })['cue:cue']).toBeTruthy();
    expect(sceneShotDraftPatch(draft, { ...draft, dialogue: { cue: '新对白' } })).toEqual({});
  });
});
