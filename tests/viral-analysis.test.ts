import { describe, expect, it, vi } from 'vitest';
import {
  buildViralBreakdownPrompt,
  buildViralRecreationPrompt,
  createViralProductionTaskInput,
  detectViralPlatform,
  normalizeViralSourceUrl,
  runViralAnalysis,
} from '@shared/viral-analysis';
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

    expect(prompt).toContain('结构级复刻');
    expect(prompt).toContain('不要逐句照搬');
    expect(prompt).toContain('不要复用原标题');
    expect(prompt).toContain('CreateTaskInput');
  });

  it('converts a recreation result into a normal production task input', () => {
    const task = createViralProductionTaskInput(makeViralResult(), {
      title: '复刻任务',
      track: 'ecommerce',
      style: 'photo-real',
      ratio: '9:16',
      templateId: 'default-portrait-9-16',
    });

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
      opening: { type: '亮点前置', analysis: 'Starts with the best result.', reusablePattern: 'Lead with the result.' },
      structure: { type: '递进结构', analysis: 'Builds from pain to solution.', outline: ['pain', 'solution'] },
      ending: { type: '引导型结尾', analysis: 'Invites action.', reusablePattern: 'Ask for saves.' },
      viralPoint: { summary: 'Simple useful solution.', evidence: ['clear contrast'], reusablePattern: 'Show before and after.' },
    },
    recreation: {
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
