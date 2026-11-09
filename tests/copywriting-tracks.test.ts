import { describe, expect, it } from 'vitest';
import { COPYWRITING_TRACKS, buildCopywritingGuidance, copywritingTrack } from '../src/shared/copywriting-tracks';
import { buildStoryboundAiCreationSystemPrompt, buildStoryboundReviewSystemPrompt, composeCopyFromSources } from '../src/shared/research';
import { researchCopyComposeSchema } from '../src/shared/ipc-contract';
import { buildDirectorCopyAssistRequest } from '../src/features/director-desk/director-copy-assist';
import { handoffCopyToVideo, readCopyStudioDocument, writeCopyStudioDocument } from '../src/features/copy-studio/copy-studio';

const base = { keyword: '测试选题', extraRequirements: '面向新读者，结尾不引导互动。', selectedSources: [{ source: 'user', title: '资料', content: '已有的素材与事实。' }], useBuiltinKnowledge: false };

describe('content genre prompt integration', () => {
  it.each(COPYWRITING_TRACKS)('delivers $label guidance to the actual model for drafting and refinement', async (track) => {
    for (const intent of ['draft', 'refine', 'track'] as const) {
      const input = researchCopyComposeSchema.parse({ ...base, track: track.id, intent });
      await composeCopyFromSources({ protocol: 'openai', run: async request => {
        expect(request.messages[0].content).toContain('【当前赛道】' + track.label);
        expect(request.messages[0].content).toContain(track.guidance);
        expect(request.messages[0].content).toContain('不强制点赞、关注、转发或购买');
        expect(request.messages[1].content).toContain(base.extraRequirements);
        expect(request.messages[1].content).toContain(base.selectedSources[0].content);
        if (intent !== 'draft') expect(request.messages[1].content).toContain('保留原有事实与核心意思');
        return { text: '可直接使用的正文。', raw: '', requestId: null };
      } }, input);
    }
  });

  it.each([['folk-story', 'folk-tale'], ['人物故事', 'character-story'], ['心灵鸡汤', 'inspirational'], ['food-v2', 'food-vlog']])('resolves legacy genre %s', (old, current) => {
    expect(copywritingTrack(old).id).toBe(current);
    expect(buildCopywritingGuidance(old)).toContain(copywritingTrack(current).guidance);
  });

  it.each(['folk-tale', 'picture-book'])('preserves fiction while separating it from history in %s', (id) => {
    const genre = copywritingTrack(id);
    const system = buildStoryboundAiCreationSystemPrompt({ trackName: genre.label, trackTag: genre.tag, useAiKnowledge: false, hasReferenceMaterials: true });
    expect(system).toContain('可合理虚构情节和对话');
    expect(system).toContain('传说与虚构不能写成史实');
    expect(system).not.toContain('不要引入素材以外的信息');
    const review = buildStoryboundReviewSystemPrompt({ track: id, aiSources: [], targetLength: 500 }, true);
    expect(review).toContain('保留虚构设定、人物关系、伏笔与结局');
    expect(review).toContain('中文故事梗概');
    expect(review).toContain('Schema: {"reviewedText": string}');
  });

  it('keeps old IPC clients valid and gives a custom genre its own name', () => {
    expect(researchCopyComposeSchema.parse(base)).toEqual(base);
    expect(copywritingTrack().id).toBe('general');
    expect(buildCopywritingGuidance('职场沟通')).toContain('【赛道写作规则】职场沟通');
    expect(researchCopyComposeSchema.safeParse({ ...base, track: 'x'.repeat(257) }).success).toBe(false);
    expect(researchCopyComposeSchema.safeParse({ ...base, intent: 'unknown' }).success).toBe(false);
  });

  it('keeps the end of long drafts in actual refinement requests', async () => {
    const copy = '需要保留的原文。'.repeat(600) + '不可丢失的结尾事实。';
    const request = buildDirectorCopyAssistRequest({ mode: 'vox', intent: 'revise', title: '人物', copy, track: 'character-story', durationMs: 'auto' });
    expect(request).toMatchObject({ track: 'character-story', intent: 'refine' });
    await composeCopyFromSources({ protocol: 'openai', run: async input => {
      expect(input.messages[1].content).toContain(copy);
      return { text: copy, raw: '', requestId: null };
    } }, request);
  });

  it('persists custom genres and copy handling, and maps book recommendations into ecommerce production', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    writeCopyStudioDocument(storage, { version: 1, topic: '主题', track: 'custom', customTrack: '职场沟通', skipReview: false, requirements: '', sourceIds: [], sources: [], revisions: [], activeRevisionId: '', updatedAt: '' });
    expect(readCopyStudioDocument(storage)).toMatchObject({ track: 'custom', customTrack: '职场沟通', skipReview: false });
    const handed = handoffCopyToVideo(storage, { title: '书', topic: '书', copy: '定稿', requirements: '保留原句', track: 'book-product', sources: [], skipReview: true }).values;
    expect(handed).toMatchObject({ track: 'ecommerce', publishMode: 'direct-copy', inputText: '定稿' });
    expect(handed.extraRequirements).toContain('保留原句');
    expect(handed.extraRequirements).toContain(copywritingTrack('book-product').guidance);
  });
});
