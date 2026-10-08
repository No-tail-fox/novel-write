import type { EditorialLayerKind } from './editorial-collage';
import type { EditorialMotionStyle } from './editorial-motion';

/** A dedicated style key keeps Image Lab's unrelated illustration presets out of VOX requests. */
export const EDITORIAL_IMAGE_STYLE = 'vox-editorial';
export const EDITORIAL_IMAGE_REQUEST_OPTIONS = { style: EDITORIAL_IMAGE_STYLE, smartMode: 'text-to-image' } as const;

const imageRules = '文字由程序叠加：不要把旁白、标题或任何标签画进图片；不要水印、标志、虚构数字或伪造可读的史料。';

/**
 * A local visual brief, not a second model call. Narration stays explicitly marked
 * as semantic context; the image model receives subject/action/composition rules.
 */
export function buildEditorialScenePrompt(input: { narration: string; ratio: string; motionStyle?: EditorialMotionStyle }): string {
  const intent = input.motionStyle === 'comparison'
    ? '从语义中选出确实存在的两组对象，用相同视角、比例和照明呈现差异；没有明确的两组对象时只表现一个主体，不编造对照事实。'
    : input.motionStyle === 'evidence-stack'
      ? '选择能支撑这一句话的一个可见实物或记录载体，突出材质和关键细节；无真实证据图时使用明确的概念插画，不伪造新闻截图、实验结果或统计图。'
      : input.motionStyle === 'path-progress'
        ? '选择过程中的一个决定性瞬间，以主体的位置、姿态或物体关系表现变化；保持同一主体，不用多格漫画或一组重复人像代替过程。'
        : input.motionStyle === 'focus-reveal'
          ? '选择一句话中最关键的实体或因果关系，用近景和一个可见细节揭示重点；避免用装饰性人物代替真正解释的对象。'
          : '把这一句话压缩成一个能一眼识别的主体和一个可见动作或物体关系；抽象概念用一个日常选择场景或单一实物隐喻表达，不堆放无关图标。';
  return [
    `画面任务：为 ${input.ratio} 纪录片制作一幅纸拼贴分镜静帧，只解释当前镜头的一件事。`,
    `主体与动作：${intent}`,
    '场景与层次：主体轮廓完整，环境只保留理解情境所需的信息；背景、主体、少量辅助物明确分层，便于分别制作和动画编排。',
    '构图与材质：真实摄影剪纸、自然纸纹和克制的色彩；最多一个焦点与两组辅助物，底部保留字幕安全区。',
    imageRules,
    `旁白语义参考（仅供理解，不是画面文字）：${input.narration.trim()}`,
  ].join('\n');
}

/** Upgrade only the exact old auto-generated wrapper; leave authored scene prompts intact. */
export function resolveEditorialScenePrompt(input: { scenePrompt: string; narration: string; ratio: string; motionStyle?: EditorialMotionStyle; knownStylePrompts?: readonly string[] }): string {
  const original = input.scenePrompt.trim();
  const withoutStyle = input.knownStylePrompts?.reduce((text, style) => text.startsWith(`${style}. `) ? text.slice(style.length + 2) : text, original) ?? original;
  const legacy = `${input.ratio} editorial collage, ${input.narration.trim()}`;
  if (!original || withoutStyle === legacy || withoutStyle === input.narration.trim()) return buildEditorialScenePrompt(input);
  return original;
}

export function editorialImageTargetRules(kind?: EditorialLayerKind): string {
  if (!kind) return 'OUTPUT TARGET — COMPLETE COMPOSED KEYFRAME: one finished editorial frame with a clear subject and supporting environment. Do not use a green-screen field or a contact sheet. Preserve clean space for deterministic captions. No generated text, no watermark.';
  if (kind === 'background') return 'OUTPUT TARGET — BACKGROUND ONLY. Background plate only: paper texture and quiet contextual scenery with generous open space. No people, no foreground hero objects, no labels, no letters, no numbers, no watermark. Do not flatten the separately animated subject into this plate. Background output rules override any full-scene layout mentioned in the context.';
  if (kind === 'subject' || kind === 'archival') return 'OUTPUT TARGET — ISOLATED CUTOUT ONLY. A single complete subject or evidence object, centered and fully in frame with at least 10% clear margin and a clean silhouette. Solid pure green chroma-key background (#00FF00), perfectly uniform to all four edges. No green on the subject, no scene background, no floor, no border, no paper sheet behind the subject, no cast shadow, no text, no labels, no watermark. The green field will be removed locally. Cutout output rules override any full-scene layout or background described in the context.';
  return 'OUTPUT TARGET — INDEPENDENT GRAPHIC ASSET. Produce only the requested map, shape or texture, with a simple readable silhouette. Do not include a complete scene, unrelated subjects, generated text, numbers, labels or watermark. Accurate labels and data are added by code.';
}

export function buildEditorialLayerPrompt(kind: EditorialLayerKind, context: string): string {
  return [
    kind === 'background' ? 'Editorial documentary collage environment.' : 'One isolated editorial photographic cutout or graphic.',
    'Visual translation: turn the semantic context into a visible place, object or action before drawing. Use only details needed to communicate this idea. For abstract copy, use one coherent physical metaphor, not a written slogan or a board of icons.',
    `Semantic context (meaning only, never render these words): ${context.trim()}`,
    editorialImageTargetRules(kind),
  ].join('\n');
}

/** Exact comparison protects user edits to a generated prompt when changing motion. */
export function isEditorialAutoLayerPrompt(prompt: string | undefined, kind: EditorialLayerKind, contexts: readonly string[]): boolean {
  if (!prompt) return false;
  return contexts.some(context => prompt === buildEditorialLayerPrompt(kind, context)
    || prompt === (kind === 'background'
      ? `Editorial documentary collage environment for: ${context}. Background plate only: textured paper and contextual scenery, generous negative space. No people, no foreground hero objects, no labels, no letters, no numbers, no watermark. The subject will be composited separately.`
      : `One isolated editorial photographic cutout representing: ${context}. A single complete subject or evidence object, centered and fully in frame with clear silhouette and generous margin. Solid pure green chroma-key background (#00FF00), no green on the subject. No scene background, no floor, no cast shadow, no text, no labels, no watermark. The background will be removed for paper collage animation.`));
}
