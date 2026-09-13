import { describe, expect, it } from 'vitest';
import { buildDirectorCopyAssistRequest, normalizeDirectorCopyAssistError } from '../src/features/director-desk/director-copy-assist';

describe('Director create copy assistance', () => {
  it('builds a VOX creation request from the project title', () => {
    const request = buildDirectorCopyAssistRequest({
      mode: 'vox',
      intent: 'create',
      title: '城市旧书店为何消失',
      copy: '',
    });

    expect(request).toMatchObject({
      keyword: '城市旧书店为何消失',
      selectedSources: [],
      useBuiltinKnowledge: true,
      targetLength: 90,
    });
    expect(request.extraRequirements).toContain('30 秒解释型视频');
    expect(request.extraRequirements).toContain('钩子、背景、证据和结论');
  });

  it('uses the current VOX draft as the only revision source', () => {
    const request = buildDirectorCopyAssistRequest({
      mode: 'vox',
      intent: 'revise',
      title: '城市旧书店为何消失',
      copy: '旧书店正在消失。',
    });

    expect(request.useBuiltinKnowledge).toBe(false);
    expect(request.selectedSources).toEqual([expect.objectContaining({
      source: 'user-draft',
      title: '当前原始文案',
      content: '旧书店正在消失。',
    })]);
    expect(request.extraRequirements).toContain('不添加未经原文支持的事实');
  });

  it('scales VOX copy guidance with the selected starter duration', () => {
    const short = buildDirectorCopyAssistRequest({ mode: 'vox', intent: 'create', title: '短片', copy: '', durationMs: 15_000 });
    const long = buildDirectorCopyAssistRequest({ mode: 'vox', intent: 'create', title: '长片', copy: '', durationMs: 60_000 });
    expect(short.targetLength).toBe(45);
    expect(short.extraRequirements).toContain('15 秒解释型视频');
    expect(long.targetLength).toBe(180);
    expect(long.extraRequirements).toContain('60 秒解释型视频');
  });

  it('keeps full-length revisions tied to the complete source instead of a short preset', () => {
    const copy = '完整事实与上下文。'.repeat(800);
    const request = buildDirectorCopyAssistRequest({ mode: 'vox', intent: 'revise', title: '全文', copy, durationMs: 'auto' });
    expect(request.targetLength).toBe(copy.length);
    expect(request.selectedSources[0].content).toBe(copy);
    expect(request.extraRequirements).toContain('不为固定视频时长删减内容');
    expect(request.extraRequirements).not.toContain('30 秒');
  });

  it('keeps motion-comic creation concise and conflict-driven', () => {
    const request = buildDirectorCopyAssistRequest({
      mode: 'motion-comic',
      intent: 'create',
      title: '雨夜来信',
      copy: '',
    });

    expect(request).toMatchObject({
      keyword: '雨夜来信',
      selectedSources: [],
      useBuiltinKnowledge: true,
      targetLength: 90,
    });
    expect(request.extraRequirements).toContain('60-120 字');
    expect(request.extraRequirements).toContain('主角、异常事件、核心冲突');
    expect(request.extraRequirements).toContain('不要扩写成完整剧本');
  });

  it('rejects missing creation and revision inputs', () => {
    expect(() => buildDirectorCopyAssistRequest({ mode: 'vox', intent: 'create', title: ' ', copy: '' })).toThrow('请先填写项目标题');
    expect(() => buildDirectorCopyAssistRequest({ mode: 'motion-comic', intent: 'revise', title: '雨夜来信', copy: ' ' })).toThrow('请先填写需要修改的核心设定');
  });

  it('turns unknown LLM failures into an actionable message', () => {
    const error = normalizeDirectorCopyAssistError(new Error('provider failed'));

    expect(error.code).toBe('DIRECTOR_COPY_ASSIST_FAILED');
    expect(error.message).toContain('LLM 配置与网络');
  });
});
