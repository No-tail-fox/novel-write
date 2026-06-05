import type { DraftTemplate } from './types';

const captionBase = {
  visible: true,
  x: 0,
  fontSize: 12,
  color: '#FFDE00',
  alpha: 1,
  bold: false,
  underline: false,
  align: 1,
  letterSpacing: 0,
  lineSpacing: 0,
  maxCharsPerLine: 12,
  background: {
    color: '#000000',
    alpha: 0.5,
    roundRadius: 0.3,
  },
};

const titleBase = {
  visible: true,
  x: 0,
  y: -0.1,
  text: '主标题示例',
  fontSize: 44,
  color: '#FFDE00',
  alpha: 1,
  bold: true,
};

const subtitleBase = {
  visible: true,
  text: '副标题示例文字',
  x: 0,
  y: 0.02,
  fontSize: 22,
  color: '#FFFFFF',
  alpha: 1,
  bold: false,
};

const disclaimerBase = {
  visible: true,
  x: 0,
  y: 0.92,
  text: '免责声明',
  fontSize: 12,
  color: '#FFFFFF',
  alpha: 1,
};

const audioBase = {
  narrationVolume: 10,
  bgmVolume: 3,
  transitionType: '叠化',
  transitionDurationMs: 450,
  narrationFadeInMs: 80,
  narrationFadeOutMs: 80,
  bgmFadeInMs: 800,
  bgmFadeOutMs: 2000,
  filterType: '',
  videoEffectType: '',
  audioEffectType: '',
};

export const imageAnimations = [
  '无动画',
  '缩放',
  '缩放 II',
  '左拉镜',
  '右拉镜',
  '向左缩小',
  '向右缩小',
  '形变左缩',
  '形变右缩',
  '上下分割',
  '左右分割',
  '向左下降',
  '向右下降',
  '旋转缩小',
  '旋转上升',
  '翻转',
  '回弹伸缩',
  '滑滑梯',
  '四格滑动',
  '百叶窗',
  '抖入放大',
];

export const draftTemplates: DraftTemplate[] = [
  {
    id: 'default-portrait-9-16',
    name: '默认竖屏',
    isDefault: true,
    canvas: { width: 1080, height: 1920, ratio: '9:16', backgroundColor: '#000000', backgroundImage: '' },
    image: { visible: true, ratio: '9:16', fit: 'cover', top: 0, height: 1, animation: '缩放' },
    title: titleBase,
    subtitle: subtitleBase,
    caption: { ...captionBase, y: -0.21510416666666668 },
    disclaimer: disclaimerBase,
    audio: audioBase,
  },
  {
    id: 'builtin-portrait-4-3',
    name: '竖屏4:3',
    isDefault: true,
    canvas: { width: 1080, height: 1920, ratio: '9:16', backgroundColor: '#000000', backgroundImage: '' },
    image: { visible: true, ratio: '4:3', fit: 'cover', top: 0.2890625, height: 0.421875, animation: '缩放' },
    title: titleBase,
    subtitle: subtitleBase,
    caption: { ...captionBase, y: -0.5572916666666666 },
    disclaimer: disclaimerBase,
    audio: audioBase,
  },
  {
    id: 'builtin-landscape-16-9',
    name: '横屏16:9',
    isDefault: true,
    canvas: { width: 1920, height: 1080, ratio: '16:9', backgroundColor: '#000000', backgroundImage: '' },
    image: { visible: true, ratio: '16:9', fit: 'cover', top: 0, height: 1, animation: '缩放' },
    title: { ...titleBase, fontSize: 34 },
    subtitle: subtitleBase,
    caption: { ...captionBase, y: -0.6425925925925926, fontSize: 8 },
    disclaimer: disclaimerBase,
    audio: audioBase,
  },
];

export function getTemplate(id = 'default-portrait-9-16'): DraftTemplate {
  return draftTemplates.find((template) => template.id === id) ?? draftTemplates[0];
}

export function normalizeDraftTemplate(template: Partial<DraftTemplate>): DraftTemplate {
  const fallback = draftTemplates.find((item) => item.id === template.id) ?? draftTemplates[0];
  return {
    ...fallback,
    ...template,
    canvas: { ...fallback.canvas, ...template.canvas },
    image: { ...fallback.image, ...template.image },
    title: {
      ...fallback.title,
      ...template.title,
      x: finiteNumber(template.title?.x, fallback.title.x),
      y: finiteNumber(template.title?.y, fallback.title.y),
      alpha: finiteNumber(template.title?.alpha, fallback.title.alpha),
      bold: typeof template.title?.bold === 'boolean' ? template.title.bold : fallback.title.bold,
    },
    subtitle: {
      ...fallback.subtitle,
      ...template.subtitle,
      x: finiteNumber(template.subtitle?.x, fallback.subtitle.x),
      y: finiteNumber(template.subtitle?.y, fallback.subtitle.y),
      text: finiteString(template.subtitle?.text, fallback.subtitle.text),
      alpha: finiteNumber(template.subtitle?.alpha, fallback.subtitle.alpha),
      bold: typeof template.subtitle?.bold === 'boolean' ? template.subtitle.bold : fallback.subtitle.bold,
    },
    caption: {
      ...fallback.caption,
      ...template.caption,
      x: finiteNumber(template.caption?.x, fallback.caption.x),
      y: finiteNumber(template.caption?.y, fallback.caption.y),
      background: { ...fallback.caption.background, ...template.caption?.background },
    },
    disclaimer: {
      ...fallback.disclaimer,
      ...template.disclaimer,
      x: finiteNumber(template.disclaimer?.x, fallback.disclaimer.x),
      y: finiteNumber(template.disclaimer?.y, fallback.disclaimer.y),
      fontSize: finiteNumber(template.disclaimer?.fontSize, fallback.disclaimer.fontSize),
      color: finiteString(template.disclaimer?.color, fallback.disclaimer.color),
      alpha: finiteNumber(template.disclaimer?.alpha, fallback.disclaimer.alpha),
    },
    audio: { ...fallback.audio, ...template.audio },
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}
