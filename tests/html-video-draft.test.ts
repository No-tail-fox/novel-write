import { describe, expect, it } from 'vitest';
import { resolveHtmlVideoDraftForRender } from '@shared/html-video-draft';
import { draftTemplates } from '@shared/templates';

describe('HTML video draft output contract', () => {
  it('skips draft output when no draft template is selected', async () => {
    let lookupCalls = 0;

    await expect(resolveHtmlVideoDraftForRender({
      config: {},
      resolveTemplate: async () => {
        lookupCalls += 1;
        return draftTemplates[0];
      },
    })).resolves.toBeUndefined();

    expect(lookupCalls).toBe(0);
  });

  it('resolves the selected canonical draft template by id', async () => {
    const template = {
      ...draftTemplates[0],
      id: 'html-video-draft-a',
      name: 'HTML 视频草稿 A',
      canvas: {
        ...draftTemplates[0].canvas,
        width: 720,
        height: 1280,
      },
      audio: {
        ...draftTemplates[0].audio,
        transitionType: 'wipeleft',
        transitionDurationMs: 430,
      },
    };

    const resolved = await resolveHtmlVideoDraftForRender({
      config: { draftTemplate: template.id },
      resolveTemplate: async (id) => (id === template.id ? template : null),
    });

    expect(resolved).toMatchObject({
      id: template.id,
      canvas: { width: 720, height: 1280 },
      audio: { transitionType: 'wipeleft', transitionDurationMs: 430 },
    });
    expect(resolved).not.toBe(template);
  });

  it('rejects missing selected draft templates instead of falling back', async () => {
    await expect(resolveHtmlVideoDraftForRender({
      config: { draftTemplate: 'deleted-draft-template' },
      resolveTemplate: async () => null,
    })).rejects.toMatchObject({
      code: 'HTML_VIDEO_DRAFT_TEMPLATE_MISSING',
    });
  });
});
