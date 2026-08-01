import { describe, expect, it } from 'vitest';
import { indexTaskAssetsBySceneId, resolveTaskPreviewContent } from '../src/features/tasks/task-preview-model';
import { draftTemplates } from '../src/shared/templates';

describe('task artifact preview model', () => {
  it('indexes partial generated images by scene id instead of array position', () => {
    const images = [
      { sceneId: 1, path: 'images/1.png' },
      { sceneId: 9, path: 'images/9.png' },
    ];

    const bySceneId = indexTaskAssetsBySceneId(images);

    expect(bySceneId.get(1)?.path).toBe('images/1.png');
    expect(bySceneId.has(2)).toBe(false);
    expect(bySceneId.get(9)?.path).toBe('images/9.png');
  });

  it('uses the same cover overlays and scene caption as draft generation', () => {
    const template = structuredClone(draftTemplates[0]);
    const content = resolveTaskPreviewContent({
      task: { title: '任务标题', track: 'character-story' },
      cover: {
        title: '成片主标题',
        subtitle: ['第一行', '第二行'],
        summary: '摘要',
        tags: [],
        comments: [],
      },
      sceneCap: '当前场景字幕',
      template,
    });

    expect(content).toEqual({
      title: '成片主标题',
      subtitle: '第一行\n第二行',
      caption: '当前场景字幕',
      disclaimer: template.disclaimer.text,
    });
  });

  it('uses the active scene instead of exposing template placeholder copy before cover metadata exists', () => {
    const template = structuredClone(draftTemplates[0]);

    const content = resolveTaskPreviewContent({
      task: { title: '任务标题', track: 'character-story' },
      sceneCap: '当前场景字幕',
      template,
    });

    expect(content.title).toBe('任务标题');
    expect(content.subtitle).toBe('当前场景字幕');
    expect(content.caption).toBe('当前场景字幕');
  });

  it('promotes character-story hook copy instead of showing a bare person name', () => {
    const template = structuredClone(draftTemplates[0]);
    const content = resolveTaskPreviewContent({
      task: { title: '李明博人物故事', track: 'character-story' },
      cover: {
        title: '李明博',
        subtitle: ['他曾靠纸箱充饥', '66岁生日竟赢下大选'],
        summary: '从贫困童年到韩国总统。',
        tags: ['#人物故事', '#李明博'],
        comments: [],
      },
      sourceText: '李明博小时候曾靠纸箱充饥。多年后，李明博在66岁生日当天赢下大选。',
      sceneCap: '66岁生日那天，他收到一份改变余生的礼物。',
      template,
    });

    expect(content.title).toBe('他曾靠纸箱充饥');
    expect(content.subtitle).toBe('66岁生日竟赢下大选');
  });
});
