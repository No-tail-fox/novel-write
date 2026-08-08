import type { DraftFontFamily, DraftImageMotion, DraftTemplate } from './types';

export const draftImageFitOptions = [
  { value: 'cover', label: '裁切填满' },
  { value: 'contain', label: '完整缩放' },
] as const satisfies ReadonlyArray<{ value: DraftTemplate['image']['fit']; label: string }>;

export function draftImageFitLabel(value: DraftTemplate['image']['fit']): string {
  return draftImageFitOptions.find((option) => option.value === value)?.label ?? draftImageFitOptions[0].label;
}

export const draftFontFamilies = [
  'system',
  'HarmonyOS_Sans_SC_Regular',
  'HarmonyOS_Sans_SC_Medium',
  'HarmonyOS_Sans_SC_Bold',
  'SourceHanSansCN_Regular',
  'SourceHanSansCN_Medium',
  'SourceHanSansCN_Bold',
  '经典雅黑',
  '宋体',
  'SourceHanSerifCN_Regular',
  'SourceHanSerifCN_Bold',
  '思源中宋',
  '烟波宋',
  '圆体',
  'ResourceHanRoundedCN_Nl',
  'ResourceHanRoundedCN_Md',
  'ResourceHanRoundedCN_Bold',
  '简中圆',
  'LXGWWenKai_Regular',
  'LXGWWenKai_Bold',
  '毛笔行楷',
  '柳公权',
  '得意黑',
  '站酷酷黑体',
  '站酷文艺体',
  '汉仪英雄体',
  '综艺体',
  '江湖体',
] as const satisfies readonly DraftFontFamily[];

export const draftFontGroups = ['默认', '黑体', '宋体', '圆体', '楷体与手写', '标题设计'] as const;
export type DraftFontGroup = typeof draftFontGroups[number];

