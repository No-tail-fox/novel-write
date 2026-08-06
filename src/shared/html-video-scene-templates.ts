export type HtmlVideoSceneAnimationPreset =
  | 'static'
  | 'kenburns'
  | 'kenburns-up'
  | 'kenburns-down'
  | 'pan-left'
  | 'pan-right'
  | 'pop-in'
  | 'pop-rotate'
  | 'float'
  | 'fade-up'
  | 'typewriter'
  | 'slide-in-left'
  | 'slide-in-right'
  | 'slide-in-top'
  | 'zoom-in'
  | 'zoom-out'
  | 'drop-settle'
  | 'slam-impact'
  | 'bounce-caption'
  | 'pop-caption'
  | 'rise-caption';

export interface HtmlVideoAnimationCue {
  preset: HtmlVideoSceneAnimationPreset;
  startSec?: number;
  durationSec?: number;
}

export interface HtmlVideoSceneChoreography {
  background: HtmlVideoAnimationCue;
  title?: HtmlVideoAnimationCue;
  elements: readonly HtmlVideoAnimationCue[];
  caption: HtmlVideoAnimationCue;
}

interface HtmlVideoSceneTemplate {
  id: string;
  label: string;
  description: string;
  swatch: string;
  titleTop: number;
  captionY: number;
  choreography: HtmlVideoSceneChoreography;
}

