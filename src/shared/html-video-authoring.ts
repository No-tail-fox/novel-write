import { HTML_VIDEO_SCENE_TEMPLATES } from './html-video-scene-templates';
import type { HtmlVideoScenePlan } from './types';

/** Host adapter for the installed, pinned packages; not instructions from latest upstream main. */
export const HYPERFRAMES_AUTHORING_REVISION = 'storydream-hf-0.8.40-v1';
export const HYPERFRAMES_AUTHORING_RULES = [
  '【HyperFrames 0.8.40 宿主约定】只输出场景计划，由宿主生成可编辑 HTML、data-composition-id / data-start / data-duration 与本地 GSAP 时间轴。',
  '动画由可寻址时间轴驱动，支持任意帧 seek；不得依赖实时时钟、随机数、网络或 CSS 无限动画。音频、字幕、字体就绪与素材解码由宿主负责。',
  '横竖屏分别构图；主体、证据、标题、字幕使用独立区域，底部至少 16% 保留字幕，文字留出阅读停顿。',
  '按叙事关系选模板：前后变化用 before-after-wipe；比较用 split-compare；对话用 dialogue-duo；路径步骤用 spatial-pan-stations；中心关系用 constellation-hub；金句用 kinetic-type-beats；单主体证据用 news-focus。素材数量必须与模板槽位一致。',
].join('\n');

/** Preserve valid authored choices. Repair malformed choices using meaning AND slot count. */
export function selectHtmlSemanticTemplate(scene: HtmlVideoScenePlan, count: number, previous?: string): string | undefined {
  const current = HTML_VIDEO_SCENE_TEMPLATES.find(t => t.id === scene.sceneTemplate && t.materialSlots === count);
  if (current) return current.id;
  const text = `${scene.title} ${scene.narration}`;
  const preferred: string[] = [];
  if (/之前|之后|过去|如今|从前|现在|before|after/i.test(text)) preferred.push('before-after-wipe');
  if (/相比|比较|对比|而另|一边|另一边|versus|compare/i.test(text)) preferred.push('split-compare');
  if (/对话|问道|回答|说[：:]|dialogue/i.test(text)) preferred.push('dialogue-duo');
  if (/第一步|第二步|接着|最后|沿着|途经|路线|步骤|station|route/i.test(text)) preferred.push('spatial-pan-stations', 'vertical-timeline');
  if (/围绕|关系|连接|系统|组成|relationship|system/i.test(text)) preferred.push('constellation-hub', 'radial-system');
  if (/数据|证据|研究|记录|统计|报告|evidence|data/i.test(text)) preferred.push('news-focus', 'hero-callouts');
  preferred.push(...(count === 0 ? ['kinetic-type-beats', 'full-quote'] : count === 1 ? ['center-focus', 'left-text-right-object'] : count === 2 ? ['split-compare', 'diagonal-flow'] : count === 3 ? ['spatial-pan-stations', 'three-float'] : ['grid-four', 'radial-system']));
  const candidates = preferred.map(id => HTML_VIDEO_SCENE_TEMPLATES.find(t => t.id === id && t.materialSlots === count)).filter(t => t !== undefined);
  return (candidates.find(t => t.id !== previous) ?? candidates[0] ?? HTML_VIDEO_SCENE_TEMPLATES.find(t => t.materialSlots === count))?.id;
}
