import type { CreateTaskInput, HtmlVideoPipelineData, HtmlVideoScenePlan, HtmlVideoTabKey, Task } from './types';

export const htmlVideoTabs: Array<{ key: HtmlVideoTabKey; label: string }> = [
  { key: 'text', label: '文案' },
  { key: 'assets', label: '素材' },
  { key: 'voice', label: '配音' },
  { key: 'preview', label: '动画预览' },
  { key: 'cover', label: '封面' },
  { key: 'output', label: '出片' },
];

export const htmlVideoSteps = [
  { name: '改写 + 分句', sub: '口播版 + 切分场景' },
  { name: '场景规划', sub: '选版式 / 标题 / 字幕 / 提示词' },
  { name: '素材（图片）', sub: '背景图 / 透明前景图' },
  { name: '配音', sub: '配音旁白' },
  { name: '动画预览', sub: '每场景隐藏窗口渲染' },
  { name: '出片', sub: '逐帧截图后合成视频' },
] as const;

const stepToTab: Record<string, HtmlVideoTabKey> = {
  plan: 'text',
  assets: 'assets',
  voice: 'voice',
  render: 'preview',
  done: 'preview',
};

export function tabForHtmlVideoStep(step: string | undefined): HtmlVideoTabKey {
  return stepToTab[step || 'plan'] ?? 'text';
}

export function parseHtmlVideoPipelineData(value: string | undefined): HtmlVideoPipelineData {
  if (!value?.trim()) return createHtmlVideoPipelineData('', {});
  try {
    const parsed = JSON.parse(value) as Partial<HtmlVideoPipelineData>;
    const scenes = Array.isArray(parsed.scenes) ? parsed.scenes.map(normalizeHtmlVideoScenePlan) : [];
    return {
      scenesPlanned: Number.isFinite(parsed.scenesPlanned) ? Number(parsed.scenesPlanned) : scenes.length,
      scenesCompleted: Number.isFinite(parsed.scenesCompleted) ? Number(parsed.scenesCompleted) : parsed.compositions?.length ?? 0,
      videoTitle: String(parsed.videoTitle ?? ''),
      scenes,
      assetImages: Array.isArray(parsed.assetImages) ? parsed.assetImages as HtmlVideoPipelineData['assetImages'] : [],
      voiceClips: Array.isArray(parsed.voiceClips) ? parsed.voiceClips as HtmlVideoPipelineData['voiceClips'] : [],
      compositions: Array.isArray(parsed.compositions) ? parsed.compositions as HtmlVideoPipelineData['compositions'] : [],
      htmlPaths: Array.isArray(parsed.htmlPaths) ? parsed.htmlPaths.map(String) : [],
      cover: parsed.cover ?? null,
      _cfg: parsed._cfg ?? {},
    };
  } catch {
    return createHtmlVideoPipelineData('', {});
  }
}

export function createHtmlVideoPipelineData(
  copy: string,
  config: NonNullable<HtmlVideoPipelineData['_cfg']> = {},
): HtmlVideoPipelineData {
  const scenes = buildHtmlVideoScenePlans(copy, config.maxScenes ?? 8);
  return {
    scenesPlanned: scenes.length,
    scenesCompleted: 0,
    videoTitle: titleFromCopy(copy),
    scenes,
    assetImages: [],
    voiceClips: [],
    compositions: [],
    htmlPaths: [],
    cover: null,
    _cfg: config,
  };
}

export function createHtmlVideoTaskInput(input: {
  copy: string;
  ratio: string;
  style: string;
  bgmId?: string;
  maxScenes?: number;
  foreground?: boolean;
}): CreateTaskInput {
  const data = createHtmlVideoPipelineData(input.copy, {
    ratio: input.ratio,
    style: input.style,
    bgmId: input.bgmId ?? '',
    maxScenes: input.maxScenes,
    foreground: input.foreground ?? true,
    transitionType: 'fade',
    coverImageMode: 'titled',
    coverTemplate: 'cinematic-poster',
    coverRatio: '3:4',
  });
  return {
    title: `${dateStamp()} · ${data.videoTitle}`,
    inputText: input.copy.trim(),
    taskKind: 'story',
    taskType: 'html-video',
    pipelineStep: 'plan',
    pipelineData: JSON.stringify(data),
    materialSource: 'paste',
    track: 'character-story',
    style: input.style,
    ratio: input.ratio,
    bgmId: input.bgmId ?? '',
  };
}

export function isHtmlVideoTask(task: Pick<Task, 'taskType'>): boolean {
  return task.taskType === 'html-video';
}

function buildHtmlVideoScenePlans(copy: string, maxScenes: number): HtmlVideoScenePlan[] {
  const chunks = splitCopyIntoSceneTexts(copy).slice(0, Math.max(1, maxScenes));
  return chunks.map((text, index) => ({
    index: index + 1,
    narration: text,
    title: shortSceneTitle(text, index + 1),
    captions: splitCaptionLines(text),
    sceneTemplate: index % 2 === 0 ? 'cinematic-title' : 'foreground-card',
    background: {
      prompt: `${text}，电影感背景，适合 HTML 动画视频`,
    },
    elements: [
      {
        slot: 0,
        prompt: `${text} 的关键人物或物件，透明 PNG 前景素材`,
      },
    ],
  }));
}

function normalizeHtmlVideoScenePlan(scene: HtmlVideoScenePlan): HtmlVideoScenePlan {
  const narration = String(scene.narration ?? '');
  return {
    index: Number(scene.index) || 1,
    narration,
    title: String(scene.title ?? shortSceneTitle(narration, Number(scene.index) || 1)),
    captions: Array.isArray(scene.captions) ? scene.captions.map(String) : splitCaptionLines(narration),
    sceneTemplate: String(scene.sceneTemplate ?? 'cinematic-title'),
    background: { prompt: String(scene.background?.prompt ?? narration) },
    elements: Array.isArray(scene.elements)
      ? scene.elements.map((element, slot) => ({ slot: Number(element.slot) || slot, prompt: String(element.prompt ?? narration) }))
      : [],
  };
}

function splitCopyIntoSceneTexts(copy: string): string[] {
  const paragraphs = copy
    .split(/\n{2,}/u)
    .map((item) => item.trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  return copy
    .split(/(?<=[。！？!?；;])\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitCaptionLines(text: string): string[] {
  const lines = text
    .split(/[。！？!?；;]\s*/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return lines.length ? lines : [text.trim()].filter(Boolean);
}

function titleFromCopy(copy: string): string {
  return copy.trim().replace(/\s+/g, '').slice(0, 12) || 'HTML动画视频';
}

function shortSceneTitle(text: string, index: number): string {
  const cleaned = text.replace(/\s+/g, '').slice(0, 12);
  return cleaned || `场景 ${index}`;
}

function dateStamp(): string {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}
