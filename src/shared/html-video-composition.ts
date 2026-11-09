import type { HtmlVideoElementGeometry, HtmlVideoScenePlan, HtmlVideoSemanticBeat } from './types';
import type { HtmlVideoCaptionCue } from './html-video-captions';

export const HTML_COMPOSITION_REVISION = 'composition-v2.2';
type Box = { x: number; y: number; width: number; height: number };
export interface HtmlCompositionLayout {
  objects: Array<{ slot: number; geometry: HtmlVideoElementGeometry }>;
  title: Box;
  caption: Box;
}
const geometry = (x: number, y: number, width: number, height: number, zIndex = 3): HtmlVideoElementGeometry => ({ x, y, width, height, fit: 'contain', anchor: 'center bottom', zIndex });
/** Explicit content boxes; portrait is composed independently, not cropped from landscape. */
export function resolveHtmlCompositionLayout(plan: HtmlVideoScenePlan, portrait: boolean): HtmlCompositionLayout {
  const id = plan.sceneTemplate;
  let title: Box = { x: 8, y: 7, width: 84, height: 18 };
  const caption: Box = { x: 7, y: portrait ? 82 : 83, width: 86, height: 12 };
  let boxes = plan.elements.map((_, i) => portrait ? geometry(8, 24, 84, 55, 3 + i) : geometry(23, 24, 54, 56, 3 + i));
  if (['left-text-right-object', 'right-text-left-object'].includes(id)) {
    const right = id === 'left-text-right-object';
    title = portrait ? { x: 8, y: 8, width: 84, height: 20 } : { x: right ? 7 : 55, y: 22, width: 38, height: 42 };
    boxes = plan.elements.map((_, i) => portrait ? geometry(12, 30, 76, 49, 3 + i) : geometry(right ? 51 : 4, 12, 45, 68, 3 + i));
  } else if (['full-quote', 'quote-card', 'kinetic-copy', 'kinetic-type-beats'].includes(id)) {
    title = { x: 10, y: 25, width: 80, height: 44 };
    boxes = plan.elements.map((_, i) => geometry(66, 49, 27, 30, 3 + i));
  } else if (['split-compare', 'before-after-wipe', 'dialogue-duo'].includes(id)) {
    boxes = plan.elements.map((_, i) => portrait ? geometry(i % 2 ? 51 : 3, 30, 46, 48, 3 + i) : geometry(i % 2 ? 52 : 5, 25, 43, 55, 3 + i));
  } else if (id === 'hero-callouts') {
    boxes = plan.elements.map((_, i) => i === 0
      ? portrait ? geometry(25, 44, 50, 35, 5) : geometry(35, 28, 30, 51, 5)
      : portrait ? geometry(i === 1 ? 4 : 61, 28, 35, 24, 3 + i) : geometry(i === 1 ? 4 : 69, 35, 27, 38, 3 + i));
  } else if (['grid-four', 'parallax-focus'].includes(id)) {
    boxes = plan.elements.map((_, i) => geometry(i % 2 ? 52 : 5, 27 + Math.floor(i / 2) * 27, 43, 24, 3 + i));
  } else if (id === 'three-float') {
    boxes = plan.elements.map((_, i) => geometry(4 + i * 32, i === 1 ? 30 : 36, 28, portrait ? 40 : 42, 3 + i));
  } else if (['orbit-focus', 'radial-system'].includes(id)) {
    const positions = [[34, 27, 32, 16], [64, 44, 32, 19], [34, 64, 32, 16], [4, 44, 32, 19]];
    boxes = plan.elements.map((_, i) => geometry(...positions[i % positions.length] as [number, number, number, number], 3 + i));
  } else if (id === 'diagonal-flow') {
    boxes = plan.elements.map((_, i) => i % 2 ? geometry(51, 47, 44, 32, 3 + i) : geometry(5, 27, 44, 36, 3 + i));
  } else if (id === 'vertical-timeline') {
    boxes = plan.elements.map((_, i) => portrait
      ? geometry(i % 2 ? 54 : 6, 27 + i * 18, 40, 16, 3 + i)
      : geometry(5 + i * 31, 31 + i * 5, 28, 38, 3 + i));
  } else if (id === 'stacked-cards') {
    boxes = plan.elements.map((_, i) => portrait ? geometry(8 + i * 6, 28 + i * 5, 72, 40, 3 + i) : geometry(20 + i * 6, 28 + i * 5, 48, 40, 3 + i));
  } else if (id === 'product-stage') {
    boxes = plan.elements.map((_, i) => i === 0 ? geometry(8, 29, 60, 50, 4) : geometry(72, 47, 24, 28, 5));
  } else if (id === 'split-push') {
    boxes = plan.elements.map((_, i) => geometry(6, 28 + i * 26, 88, 23, 3 + i));
  } else if (id === 'spatial-pan-stations') {
    boxes = plan.elements.map((_, i) => portrait ? geometry(10 + i % 2 * 40, 26 + Math.floor(i / 2) * 25, 40, 27, 3 + i) : geometry(5 + i * 30, 28, 28, 49, 3 + i));
  } else if (id === 'constellation-hub') {
    boxes = plan.elements.map((_, i) => i === 0 ? geometry(30, 33, 40, 43, 5) : geometry(i % 2 ? 3 : 72, portrait ? 27 : 33, 25, 32, 3));
  }
  return { title, caption, objects: plan.elements.map((element, i) => ({ slot: element.slot, geometry: element.layout?.[portrait ? 'portrait' : 'landscape'] ?? boxes[i] })) };
}