export const HTML_VIDEO_SCENE_TEMPLATES = [
  {
    id: 'center-focus',
    label: '居中聚焦',
    description: '标题居中引入，主素材由下进入，字幕压底。',
    swatch: 'center',
    titleTop: 9,
    captionY: 84,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'pop-in', startSec: 0.05, durationSec: 0.7 },
      elements: [{ preset: 'pop-rotate', startSec: 0.4, durationSec: 0.85 }],
      caption: { preset: 'pop-caption', startSec: 0.2, durationSec: 0.6 },
    },
  },
  {
    id: 'left-text-right-object',
    label: '左字右物',
    description: '标题和字幕靠左，前景主体在右侧出场。',
    swatch: 'split-right',
    titleTop: 16,
    captionY: 78,
    choreography: {
      background: { preset: 'pan-left' },
      title: { preset: 'slide-in-left', startSec: 0.08, durationSec: 0.7 },
      elements: [{ preset: 'pop-rotate', startSec: 0.4, durationSec: 0.85 }],
      caption: { preset: 'rise-caption', startSec: 0.28, durationSec: 0.65 },
    },
  },
  {
    id: 'three-float',
    label: '三元素漂浮',
    description: '背景铺底，3 个素材依次漂浮，字幕压底。',
    swatch: 'three',
    titleTop: 8,
    captionY: 88,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'fade-up', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'float', startSec: 0.3, durationSec: 0.9 },
        { preset: 'float', startSec: 0.7, durationSec: 0.9 },
        { preset: 'float', startSec: 1.1, durationSec: 0.9 },
      ],
      caption: { preset: 'rise-caption', startSec: 0.25, durationSec: 0.65 },
    },
  },
  {
    id: 'full-quote',
    label: '满屏金句',
    description: '文字是主角，画面降噪，适合结论和强调句。',
    swatch: 'quote',
    titleTop: 34,
    captionY: 72,
    choreography: {
      background: { preset: 'kenburns-down' },
      title: { preset: 'zoom-in', startSec: 0.08, durationSec: 0.75 },
      elements: [{ preset: 'static' }],
      caption: { preset: 'typewriter', startSec: 0.25, durationSec: 1.25 },
    },
  },
  {
    id: 'full-image',
    label: '全屏大图',
    description: '画面全幅展示，只保留必要的标题与字幕。',
    swatch: 'image',
    titleTop: 7,
    captionY: 88,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'fade-up', startSec: 0.12, durationSec: 0.7 },
      elements: [{ preset: 'zoom-in', startSec: 0.25, durationSec: 0.9 }],
      caption: { preset: 'rise-caption', startSec: 0.3, durationSec: 0.65 },
    },
  },
  {
    id: 'right-text-left-object',
    label: '右字左物',
    description: '前景主体靠左，标题和文字信息在右侧。',
    swatch: 'split-left',
    titleTop: 16,
    captionY: 78,
    choreography: {
      background: { preset: 'pan-right' },
      title: { preset: 'slide-in-right', startSec: 0.08, durationSec: 0.7 },
      elements: [{ preset: 'slide-in-left', startSec: 0.4, durationSec: 0.85 }],
      caption: { preset: 'rise-caption', startSec: 0.28, durationSec: 0.65 },
    },
  },
  {
    id: 'person-focus',
    label: '人物聚焦',
    description: '人物前景占据主视觉，标题与字幕避让脸部。',
    swatch: 'person',
    titleTop: 8,
    captionY: 88,
    choreography: {
      background: { preset: 'kenburns-up' },
      title: { preset: 'fade-up', startSec: 0.06, durationSec: 0.65 },
      elements: [{ preset: 'zoom-in', startSec: 0.3, durationSec: 0.95 }],
      caption: { preset: 'pop-caption', startSec: 0.25, durationSec: 0.6 },
    },
  },
  {
    id: 'split-compare',
    label: '左右对比',
    description: '画面一分为二，用于观点、人物或状态对比。',
    swatch: 'compare',
    titleTop: 8,
    captionY: 87,
    choreography: {
      background: { preset: 'static' },
      title: { preset: 'fade-up', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'slide-in-left', startSec: 0.18, durationSec: 0.8 },
        { preset: 'slide-in-right', startSec: 0.42, durationSec: 0.8 },
      ],
      caption: { preset: 'rise-caption', startSec: 0.3, durationSec: 0.65 },
    },
  },
  {
    id: 'center-burst',
    label: '中心爆发',
    description: '主体从中心快速进场，适合情绪高点和转折。',
    swatch: 'burst',
    titleTop: 11,
    captionY: 86,
    choreography: {
      background: { preset: 'zoom-out' },
      title: { preset: 'slam-impact', startSec: 0.05, durationSec: 0.55 },
      elements: [{ preset: 'zoom-in', startSec: 0.18, durationSec: 0.7 }],
      caption: { preset: 'bounce-caption', startSec: 0.3, durationSec: 0.65 },
    },
  },
  {
    id: 'grid-four',
    label: '四格盘点',
    description: '用四格节奏组织多个要点或素材。',
    swatch: 'grid',
    titleTop: 7,
    captionY: 90,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'slide-in-top', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'drop-settle', startSec: 0.15, durationSec: 0.7 },
        { preset: 'drop-settle', startSec: 0.3, durationSec: 0.7 },
        { preset: 'drop-settle', startSec: 0.45, durationSec: 0.7 },
        { preset: 'drop-settle', startSec: 0.6, durationSec: 0.7 },
      ],
      caption: { preset: 'rise-caption', startSec: 0.35, durationSec: 0.65 },
    },
  },
  {
    id: 'quote-card',
    label: '引言卡片',
    description: '文字以卡片层浮在画面上，适合引用和旁白。',
    swatch: 'card',
    titleTop: 27,
    captionY: 69,
    choreography: {
      background: { preset: 'pan-left' },
      title: { preset: 'fade-up', startSec: 0.15, durationSec: 0.75 },
      elements: [{ preset: 'zoom-out', startSec: 0.12, durationSec: 0.8 }],
      caption: { preset: 'pop-caption', startSec: 0.32, durationSec: 0.65 },
    },
  },
  {
    id: 'big-number',
    label: '数据强调',
    description: '大字号数据居中，图像和前景作辅助。',
    swatch: 'number',
    titleTop: 29,
    captionY: 73,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'slam-impact', startSec: 0.08, durationSec: 0.62 },
      elements: [{ preset: 'pop-in', startSec: 0.36, durationSec: 0.7 }],
      caption: { preset: 'rise-caption', startSec: 0.35, durationSec: 0.65 },
    },
  },
  {
    id: 'top-object-bottom-text',
    label: '上物下字',
    description: '上半部分展示主体，下半部分承载文字。',
    swatch: 'stack',
    titleTop: 62,
    captionY: 85,
    choreography: {
      background: { preset: 'kenburns-up' },
      title: { preset: 'slide-in-top', startSec: 0.18, durationSec: 0.7 },
      elements: [{ preset: 'drop-settle', startSec: 0.25, durationSec: 0.85 }],
      caption: { preset: 'rise-caption', startSec: 0.38, durationSec: 0.65 },
    },
  },
  {
    id: 'diagonal-flow',
    label: '对角动线',
    description: '主体与文字沿对角线排布，画面更有运动感。',
    swatch: 'diagonal',
    titleTop: 15,
    captionY: 82,
    choreography: {
      background: { preset: 'pan-right' },
      title: { preset: 'slide-in-left', startSec: 0.05, durationSec: 0.72 },
      elements: [{ preset: 'slide-in-right', startSec: 0.32, durationSec: 0.85 }],
      caption: { preset: 'rise-caption', startSec: 0.3, durationSec: 0.65 },
    },
  },
  {
    id: 'rule-of-thirds',
    label: '三分偏置',
    description: '主体落在三分线交点，留出完整文字空间。',
    swatch: 'thirds',
    titleTop: 14,
    captionY: 82,
    choreography: {
      background: { preset: 'pan-left' },
      title: { preset: 'fade-up', startSec: 0.08, durationSec: 0.7 },
      elements: [{ preset: 'zoom-in', startSec: 0.35, durationSec: 0.88 }],
      caption: { preset: 'rise-caption', startSec: 0.28, durationSec: 0.65 },
    },
  },
  {
    id: 'orbit-focus',
    label: '环绕聚焦',
    description: '多个素材环绕核心主体，适合关系和体系表达。',
    swatch: 'orbit',
    titleTop: 7,
    captionY: 90,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'pop-in', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'float', startSec: 0.2, durationSec: 0.8 },
        { preset: 'float', startSec: 0.5, durationSec: 0.8 },
        { preset: 'float', startSec: 0.8, durationSec: 0.8 },
        { preset: 'float', startSec: 1.1, durationSec: 0.8 },
      ],
      caption: { preset: 'pop-caption', startSec: 0.35, durationSec: 0.65 },
    },
  },
  {
    id: 'parallax-focus',
    label: '聚焦推拉',
    description: '背景与前景形成视差推拉，强化空间层次。',
    swatch: 'parallax',
    titleTop: 9,
    captionY: 87,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'fade-up', startSec: 0.06, durationSec: 0.7 },
      elements: [{ preset: 'zoom-out', startSec: 0.35, durationSec: 1 }],
      caption: { preset: 'rise-caption', startSec: 0.3, durationSec: 0.65 },
    },
  },
  {
    id: 'dialogue-duo',
    label: '双人对话',
    description: '两个人物从两侧依次入场，适合问答、辩论和访谈。',
    swatch: 'dialogue',
    titleTop: 8,
    captionY: 88,
    choreography: {
      background: { preset: 'kenburns' },
      title: { preset: 'fade-up', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'slide-in-left', startSec: 0.2, durationSec: 0.8 },
        { preset: 'slide-in-right', startSec: 0.45, durationSec: 0.8 },
      ],
      caption: { preset: 'pop-caption', startSec: 0.35, durationSec: 0.65 },
    },
  },
  {
    id: 'vertical-timeline',
    label: '纵向时间轴',
    description: '三个节点沿竖线错峰出现，适合步骤、历史和事件推进。',
    swatch: 'timeline',
    titleTop: 7,
    captionY: 90,
    choreography: {
      background: { preset: 'pan-left' },
      title: { preset: 'slide-in-top', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'slide-in-left', startSec: 0.18, durationSec: 0.7 },
        { preset: 'slide-in-right', startSec: 0.42, durationSec: 0.7 },
        { preset: 'slide-in-left', startSec: 0.66, durationSec: 0.7 },
      ],
      caption: { preset: 'rise-caption', startSec: 0.35, durationSec: 0.65 },
    },
  },
  {
    id: 'stacked-cards',
    label: '层叠卡片',
    description: '多张内容卡依次落下叠放，适合案例、清单和资料展示。',
    swatch: 'cards',
    titleTop: 8,
    captionY: 89,
    choreography: {
      background: { preset: 'kenburns-down' },
      title: { preset: 'pop-in', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'drop-settle', startSec: 0.18, durationSec: 0.75 },
        { preset: 'drop-settle', startSec: 0.42, durationSec: 0.75 },
        { preset: 'drop-settle', startSec: 0.66, durationSec: 0.75 },
      ],
      caption: { preset: 'rise-caption', startSec: 0.4, durationSec: 0.65 },
    },
  },
  {
    id: 'kinetic-copy',
    label: '动态大字',
    description: '标题与字幕成为主画面，适合口号、观点和强节奏转折。',
    swatch: 'kinetic',
    titleTop: 28,
    captionY: 64,
    choreography: {
      background: { preset: 'pan-right' },
      title: { preset: 'slam-impact', startSec: 0.08, durationSec: 0.6 },
      elements: [{ preset: 'static' }],
      caption: { preset: 'typewriter', startSec: 0.28, durationSec: 1.1 },
    },
  },
  {
    id: 'product-stage',
    label: '产品展台',
    description: '核心物件居中弹出，辅助元素稍后补位，适合产品和道具。',
    swatch: 'product',
    titleTop: 8,
    captionY: 88,
    choreography: {
      background: { preset: 'zoom-out' },
      title: { preset: 'fade-up', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'pop-in', startSec: 0.22, durationSec: 0.85 },
        { preset: 'float', startSec: 0.58, durationSec: 0.8 },
      ],
      caption: { preset: 'pop-caption', startSec: 0.38, durationSec: 0.65 },
    },
  },
  {
    id: 'split-push',
    label: '分屏推进',
    description: '双素材占据上下分屏并相向进入，适合并行叙事和场景切换。',
    swatch: 'split-push',
    titleTop: 7,
    captionY: 91,
    choreography: {
      background: { preset: 'kenburns-up' },
      title: { preset: 'slide-in-top', startSec: 0.05, durationSec: 0.65 },
      elements: [
        { preset: 'slide-in-left', startSec: 0.18, durationSec: 0.8 },
        { preset: 'slide-in-right', startSec: 0.42, durationSec: 0.8 },
      ],
      caption: { preset: 'rise-caption', startSec: 0.36, durationSec: 0.65 },
    },
  },
  {
    id: 'cinematic-end',
    label: '电影片尾',
    description: '画面渐稳、标题缓入，适合收束、署名和结束语。',
    swatch: 'credits',
    titleTop: 40,
    captionY: 61,
    choreography: {
      background: { preset: 'zoom-out' },
      title: { preset: 'fade-up', startSec: 0.15, durationSec: 1 },
      elements: [{ preset: 'static' }],
      caption: { preset: 'rise-caption', startSec: 0.55, durationSec: 0.85 },
    },
  },
] as const satisfies readonly HtmlVideoSceneTemplate[];

export type HtmlVideoSceneTemplateId = typeof HTML_VIDEO_SCENE_TEMPLATES[number]['id'];

const legacyTemplateAliases: Record<string, HtmlVideoSceneTemplateId> = {
  'split-left': 'right-text-left-object',
  'split-right': 'left-text-right-object',
  'lower-third': 'top-object-bottom-text',
  'cinematic-title': 'full-image',
};

export function normalizeHtmlVideoSceneTemplate(value: string | null | undefined): HtmlVideoSceneTemplateId {
  const normalized = legacyTemplateAliases[value ?? ''] ?? value;
  return HTML_VIDEO_SCENE_TEMPLATES.some((template) => template.id === normalized)
    ? normalized as HtmlVideoSceneTemplateId
    : 'center-focus';
}

export function htmlVideoSceneTemplate(value: string | null | undefined) {
  const id = normalizeHtmlVideoSceneTemplate(value);
  return HTML_VIDEO_SCENE_TEMPLATES.find((template) => template.id === id)!;
}
