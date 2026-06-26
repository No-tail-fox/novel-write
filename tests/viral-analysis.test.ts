import { describe, expect, it, vi } from 'vitest';
import {
  buildViralBreakdownPrompt,
  buildViralRecreationPrompt,
  createViralProductionTaskInput,
  detectViralPlatform,
  normalizeViralSourceUrl,
  runViralAnalysis,
} from '@shared/viral-analysis';
import { createViralTemplateDrafts } from '@shared/viral-template-extraction';
import type { ViralAnalysisResult } from '@shared/types';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('viral analysis helpers', () => {
  it('detects the first supported Chinese short-video platforms', () => {
    expect(detectViralPlatform('https://www.douyin.com/video/123')).toBe('douyin');
    expect(detectViralPlatform('https://v.kuaishou.com/abc')).toBe('kuaishou');
    expect(detectViralPlatform('https://www.bilibili.com/video/BV1xx411c7mD')).toBe('bilibili');
    expect(detectViralPlatform('https://example.com/video/123')).toBe('unknown');
  });

  it('normalizes Douyin jingxuan modal links to concrete video links', () => {
    expect(normalizeViralSourceUrl('https://www.douyin.com/jingxuan?modal_id=7637518006653963529', 'douyin')).toBe(
      'https://www.douyin.com/video/7637518006653963529',
    );
    expect(normalizeViralSourceUrl('https://www.bilibili.com/video/BV1xx411c7mD', 'bilibili')).toBe(
      'https://www.bilibili.com/video/BV1xx411c7mD',
    );
  });

  it('records internal downloader metadata after source download', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-download-event-'));
    const events: Array<{ type: string; stage: string; data?: unknown }> = [];

    try {
      await runViralAnalysis(
        {
          id: 'viral-download-event',
          url: 'https://www.douyin.com/video/123',
          platform: 'douyin',
          title: '',
          status: 'pending',
          currentStage: 'queued',
          progress: 0,
          settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
          resultPath: '',
          videoPath: '',
          errorMessage: '',
          createdAt: '2026-06-02T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
          lastHeartbeatAt: null,
        },
        {
          workDir: dir,
          emit: async (event) => {
            events.push({ type: event.type, stage: event.stage, data: event.data });
          },
          download: async () => ({
            source: makeViralResult().source,
            videoPath: join(dir, 'video.mp4'),
            provider: 'douyin-internal',
            normalizedUrl: 'https://www.douyin.com/video/123',
            usedCookieSource: 'none',
            raw: { itemId: '123' },
          }),
          extract: async () => ({
            audioPath: join(dir, 'audio.wav'),
            frames: [],
          }),
          transcribe: async () => makeViralResult().transcript,
          analyzeFrame: async () => makeViralResult().frames[0],
          analyzeBreakdown: async () => makeViralResult().contentBreakdown,
          createRecreation: async () => makeViralResult().recreation,
        },
      );

      expect(events).toContainEqual({
        type: 'stage_done',
        stage: 'downloading',
        data: {
          provider: 'douyin-internal',
          normalizedUrl: 'https://www.douyin.com/video/123',
          usedCookieSource: 'none',
          metadataTitle: 'Original title',
        },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds the required four-part viral breakdown prompt without comment collection', () => {
    const prompt = buildViralBreakdownPrompt({
      title: 'Sample viral clip',
      author: 'creator',
      transcriptText: 'Opening line. Middle line. Ending line.',
      frameSummary: '0s: close shot with strong text overlay.',
    });

    for (const text of [
      '开头',
      '结构',
      '结尾',
      '爆点',
      '开门见山',
      '引用金句',
      '亮点前置',
      '抛出观点',
      '总分结构',
      '递进结构',
      '平行结构',
      '总结型结尾',
      '引导型结尾',
      '预告型结尾',
      '不要采集或假设评论区',
    ]) {
      expect(prompt).toContain(text);
    }
  });

  it('builds a structure-level recreation prompt that forbids direct copying', () => {
    const prompt = buildViralRecreationPrompt({
      track: 'ecommerce',
      extraRequirements: 'Make it suitable for a local shop.',
      result: makeViralResult(),
    });

    expect(prompt).toContain('formula');
    expect(prompt).toContain('templatePrompt');
    expect(prompt).toContain('storyCore');
    expect(prompt).toContain('storyContent');
    expect(prompt).toContain('main');
    expect(prompt).toContain('title');
    expect(prompt).toContain('cover');
    expect(prompt).toContain('opening');
    expect(prompt).toContain('structure');
    expect(prompt).toContain('ending');
    expect(prompt).toContain('strict JSON');
    expect(prompt).toContain('结构级复刻');
    expect(prompt).toContain('不要逐句照搬');
    expect(prompt).toContain('不要复用原标题');
    expect(prompt).toContain('storyContent');
  });

  it('uses storyContent as the production input when script is empty', () => {
    const result = {
      ...makeViralResult(),
      recreation: {
        ...makeViralResult().recreation,
        script: '',
        storyContent: 'A concrete story draft for production.',
        templatePrompt: 'Template prompt for reuse.',
        formula: {
          main: 'Main formula',
          title: 'Title formula',
          cover: 'Cover formula',
          opening: 'Opening formula',
          structure: 'Structure formula',
          ending: 'Ending formula',
        },
        storyCore: {
          who: 'Someone',
          where: 'Somewhere',
          whatHappened: 'Something happened',
          why: 'Because of something',
          turningPoint: 'A turning point',
          result: 'A result',
        },
      },
    } as any;

    const task = createViralProductionTaskInput(result, {
      title: '复刻任务',
      track: 'ecommerce',
      style: 'photo-real',
      ratio: '9:16',
      templateId: 'default-portrait-9-16',
    });

    expect(task.inputText).toBe('A concrete story draft for production.');
  });

  it('converts a recreation result into a normal production task input', () => {
    const task = createViralProductionTaskInput(
      {
        ...makeViralResult(),
        frames: [
          {
            timestamp: 0,
            framePath: 'frame-0001.jpg',
            shotType: '特写',
            cameraMovement: '固定',
            composition: '中心构图',
            transition: 'cut',
            textOverlay: null,
            visualDescription: 'Opening shot.',
            mood: '紧张',
            keyElements: ['人物'],
            imagePrompt: '中文生图提示词：开场特写，中心构图，大字标题',
          },
          {
            timestamp: 6,
            framePath: 'frame-0002.jpg',
            shotType: '中景',
            cameraMovement: '推近',
            composition: '三分法',
            transition: 'cut',
            textOverlay: null,
            visualDescription: 'Midpoint shot.',
            mood: '缓和',
            keyElements: ['产品'],
            imagePrompt: '中文生图提示词：中段产品展示，三分构图，干净字幕',
          },
        ],
      },
      {
      title: '复刻任务',
      track: 'ecommerce',
      style: 'photo-real',
      ratio: '9:16',
      templateId: 'default-portrait-9-16',
      },
    );

    expect(task).toMatchObject({
      title: '复刻任务',
      inputText: 'A fresh structure-level script.',
      track: 'ecommerce',
      style: 'photo-real',
      ratio: '9:16',
      templateId: 'default-portrait-9-16',
      mode: 'paste',
      storyboardSceneCount: 12,
    });
    expect(task.extraRequirements).toContain('结构级复刻');
    expect(task.imagePromptReference).toContain('中文生图提示词：开场特写，中心构图，大字标题');
    expect(task.imagePromptReference).toContain('中文生图提示词：中段产品展示，三分构图，干净字幕');
  });

  it('creates user-named story and image templates from a viral result', () => {
    const result: ViralAnalysisResult = {
      ...makeViralResult(),
      frames: [
        {
          timestamp: 1,
          framePath: 'frame-1.jpg',
          shotType: 'close-up',
          cameraMovement: 'push in',
          composition: 'centered product and large headline',
          transition: 'hard cut',
          textOverlay: 'Save this',
          visualDescription: 'Bright shop counter with a before and after contrast.',
          mood: 'urgent and useful',
          keyElements: ['shop counter', 'headline', 'before after'],
          imagePrompt: 'photo-real short video frame, centered shop counter, bold headline',
        },
      ],
    };

    const drafts = createViralTemplateDrafts(result, {
      storyTemplateName: 'My story pattern',
      imageTemplateName: 'My image pattern',
      track: 'ecommerce',
      style: 'photo-real',
      draftTemplateId: 'default-portrait-9-16',
      now: '2026-06-17T00:00:00.000Z',
      storyTemplateId: 'story-id',
      imageTemplateId: 'image-id',
    });

    expect(drafts.storyTemplate.name).toBe('My story pattern');
    expect(drafts.imageTemplate.name).toBe('My image pattern');
    expect(drafts.storyTemplate.type).toBe('task');
    expect(drafts.storyTemplate.baseTrack).toBe('ecommerce');
    expect(drafts.storyTemplate.defaultStyles).toEqual(['image-id']);
    expect(drafts.storyTemplate.defaultDraftTemplateId).toBe('default-portrait-9-16');
    expect(drafts.storyTemplate.content).toContain('公式层');
    expect(drafts.storyTemplate.content).toContain('主公式');
    expect(drafts.storyTemplate.content).toContain('templatePrompt');
    expect(drafts.storyTemplate.content).toContain('storyCore');
    expect(drafts.storyTemplate.content).toContain('storyContent');
    expect(drafts.storyTemplate.content).toContain('爆款公式化模板');
    expect(drafts.storyTemplate.content).toContain('故事事实模板');
    expect(drafts.storyTemplate.content).toContain('故事主线');
    expect(drafts.storyTemplate.content).toContain('情节钩子');
    expect(drafts.storyTemplate.content).toContain('场景事实');
    expect(drafts.storyTemplate.content).toContain('人物/关系');
    expect(drafts.storyTemplate.content).toContain('结果/变化');
    expect(drafts.storyTemplate.content).toContain('标准提示词模板');
    expect(drafts.storyTemplate.content).toContain('{{newTopic}}');
    expect(drafts.storyTemplate.content).toContain('{{targetAudience}}');
    expect(drafts.storyTemplate.content).toContain('{{desiredOutcome}}');
    expect(drafts.storyTemplate.content).toContain('原文案结构模板');
    expect(drafts.storyTemplate.content).toContain('开头段');
    expect(drafts.storyTemplate.content).toContain('中段推进');
    expect(drafts.storyTemplate.content).toContain('结尾段');
    expect(drafts.storyTemplate.content).toContain('{{inputText}}');
    expect(drafts.storyTemplate.content).not.toContain('{{taskTemplateContent}}');
    expect(drafts.storyTemplate.content).toContain('Lead with the result.');
    expect(drafts.storyTemplate.content).toContain('Show before and after.');
    expect(drafts.storyTemplate.content).not.toContain('目标字数/目标分镜数自审');
    expect(drafts.storyTemplate.content).toContain('不要照抄原文');
    expect(Object.keys(drafts.storyTemplate.stepPrompts ?? {}).sort()).toEqual(['cover', 'image-prompt', 'review', 'rewrite', 'storyboard']);
    for (const [step, content] of Object.entries(drafts.storyTemplate.stepPrompts ?? {})) {
      expect(content, `storyTemplate.stepPrompts.${step}`).not.toContain('目标字数/目标分镜数自审');
    }
    expect(drafts.storyTemplate.stepPrompts?.review).toContain('Step 0 预审');
    expect(drafts.storyTemplate.stepPrompts?.review).toContain('{{inputText}}');
    expect(drafts.storyTemplate.stepPrompts?.review).toContain('{{taskTemplateContent}}');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('文案提示词模板');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('标准提示词模板');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('故事内容要求');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('{{newTopic}}');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('尽量贴合原文案结构');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('段落数量');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('句式功能');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('开头公式');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('结构公式');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('转折/递进公式');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('结尾公式');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('爆点迁移规则');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('禁止照抄原文');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('{{reviewedText}}');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).not.toContain('{{targetLengthRange}}');
    expect(drafts.storyTemplate.stepPrompts?.rewrite).toContain('{{extraRequirements}}');
    expect(drafts.storyTemplate.stepPrompts?.cover).toContain('标题公式');
    expect(drafts.storyTemplate.stepPrompts?.cover).toContain('封面公式');
    expect(drafts.storyTemplate.stepPrompts?.cover).toContain('{{reviewedText}}');
    expect(drafts.storyTemplate.stepPrompts?.cover).not.toContain('{{rewrittenCopy}}');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).toContain('分镜公式');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).toContain('{{rewrittenCopy}}');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).not.toContain('{{targetLengthRange}}');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).not.toContain('{{targetScenes}}');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).toContain('JSON 字符串数组');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).toContain('尾部锚点');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).not.toContain('Strict output shape: {"scenes"');
    expect(drafts.storyTemplate.stepPrompts?.storyboard).not.toContain('descPrompt');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).not.toContain('生图提示词模板');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('抽帧提示词模板');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('{{visualSubject}}');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('{{visualScene}}');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('保留风格，不保留原主题');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('构图公式');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('镜头公式');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('文字层级公式');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('关键帧抽象');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('角色/产品一致性');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('安全规则');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('{{imagePromptReference}}');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('{{stylePrefix}}');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('{{styleSuffix}}');
    expect(drafts.storyTemplate.stepPrompts?.['image-prompt']).toContain('{{styleNegativePrompt}}');
    expect(drafts.imageTemplate.prefix).toContain('通用画面样式模板');
    expect(drafts.imageTemplate.prefix).toContain('图片模板风格');
    expect(drafts.imageTemplate.prefix).toContain('{{visualSubject}}');
    expect(drafts.imageTemplate.prefix).toContain('{{visualScene}}');
    expect(drafts.imageTemplate.description).toContain('通用画面样式');
    expect(drafts.imageTemplate.description).not.toContain('Original title');
    expect(drafts.imageTemplate.suffix).toContain('保留构图、镜头、光线、质感和情绪');
    expect(drafts.imageTemplate.suffix).toContain('不要复刻原主题');
    expect(drafts.imageTemplate.suffix).not.toContain('Original title');
    expect(drafts.imageTemplate.negativePrompt).toContain('照抄原视频文字');
    expect(drafts.imageTemplate.prefix).not.toContain('photo-real short video frame');
    expect(drafts.imageTemplate.prefix).not.toContain('Save this');
    expect(drafts.imageTemplate.suffix).not.toContain('photo-real short video frame');
    expect(drafts.imageTemplate.suffix).not.toContain('Save this');
    expect(drafts.imageTemplate.prefix).not.toContain('centered product and large headline');
    expect(drafts.imageTemplate.suffix).not.toContain('centered product and large headline');
  });

  it('puts source transcript and frame details into the recreation prompt so story content is concrete', () => {
    const prompt = buildViralRecreationPrompt({
      track: 'ecommerce',
      extraRequirements: 'Make it suitable for a local shop.',
      result: makeViralResult(),
    });

    expect(prompt).toContain('原视频标题');
    expect(prompt).toContain('原视频逐字稿');
    expect(prompt).toContain('原视频画面摘要');
    expect(prompt).toContain('故事内容要求');
    expect(prompt).toContain('先抽出故事事实层');
    expect(prompt).toContain('必须写成具体可讲述的故事');
    expect(prompt).toContain('故事主线');
    expect(prompt).toContain('情节钩子');
  });

  it('passes the requested keyframe count and source duration into frame extraction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-keyframes-'));
    const firstFrame = join(dir, 'frame-0001.jpg');
    const secondFrame = join(dir, 'frame-0002.jpg');
    await writeFile(firstFrame, 'frame-one-bytes');
    await writeFile(secondFrame, 'frame-two-bytes');

    const extract = vi.fn(async (_videoPath: string, _workDir: string, _signal?: AbortSignal, request?: { keyFrameCount: number; sourceDurationSeconds: number }) => {
      expect(request).toEqual({ keyFrameCount: 10, sourceDurationSeconds: 30 });
      return {
        audioPath: join(dir, 'audio.wav'),
        frames: [
          { timestamp: 0, framePath: firstFrame },
          { timestamp: 15, framePath: secondFrame },
        ],
      };
    });

    try {
      await runViralAnalysis(
        {
          id: 'viral-keyframes',
          url: 'https://www.douyin.com/video/123',
          platform: 'douyin',
          title: '',
          status: 'pending',
          currentStage: 'queued',
          progress: 0,
          settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16', keyFrameCount: 10 },
          resultPath: '',
          videoPath: '',
          errorMessage: '',
          createdAt: '2026-06-02T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
          lastHeartbeatAt: null,
        },
        {
          workDir: dir,
          emit: async () => {},
          download: async () => ({
            source: makeViralResult().source,
            videoPath: join(dir, 'video.mp4'),
            provider: 'douyin-internal',
            normalizedUrl: 'https://www.douyin.com/video/123',
            usedCookieSource: 'none',
          }),
          extract,
          transcribe: async () => makeViralResult().transcript,
          analyzeFrame: async (frame) => ({
            timestamp: frame.timestamp,
            framePath: frame.framePath,
            shotType: '中景',
            cameraMovement: '固定',
            composition: '中心构图',
            transition: 'cut',
            textOverlay: null,
            visualDescription: 'frame analysis',
            mood: 'tense',
            keyElements: ['character'],
            imagePrompt: `frame prompt ${frame.timestamp}s`,
          }),
          analyzeBreakdown: async () => makeViralResult().contentBreakdown,
          createRecreation: async () => makeViralResult().recreation,
        },
      );

      expect(extract).toHaveBeenCalledTimes(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs the viral analysis pipeline with injected media and model providers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-run-'));
    const framePath = join(dir, 'frame.jpg');
    await writeFile(framePath, 'single-frame-bytes');
    const events: string[] = [];

    try {
      const completed = await runViralAnalysis(
        {
          id: 'viral-1',
          url: 'https://www.douyin.com/video/123',
          platform: 'douyin',
          title: '',
          status: 'pending',
          currentStage: 'queued',
          progress: 0,
          settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
          resultPath: '',
          videoPath: '',
          errorMessage: '',
          createdAt: '2026-06-02T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
          lastHeartbeatAt: null,
        },
        {
          workDir: dir,
          emit: async (event) => {
            events.push(`${event.type}:${event.stage}`);
          },
          download: async () => ({
            source: makeViralResult().source,
            videoPath: join(dir, 'video.mp4'),
            provider: 'douyin-internal',
            normalizedUrl: 'https://www.douyin.com/video/123',
            usedCookieSource: 'none',
          }),
          extract: async () => ({
            audioPath: join(dir, 'audio.wav'),
            frames: [{ timestamp: 0, framePath }],
          }),
          transcribe: async () => makeViralResult().transcript,
          analyzeFrame: async () => makeViralResult().frames[0] ?? {
            timestamp: 0,
            framePath,
            shotType: '特写',
            cameraMovement: '固定',
            composition: '中心构图',
            transition: '无',
            textOverlay: '爆款标题',
            visualDescription: 'A strong opening frame.',
            mood: '紧张',
            keyElements: ['人物', '字幕'],
            imagePrompt: '中文生图提示词：强开头画面，大字标题，中心构图',
          },
          analyzeBreakdown: async () => makeViralResult().contentBreakdown,
          createRecreation: async () => makeViralResult().recreation,
        },
      );

      expect(events).toEqual([
        'stage_start:downloading',
        'stage_done:downloading',
        'stage_start:extracting',
        'stage_start:transcribing',
        'stage_start:analyzing_frames',
        'stage_start:breaking_down',
        'stage_start:recreating',
        'done:completed',
      ]);
      expect(completed.result.recreation.script).toBe('A fresh structure-level script.');
      expect(JSON.parse(await readFile(completed.resultPath, 'utf8')).recreation.script).toBe('A fresh structure-level script.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('analyzes only unique extracted frame images for prompt breakdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-unique-frames-'));
    const firstFrame = join(dir, 'frame-0001.jpg');
    const duplicateFrame = join(dir, 'frame-0002.jpg');
    const differentFrame = join(dir, 'frame-0003.jpg');
    await writeFile(firstFrame, 'same-image-bytes');
    await writeFile(duplicateFrame, 'same-image-bytes');
    await writeFile(differentFrame, 'different-image-bytes');

    const analyzeFrame = vi.fn(async (frame: { timestamp: number; framePath: string }) => ({
      timestamp: frame.timestamp,
      framePath: frame.framePath,
      shotType: '中景',
      cameraMovement: '固定镜头',
      composition: '中心构图',
      transition: '硬切',
      textOverlay: '原画面字幕',
      visualDescription: '中文画面解析',
      mood: '紧张',
      keyElements: ['人物', '大字标题'],
      imagePrompt: `中文生图提示词：${frame.timestamp}s 画面`,
    }));

    try {
      const completed = await runViralAnalysis(
        {
          id: 'viral-unique-frames',
          url: 'https://www.douyin.com/video/123',
          platform: 'douyin',
          title: '',
          status: 'pending',
          currentStage: 'queued',
          progress: 0,
          settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
          resultPath: '',
          videoPath: '',
          errorMessage: '',
          createdAt: '2026-06-02T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
          lastHeartbeatAt: null,
        },
        {
          workDir: dir,
          download: async () => ({
            source: makeViralResult().source,
            videoPath: join(dir, 'video.mp4'),
            provider: 'douyin-internal',
            normalizedUrl: 'https://www.douyin.com/video/123',
            usedCookieSource: 'none',
          }),
          extract: async () => ({
            audioPath: join(dir, 'audio.wav'),
            frames: [
              { timestamp: 0, framePath: firstFrame },
              { timestamp: 3, framePath: duplicateFrame },
              { timestamp: 6, framePath: differentFrame },
            ],
          }),
          transcribe: async () => makeViralResult().transcript,
          analyzeFrame,
          analyzeBreakdown: async () => makeViralResult().contentBreakdown,
          createRecreation: async () => makeViralResult().recreation,
        },
      );

      expect(analyzeFrame).toHaveBeenCalledTimes(2);
      expect(analyzeFrame.mock.calls.map(([frame]) => frame.timestamp)).toEqual([0, 6]);
      expect(completed.result.frames.map((frame) => frame.timestamp)).toEqual([0, 6]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('emits progress updates while analyzing multiple unique frames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-viral-progress-'));
    const firstFrame = join(dir, 'frame-0001.jpg');
    const secondFrame = join(dir, 'frame-0002.jpg');
    await writeFile(firstFrame, 'frame-one-bytes');
    await writeFile(secondFrame, 'frame-two-bytes');
    const events: Array<{ type: string; stage: string; detail: string; progress?: number }> = [];

    try {
      await runViralAnalysis(
        {
          id: 'viral-progress',
          url: 'https://www.douyin.com/video/123',
          platform: 'douyin',
          title: '',
          status: 'pending',
          currentStage: 'queued',
          progress: 0,
          settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
          resultPath: '',
          videoPath: '',
          errorMessage: '',
          createdAt: '2026-06-02T00:00:00.000Z',
          startedAt: null,
          completedAt: null,
          lastHeartbeatAt: null,
        },
        {
          workDir: dir,
          emit: async (event) => {
            events.push({ type: event.type, stage: event.stage, detail: event.detail, progress: event.progress });
          },
          download: async () => ({
            source: makeViralResult().source,
            videoPath: join(dir, 'video.mp4'),
            provider: 'douyin-internal',
            normalizedUrl: 'https://www.douyin.com/video/123',
            usedCookieSource: 'none',
          }),
          extract: async () => ({
            audioPath: join(dir, 'audio.wav'),
            frames: [
              { timestamp: 0, framePath: firstFrame },
              { timestamp: 3, framePath: secondFrame },
            ],
          }),
          transcribe: async () => makeViralResult().transcript,
          analyzeFrame: async (frame) => ({
            timestamp: frame.timestamp,
            framePath: frame.framePath,
            shotType: 'medium shot',
            cameraMovement: 'static',
            composition: 'centered',
            transition: 'cut',
            textOverlay: 'headline text',
            visualDescription: 'frame analysis',
            mood: 'tense',
            keyElements: ['character', 'title'],
            imagePrompt: `frame prompt ${frame.timestamp}s`,
          }),
          analyzeBreakdown: async () => makeViralResult().contentBreakdown,
          createRecreation: async () => makeViralResult().recreation,
        },
      );

      const frameProgressEvents = events.filter((event) => event.stage === 'analyzing_frames');
      expect(frameProgressEvents.some((event) => event.type === 'stage_progress')).toBe(true);
      expect(frameProgressEvents.some((event) => event.detail.includes('1/2'))).toBe(true);
      expect(frameProgressEvents.some((event) => event.detail.includes('2/2'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });


});

function makeViralResult(): ViralAnalysisResult {
  return {
    source: {
      platform: 'douyin',
      url: 'https://www.douyin.com/video/123',
      videoPath: 'video.mp4',
      coverPath: 'cover.jpg',
      title: 'Original title',
      author: 'creator',
      duration: 30,
      stats: { likes: 1000, comments: 20, shares: 30 },
      normalizedUrl: 'https://www.douyin.com/video/123',
      downloadProvider: 'douyin-internal',
      usedCookieSource: 'none',
    },
    transcript: [{ text: 'Original transcript.', start: 0, end: 2, words: [] }],
    frames: [],
    contentBreakdown: {
      topic: 'Local shop topic',
      title: { original: 'Original title', pattern: 'Pain point first', suggestions: ['New title'] },
      cover: { observed: 'Face and text', pattern: 'High contrast', suggestions: ['New cover'] },
      opening: { type: '浜偣鍓嶇疆', analysis: 'Starts with the best result.', reusablePattern: 'Lead with the result.' },
      structure: { type: '閫掕繘缁撴瀯', analysis: 'Builds from pain to solution.', outline: ['pain', 'solution'] },
      ending: { type: '寮曞鍨嬬粨灏?', analysis: 'Invites action.', reusablePattern: 'Ask for saves.' },
      viralPoint: { summary: 'Simple useful solution.', evidence: ['clear contrast'], reusablePattern: 'Show before and after.' },
    },
    recreation: {
      formula: {
        main: 'Use the same emotional arc with a new topic.',
        title: 'Pain point first',
        cover: 'High contrast',
        opening: 'Lead with the result.',
        structure: 'Builds from pain to solution.',
        ending: 'Ask for saves.',
      },
      templatePrompt: 'Keep the structure and replace the topic.',
      storyCore: {
        who: 'A local shop owner',
        where: 'At the counter',
        whatHappened: 'A customer problem appeared',
        why: 'The old method failed',
        turningPoint: 'A better method showed up',
        result: 'The problem was solved',
      },
      storyContent: 'A fresh structure-level script.',
      blueprint: 'Use the same emotional arc with a new topic.',
      openingOptions: ['Show the result first.'],
      titleOptions: ['New title'],
      coverIdeas: ['New cover idea'],
      script: 'A fresh structure-level script.',
      storyboardHints: ['result', 'pain', 'solution'],
      taskDefaults: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', storyboardSceneCount: 12 },
    },
    createdAt: '2026-06-02T00:00:00.000Z',
  };
}