/** Only newly planned scenes opt in; existing project files replay the legacy composition. */
export function upgradeHtmlSceneComposition(plan: HtmlVideoScenePlan): HtmlVideoScenePlan {
  if (plan.compositionVersion === 2) return plan;
  const landscape = resolveHtmlCompositionLayout(plan, false);
  const portrait = resolveHtmlCompositionLayout(plan, true);
  const purpose: HtmlVideoSemanticBeat['purpose'] = ['split-compare', 'before-after-wipe', 'dialogue-duo'].includes(plan.sceneTemplate) ? 'compare' : ['spatial-pan-stations', 'vertical-timeline'].includes(plan.sceneTemplate) ? 'path' : 'focus';
  return { ...plan, compositionVersion: 2,
    elements: plan.elements.map((element, i) => ({ ...element, layout: element.layout ?? { role: i ? 'supporting' : 'subject', landscape: landscape.objects[i].geometry, portrait: portrait.objects[i].geometry } })),
    beats: plan.beats ?? plan.captions.map((_, cueIndex): HtmlVideoSemanticBeat => ({ id: `${plan.index}-beat-${cueIndex}`, purpose,
      cueIndex, targetSlots: plan.elements.length ? [plan.elements[cueIndex % plan.elements.length].slot] : [],
      action: cueIndex === 0 ? 'reveal' : 'emphasize', durationSec: .5 })).flatMap(beat => purpose === 'focus' && plan.elements.length > 1 && beat.cueIndex > 0 ? [beat, { ...beat, id: beat.id + '-dim', targetSlots: plan.elements.filter(element => !beat.targetSlots.includes(element.slot)).map(element => element.slot), action: 'dim' as const }] : [beat]),
  };
}

export function htmlCompositionBeatTweens(plan: HtmlVideoScenePlan, cues: readonly HtmlVideoCaptionCue[], visibleSlots: readonly number[], duration: number): string {
  if (plan.compositionVersion !== 2) return '';
  return (plan.beats ?? []).flatMap(beat => {
    const cue = cues[beat.cueIndex];
    if (!cue) return [];
    const at = Math.min(duration, cue.startSec);
    const length = Math.min(beat.durationSec, cue.durationSec, duration - at);
    if (!(length > 0)) return [];
    const targets = beat.targetSlots.length ? beat.targetSlots.map(slot => visibleSlots.indexOf(slot)).filter(i => i >= 0).map(i => `#foreground-${i + 1}`) : ['#scene-title'];
    return targets.map(selector => {
      if (beat.action === 'reveal') return `tl.fromTo('${selector}', { opacity: 0.25, y: 24 }, { opacity: 1, y: 0, duration: ${length}, immediateRender: false, ease: 'power2.out' }, ${at});`;
      if (beat.action === 'exit' || beat.action === 'dim') return `tl.to('${selector}', { opacity: ${beat.action === 'exit' ? 0 : .35}, duration: ${length} }, ${at});`;
      return `tl.to('${selector}', { opacity: 1, duration: ${length / 2} }, ${at});\n` +
        `tl.to('${selector}', { scale: 1.055, duration: ${length / 2}, yoyo: true, repeat: 1, ease: 'power2.inOut' }, ${at});`;
    });
  }).join('\n');
}
