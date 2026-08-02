export const HTML_VIDEO_SCENE_TEMPLATES = [
  {
    id: 'center-focus',
    label: '居中聚焦',
    description: '标题居中引入，主素材由下进入，字幕压底。',
    swatch: 'center',
    titleTop: 9,
    captionY: 84,
  },
  {
    id: 'left-text-right-object',
    label: '左字右物',
    description: '标题和字幕靠左，前景主体在右侧出场。',
    swatch: 'split-right',
    titleTop: 16,
    captionY: 78,
  },
  {
    id: 'three-float',
    label: '三元素漂浮',
    description: '背景铺底，3 个素材依次漂浮，字幕压底。',
    swatch: 'three',
    titleTop: 8,
    captionY: 88,
  },
  {
    id: 'full-quote',
    label: '满屏金句',
    description: '文字是主角，画面降噪，适合结论和强调句。',
    swatch: 'quote',
    titleTop: 34,
    captionY: 72,
  },
  {
    id: 'full-image',
    label: '全屏大图',
    description: '画面全幅展示，只保留必要的标题与字幕。',
    swatch: 'image',
    titleTop: 7,
    captionY: 88,
  },
  {
    id: 'right-text-left-object',
    label: '右字左物',
    description: '前景主体靠左，标题和文字信息在右侧。',
    swatch: 'split-left',
    titleTop: 16,
    captionY: 78,
  },
  {
    id: 'person-focus',
    label: '人物聚焦',
    description: '人物前景占据主视觉，标题与字幕避让脸部。',
    swatch: 'person',
    titleTop: 8,
    captionY: 88,
  },
  {
    id: 'split-compare',
    label: '左右对比',
    description: '画面一分为二，用于观点、人物或状态对比。',
    swatch: 'compare',
    titleTop: 8,
    captionY: 87,
  },
  {
    id: 'center-burst',
    label: '中心爆发',
    description: '主体从中心快速进场，适合情绪高点和转折。',
    swatch: 'burst',
    titleTop: 11,
    captionY: 86,
  },
  {
    id: 'grid-four',
    label: '四格盘点',
    description: '用四格节奏组织多个要点或素材。',
    swatch: 'grid',
    titleTop: 7,
    captionY: 90,
  },
  {
    id: 'quote-card',
    label: '引言卡片',
    description: '文字以卡片层浮在画面上，适合引用和旁白。',
    swatch: 'card',
    titleTop: 27,
    captionY: 69,
  },
  {
    id: 'big-number',
    label: '数据强调',
    description: '大字号数据居中，图像和前景作辅助。',
    swatch: 'number',
    titleTop: 29,
    captionY: 73,
  },
  {
    id: 'top-object-bottom-text',
    label: '上物下字',
    description: '上半部分展示主体，下半部分承载文字。',
    swatch: 'stack',
    titleTop: 62,
    captionY: 85,
  },
  {
    id: 'diagonal-flow',
    label: '对角动线',
    description: '主体与文字沿对角线排布，画面更有运动感。',
    swatch: 'diagonal',
    titleTop: 15,
    captionY: 82,
  },
  {
    id: 'rule-of-thirds',
    label: '三分偏置',
    description: '主体落在三分线交点，留出完整文字空间。',
    swatch: 'thirds',
    titleTop: 14,
    captionY: 82,
  },
  {
    id: 'orbit-focus',
    label: '环绕聚焦',
    description: '多个素材环绕核心主体，适合关系和体系表达。',
    swatch: 'orbit',
    titleTop: 7,
    captionY: 90,
  },
  {
    id: 'parallax-focus',
    label: '聚焦推拉',
    description: '背景与前景形成视差推拉，强化空间层次。',
    swatch: 'parallax',
    titleTop: 9,
    captionY: 87,
  },
] as const;

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