export const draftFontOptions: ReadonlyArray<{
  value: DraftFontFamily;
  label: string;
  cssFamily: string;
  group: DraftFontGroup;
}> = [
  { value: 'system', label: '系统默认', group: '默认', cssFamily: '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", sans-serif' },
  { value: 'HarmonyOS_Sans_SC_Regular', label: '鸿蒙黑体 · 常规', group: '黑体', cssFamily: '"HarmonyOS Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif' },
  { value: 'HarmonyOS_Sans_SC_Medium', label: '鸿蒙黑体 · 中黑', group: '黑体', cssFamily: '"HarmonyOS Sans SC Medium", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif' },
  { value: 'HarmonyOS_Sans_SC_Bold', label: '鸿蒙黑体 · 粗体', group: '黑体', cssFamily: '"HarmonyOS Sans SC Bold", SimHei, "Microsoft YaHei", sans-serif' },
  { value: 'SourceHanSansCN_Regular', label: '思源黑体 · 常规', group: '黑体', cssFamily: '"Source Han Sans CN", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif' },
  { value: 'SourceHanSansCN_Medium', label: '思源黑体 · 中黑', group: '黑体', cssFamily: '"Source Han Sans CN Medium", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif' },
  { value: 'SourceHanSansCN_Bold', label: '思源黑体 · 粗体', group: '黑体', cssFamily: '"Source Han Sans CN Bold", "Noto Sans CJK SC", SimHei, sans-serif' },
  { value: '经典雅黑', label: '经典雅黑', group: '黑体', cssFamily: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { value: '宋体', label: '经典宋体', group: '宋体', cssFamily: 'SimSun, "Songti SC", serif' },
  { value: 'SourceHanSerifCN_Regular', label: '思源宋体 · 常规', group: '宋体', cssFamily: '"Source Han Serif CN", "Noto Serif CJK SC", SimSun, serif' },
  { value: 'SourceHanSerifCN_Bold', label: '思源宋体 · 粗体', group: '宋体', cssFamily: '"Source Han Serif CN Bold", "Noto Serif CJK SC", SimSun, serif' },
  { value: '思源中宋', label: '思源中宋', group: '宋体', cssFamily: '"Source Han Serif CN", "Noto Serif CJK SC", SimSun, serif' },
  { value: '烟波宋', label: '烟波宋', group: '宋体', cssFamily: '"Songti SC", STSong, SimSun, serif' },
  { value: '圆体', label: '经典圆体', group: '圆体', cssFamily: 'YouYuan, "Yuanti SC", "Microsoft YaHei", sans-serif' },
  { value: 'ResourceHanRoundedCN_Nl', label: '资源圆体 · 常规', group: '圆体', cssFamily: '"Resource Han Rounded CN", YouYuan, "Microsoft YaHei", sans-serif' },
  { value: 'ResourceHanRoundedCN_Md', label: '资源圆体 · 中粗', group: '圆体', cssFamily: '"Resource Han Rounded CN Medium", YouYuan, "Microsoft YaHei", sans-serif' },
  { value: 'ResourceHanRoundedCN_Bold', label: '资源圆体 · 粗体', group: '圆体', cssFamily: '"Resource Han Rounded CN Bold", YouYuan, SimHei, sans-serif' },
  { value: '简中圆', label: '简中圆', group: '圆体', cssFamily: 'YouYuan, "Yuanti SC", "Microsoft YaHei", sans-serif' },
  { value: 'LXGWWenKai_Regular', label: '霞鹜文楷 · 常规', group: '楷体与手写', cssFamily: '"LXGW WenKai", KaiTi, "Kaiti SC", STKaiti, serif' },
  { value: 'LXGWWenKai_Bold', label: '霞鹜文楷 · 粗体', group: '楷体与手写', cssFamily: '"LXGW WenKai Bold", KaiTi, "Kaiti SC", STKaiti, serif' },
  { value: '毛笔行楷', label: '毛笔行楷', group: '楷体与手写', cssFamily: 'STXingkai, KaiTi, "Kaiti SC", cursive' },
  { value: '柳公权', label: '柳公权楷书', group: '楷体与手写', cssFamily: 'KaiTi, "Kaiti SC", STKaiti, serif' },
  { value: '得意黑', label: '得意黑', group: '标题设计', cssFamily: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif' },
  { value: '站酷酷黑体', label: '站酷酷黑', group: '标题设计', cssFamily: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif' },
  { value: '站酷文艺体', label: '站酷文艺体', group: '标题设计', cssFamily: 'KaiTi, "Kaiti SC", "Microsoft YaHei", serif' },
  { value: '汉仪英雄体', label: '汉仪英雄体', group: '标题设计', cssFamily: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif' },
  { value: '综艺体', label: '综艺体', group: '标题设计', cssFamily: 'SimHei, "Heiti SC", "Microsoft YaHei", sans-serif' },
  { value: '江湖体', label: '江湖体', group: '标题设计', cssFamily: 'STXingkai, KaiTi, "Kaiti SC", cursive' },
];

export const defaultDraftFontFamily: DraftFontFamily = 'system';

export function normalizeDraftFontFamily(value: unknown, fallback: DraftFontFamily = defaultDraftFontFamily): DraftFontFamily {
  return draftFontFamilies.includes(value as DraftFontFamily) ? value as DraftFontFamily : fallback;
}

export function draftFontCssFamily(value: DraftFontFamily): string {
  return draftFontOptions.find((option) => option.value === value)?.cssFamily ?? draftFontOptions[0].cssFamily;
}

const noBorder = {
  color: '#000000',
  width: 0,
  alpha: 0,
};

const storyboundBorder = {
  color: '#000000',
  width: 40,
  alpha: 1,
};

const captionBase = {
  visible: true,
  x: 0,
  width: 0.8,
  fontSize: 12,
  fontFamily: defaultDraftFontFamily,
  color: '#FFDE00',
  alpha: 1,
  border: noBorder,
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
  text: '主标题示例',
  x: 0,
  y: 0.04739583333333333,
  width: 0.8,
  fontSize: 25,
  fontFamily: defaultDraftFontFamily,
  color: '#FFDE00',
  alpha: 1,
  bold: true,
  underline: true,
  align: 1,
  letterSpacing: 0,
  lineSpacing: 0,
  border: storyboundBorder,
};

const subtitleBase = {
  visible: true,
  text: '副标题示例文字',
  x: 0,
  y: -0.21666666666666667,
  width: 0.8,
  fontSize: 12,
  fontFamily: defaultDraftFontFamily,
  color: '#FFFFFF',
  alpha: 1,
  bold: false,
  underline: false,
  align: 1,
  letterSpacing: 2,
  lineSpacing: 4,
  border: storyboundBorder,
};

const disclaimerBase = {
  visible: true,
  text: '图片由AI生成与网络下载\n科普视频，无不良引导',
  x: 0,
  y: -0.903125,
  width: 0.8,
  fontSize: 8,
  fontFamily: defaultDraftFontFamily,
  color: '#FFFFFF',
  alpha: 0.26,
  bold: false,
  underline: false,
  align: 1,
  letterSpacing: 0,
  lineSpacing: 5,
  border: storyboundBorder,
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

const neutralFrame: DraftTemplate['frame'] = {
  enabled: false,
  headerColor: '#000000',
  headerColorEnd: '#000000',
  footerColor: '#000000',
  footerColorEnd: '#000000',
  imageBorderColor: '#000000',
  imageBorderWidth: 0,
  imageBorderSides: 'all',
};

export const draftImageMotions: ReadonlyArray<{ value: DraftImageMotion; label: string }> = [
  { value: '', label: '关闭运镜' },
  { value: 'zoom_in', label: '推近' },
  { value: 'zoom_out', label: '拉远' },
  { value: 'zoom_pan_up', label: '推近并上移' },
  { value: 'zoom_pan_down', label: '推近并下移' },
  { value: 'pan_left', label: '向左平移' },
  { value: 'pan_right', label: '向右平移' },
];

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
  '滑滑梯 II',
  '四格滑动',
  '百叶窗',
  '百叶窗 II',
  '抖入放大',
  '三分割',
  '三分割 II',
  '上下分割 II',
  '上升旋转',
  '下降向右',
  '下降向左',
  '中间分割',
  '中间分割 II',
  '叠叠乐',
  '叠叠乐 II',
  '叠叠乐 III',
  '叠叠乐 IV',
  '叠叠乐 V',
  '叠叠乐 VI',
  '哈哈镜',
  '哈哈镜 II',
  '四格翻转',
  '四格转动',
  '四格转动 II',
  '夹心饼干',
  '夹心饼干 II',
  '小火车',
  '小火车 II',
  '小火车 III',
  '小火车 IV',
  '小陀螺',
  '小陀螺 II',
  '左右分割 II',
  '弹入旋转',
  '形变缩小',
  '悠悠球',
  '悠悠球 II',
  '手机',
  '手机 II',
  '手机 III',
  '扭曲拉伸',
  '拉伸扭曲',
  '放大弹动',
  '斜转',
  '斜转 II',
  '方片转动',
  '方片转动 II',
  '旋入晃动',
  '旋出渐隐',
  '旋转伸缩',
  '旋转回吸',
  '旋转降落',
  '晃动旋出',
  '水晶',
  '水晶 II',
  '波动滑出',
  '海盗船',
  '海盗船 II',
  '海盗船 III',
  '海盗船 IV',
  '滑入波动',
  '碎块滑动',
  '碎块滑动 II',
  '立方体',
  '立方体 II',
  '立方体 III',
  '立方体 IV',
  '立方体 V',
  '绕圈圈',
  '绕圈圈 II',
  '绕圈圈 III',
  '绕圈圈 IV',
  '缩小弹动',
  '缩小旋转',
  '缩小转出',
  '翻转 II',
  '翻转 III',
  '翻转 IV',
  '翻转 V',
  '翻转 VI',
  '荡秋千',
  '荡秋千 II',
  '转入转出',
  '转入转出 II',
  '转圈圈',
  '过山车',
  '过山车 II',
  '降落旋转',
  '魔方',
  '魔方 II',
  '分身',
  '分身 II',
  '动感摇晃 I',
  '动感摇晃 II',
  '四格滑动 II',
  '四格翻转 II',
  '回忆旋转',
  '坠落',
  '弹动冲屏',
  '波动吸收',
  '波动放大',
  '相框滑动',
  '红酒摇晃',
  '跳跳糖',
  '闪光放大',
  '闪光放大 II',
];

export const draftTemplates: DraftTemplate[] = [
  {
    id: 'default-portrait-9-16',
    name: '默认竖屏',
    isDefault: true,
    canvas: { width: 1080, height: 1920, ratio: '9:16', backgroundColor: '#000000', backgroundImage: '' },
    image: { visible: true, ratio: '9:16', fit: 'cover', focusX: 0.5, focusY: 0.5, left: 0, top: 0, width: 1, height: 1, mediaScale: 1, animation: '缩放', motion: '', motionStrength: 1 },
    frame: neutralFrame,
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
    image: { visible: true, ratio: '4:3', fit: 'cover', focusX: 0.5, focusY: 0.5, left: 0, top: 0.2890625, width: 1, height: 0.421875, mediaScale: 1, animation: '缩放', motion: '', motionStrength: 1 },
    frame: neutralFrame,
    title: { ...titleBase, y: 0.8357783211083945, fontSize: 20, underline: false },
    subtitle: { ...subtitleBase, y: 0.5953125 },
    caption: { ...captionBase, y: -0.5572916666666666 },
    disclaimer: { ...disclaimerBase, y: -0.8141628912685337, alpha: 1 },
    audio: audioBase,
  },
  {
    id: 'builtin-landscape-16-9',
    name: '横屏16:9',
    isDefault: true,
    canvas: { width: 1920, height: 1080, ratio: '16:9', backgroundColor: '#000000', backgroundImage: '' },
    image: { visible: true, ratio: '16:9', fit: 'cover', focusX: 0.5, focusY: 0.5, left: 0, top: 0, width: 1, height: 1, mediaScale: 1, animation: '缩放', motion: '', motionStrength: 1 },
    frame: neutralFrame,
    title: { ...titleBase, y: 0.12777777777777777, fontSize: 20, underline: false },
    subtitle: { ...subtitleBase, y: -0.43333333333333335, fontSize: 8 },
    caption: { ...captionBase, y: -0.6425925925925926, fontSize: 8 },
    disclaimer: {
      ...disclaimerBase,
      text: '图片由AI生成与网络下载 科普视频，无不良引导',
      y: -0.8787037037037037,
      fontSize: 5,
      alpha: 0.5,
    },
    audio: audioBase,
  },
];

export function getTemplate(id = 'default-portrait-9-16'): DraftTemplate {
  return draftTemplates.find((template) => template.id === id) ?? draftTemplates[0];
}

export function draftTemplateMatchesRatio(template: DraftTemplate, ratio: string): boolean {
  if (template.image.ratio !== ratio) return false;
  const fallbackId = defaultDraftTemplateIdForRatio(ratio);
  if (!fallbackId) return true;
  const fallback = getTemplate(fallbackId);
  return canvasAspectRatioMatches(template.canvas.width, template.canvas.height, fallback.canvas.width, fallback.canvas.height);
}

export function matchingDraftTemplateId(
  templates: DraftTemplate[],
  ratio: string,
  currentTemplateId = '',
): string {
  const current = templates.find((template) => template.id === currentTemplateId);
  if (current && draftTemplateMatchesRatio(current, ratio)) return current.id;
  const matching = templates.find((template) => template.isDefault && draftTemplateMatchesRatio(template, ratio))
    ?? templates.find((template) => draftTemplateMatchesRatio(template, ratio));
  return matching?.id ?? currentTemplateId;
}

export function resolveDraftTemplateForRatio(template: Partial<DraftTemplate> | undefined, ratio: string): DraftTemplate {
  const fallbackId = defaultDraftTemplateIdForRatio(ratio);
  const normalized = template ? normalizeDraftTemplate(template) : undefined;
  if (normalized && (!fallbackId || draftTemplateMatchesRatio(normalized, ratio))) return normalized;
  return normalizeDraftTemplate(getTemplate(fallbackId));
}

export function normalizeDraftTemplate(template: Partial<DraftTemplate>): DraftTemplate {
  const fallback = draftTemplates.find((item) => item.id === template.id) ?? draftTemplates[0];
  const imageWidth = clampNumber(template.image?.width, fallback.image.width, 0, 1);
  return {
    ...fallback,
    ...template,
    canvas: { ...fallback.canvas, ...template.canvas },
    image: {
      ...fallback.image,
      ...template.image,
      focusX: clampNumber(template.image?.focusX, fallback.image.focusX, 0, 1),
      focusY: clampNumber(template.image?.focusY, fallback.image.focusY, 0, 1),
      left: clampNumber(template.image?.left, fallback.image.left, 0, Math.max(0, 1 - imageWidth)),
      width: imageWidth,
      mediaScale: clampNumber(template.image?.mediaScale, fallback.image.mediaScale, 1, 8),
      motion: normalizeImageMotion(template.image?.motion),
      motionStrength: clampNumber(template.image?.motionStrength, 1, 0, 2),
    },
    frame: normalizeFrame(template.frame),
    title: {
      ...fallback.title,
      ...template.title,
      x: finiteNumber(template.title?.x, fallback.title.x),
      y: finiteNumber(template.title?.y, fallback.title.y),
      width: clampNumber(template.title?.width, fallback.title.width, 0.1, 2),
      fontFamily: normalizeDraftFontFamily(template.title?.fontFamily, fallback.title.fontFamily),
      alpha: finiteNumber(template.title?.alpha, fallback.title.alpha),
      bold: typeof template.title?.bold === 'boolean' ? template.title.bold : fallback.title.bold,
      underline: typeof template.title?.underline === 'boolean' ? template.title.underline : fallback.title.underline,
      align: finiteNumber(template.title?.align, fallback.title.align),
      letterSpacing: finiteNumber(template.title?.letterSpacing, fallback.title.letterSpacing),
      lineSpacing: finiteNumber(template.title?.lineSpacing, fallback.title.lineSpacing),
      border: normalizeTextBorder(template.title?.border, fallback.title.border),
    },
    subtitle: {
      ...fallback.subtitle,
      ...template.subtitle,
      x: finiteNumber(template.subtitle?.x, fallback.subtitle.x),
      y: finiteNumber(template.subtitle?.y, fallback.subtitle.y),
      width: clampNumber(template.subtitle?.width, fallback.subtitle.width, 0.1, 2),
      fontFamily: normalizeDraftFontFamily(template.subtitle?.fontFamily, fallback.subtitle.fontFamily),
      text: finiteString(template.subtitle?.text, fallback.subtitle.text),
      alpha: finiteNumber(template.subtitle?.alpha, fallback.subtitle.alpha),
      bold: typeof template.subtitle?.bold === 'boolean' ? template.subtitle.bold : fallback.subtitle.bold,
      underline: typeof template.subtitle?.underline === 'boolean' ? template.subtitle.underline : fallback.subtitle.underline,
      align: finiteNumber(template.subtitle?.align, fallback.subtitle.align),
      letterSpacing: finiteNumber(template.subtitle?.letterSpacing, fallback.subtitle.letterSpacing),
      lineSpacing: finiteNumber(template.subtitle?.lineSpacing, fallback.subtitle.lineSpacing),
      border: normalizeTextBorder(template.subtitle?.border, fallback.subtitle.border),
    },
    caption: {
      ...fallback.caption,
      ...template.caption,
      x: finiteNumber(template.caption?.x, fallback.caption.x),
      y: finiteNumber(template.caption?.y, fallback.caption.y),
      width: clampNumber(template.caption?.width, fallback.caption.width, 0.1, 2),
      fontSize: finiteNumber(template.caption?.fontSize, fallback.caption.fontSize),
      fontFamily: normalizeDraftFontFamily(template.caption?.fontFamily, fallback.caption.fontFamily),
      color: finiteString(template.caption?.color, fallback.caption.color),
      alpha: finiteNumber(template.caption?.alpha, fallback.caption.alpha),
      bold: typeof template.caption?.bold === 'boolean' ? template.caption.bold : fallback.caption.bold,
      underline: typeof template.caption?.underline === 'boolean' ? template.caption.underline : fallback.caption.underline,
      align: finiteNumber(template.caption?.align, fallback.caption.align),
      letterSpacing: finiteNumber(template.caption?.letterSpacing, fallback.caption.letterSpacing),
      lineSpacing: finiteNumber(template.caption?.lineSpacing, fallback.caption.lineSpacing),
      maxCharsPerLine: finiteNumber(template.caption?.maxCharsPerLine, fallback.caption.maxCharsPerLine),
      border: normalizeTextBorder(template.caption?.border, fallback.caption.border),
      background: normalizeCaptionBackground(template.caption?.background, fallback.caption.background),
    },
    disclaimer: {
      ...fallback.disclaimer,
      ...template.disclaimer,
      x: finiteNumber(template.disclaimer?.x, fallback.disclaimer.x),
      y: finiteNumber(template.disclaimer?.y, fallback.disclaimer.y),
      width: clampNumber(template.disclaimer?.width, fallback.disclaimer.width, 0.1, 2),
      fontSize: finiteNumber(template.disclaimer?.fontSize, fallback.disclaimer.fontSize),
      fontFamily: normalizeDraftFontFamily(template.disclaimer?.fontFamily, fallback.disclaimer.fontFamily),
      color: finiteString(template.disclaimer?.color, fallback.disclaimer.color),
      alpha: finiteNumber(template.disclaimer?.alpha, fallback.disclaimer.alpha),
      bold: typeof template.disclaimer?.bold === 'boolean' ? template.disclaimer.bold : fallback.disclaimer.bold,
      underline: typeof template.disclaimer?.underline === 'boolean' ? template.disclaimer.underline : fallback.disclaimer.underline,
      align: finiteNumber(template.disclaimer?.align, fallback.disclaimer.align),
      letterSpacing: finiteNumber(template.disclaimer?.letterSpacing, fallback.disclaimer.letterSpacing),
      lineSpacing: finiteNumber(template.disclaimer?.lineSpacing, fallback.disclaimer.lineSpacing),
      border: normalizeTextBorder(template.disclaimer?.border, fallback.disclaimer.border),
    },
    audio: { ...fallback.audio, ...template.audio },
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function finiteString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function normalizeTextBorder(value: unknown, fallback = noBorder): typeof noBorder {
  const input = value && typeof value === 'object' ? value as Partial<typeof noBorder> : {};
  return {
    color: finiteString(input.color, fallback.color),
    width: finiteNumber(input.width, fallback.width),
    alpha: finiteNumber(input.alpha, fallback.alpha),
  };
}

function normalizeCaptionBackground(value: unknown, fallback = captionBase.background): typeof captionBase.background {
  const input = value && typeof value === 'object' ? value as Partial<typeof captionBase.background> : {};
  return {
    color: finiteString(input.color, fallback.color),
    alpha: finiteNumber(input.alpha, fallback.alpha),
    roundRadius: finiteNumber(input.roundRadius, fallback.roundRadius),
  };
}

function normalizeImageMotion(value: unknown): DraftImageMotion {
  return draftImageMotions.some((option) => option.value === value) ? value as DraftImageMotion : '';
}

function normalizeFrame(value: unknown): DraftTemplate['frame'] {
  const input = value && typeof value === 'object' ? value as Partial<DraftTemplate['frame']> : {};
  const imageBorderSides = input.imageBorderSides === 'horizontal' || input.imageBorderSides === 'vertical' || input.imageBorderSides === 'all'
    ? input.imageBorderSides
    : neutralFrame.imageBorderSides;
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : neutralFrame.enabled,
    headerColor: finiteString(input.headerColor, neutralFrame.headerColor),
    headerColorEnd: finiteString(input.headerColorEnd, neutralFrame.headerColorEnd),
    footerColor: finiteString(input.footerColor, neutralFrame.footerColor),
    footerColorEnd: finiteString(input.footerColorEnd, neutralFrame.footerColorEnd),
    imageBorderColor: finiteString(input.imageBorderColor, neutralFrame.imageBorderColor),
    imageBorderWidth: clampNumber(input.imageBorderWidth, neutralFrame.imageBorderWidth, 0, 500),
    imageBorderSides,
  };
}

function defaultDraftTemplateIdForRatio(ratio: string): string {
  if (ratio === '16:9') return 'builtin-landscape-16-9';
  if (ratio === '4:3') return 'builtin-portrait-4-3';
  if (ratio === '9:16') return 'default-portrait-9-16';
  return '';
}

function canvasAspectRatioMatches(width: number, height: number, targetWidth: number, targetHeight: number): boolean {
  if (![width, height, targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0)) return false;
  return Math.abs(width / height - targetWidth / targetHeight) < 0.01;
}
