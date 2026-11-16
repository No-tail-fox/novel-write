import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MotionComicMakeWorkspace } from '../src/features/motion-comic/MotionComicMakeWorkspace';
import { createMotionComicDraft, createMotionComicStarterProject } from '../src/shared/motion-comic';

describe('make workspace unknown submission', () => {
  it('keeps submission blocked while showing reconciliation instead of ongoing generation', () => {
    const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'unknown', title: 'test', premise: 'rain', now: '2026-11-15T00:00:00Z' }));
    const episode = document.episodes[0]; const shot = episode.scenes[0].shots[0];
    const html = renderToStaticMarkup(createElement(MotionComicMakeWorkspace, {
      episode, selectedShotId: shot.id, busy: false, providerConnected: true,
      shots: [{ id: shot.id, index: 1, title: shot.title, scene: '', durationMs: 9000, framing: '', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', videoJobStatus: 'running', videoRecovery: 'unknown' }],
      onSelectShot: () => {}, onUpdateShot: () => {}, onAddShot: () => {}, onRemoveShot: () => {}, onMoveShot: () => {}, onGenerateImage: () => {}, onGenerateVideo: () => {}, renderFrames: () => null, renderWorkflow: () => null, renderCandidates: () => null,
    }));
    const button = (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? []).find(item => item.includes('comic-make__generate'));
    expect(button).toContain('提交结果待核对');
    expect(button).toMatch(/\sdisabled(?:=|\s|>)/u);
    expect(html).not.toContain('正在生成视频');
  });
});
