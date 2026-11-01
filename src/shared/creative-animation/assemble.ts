import { rebuildEditorialTimeline, type EditorialCollagePipelineData as Document, type EditorialCollageShot } from '../editorial-collage';
import { createEditorialCuePlan } from '../editorial-cue-plan';
import { createVoxAnimation, voxPropsSchema, voxTemplate } from '../vox-animation';
import type { VoxProductionSettings } from '../vox-production';
import { voxDataPresentation } from '../vox-data-chart';
import { resolveCreativeStyle, LEMO_REVISION } from './styles';
import { CREATIVE_RENDER_REVISION, creativeLayout, creativeRenderSpec } from './render-spec';

const styleTemplateCandidates: Record<string, string[]> = {
  'caption-news': ['evidence-headline', 'evidence-focus'], newsreel: ['evidence-quote', 'evidence-focus'], countdown: ['compare-split', 'gallery-grid'],
  'city-symphony': ['gallery-grid', 'gallery-space'], 'visual-investigation': ['evidence-focus', 'evidence-stack'], 'kino-montage': ['compare-split', 'paper-polaroids'],
  telestrator: ['evidence-focus', 'flow-converge'], 'news-package': ['evidence-stack', 'text-keywords'], 'satellite-briefing': ['evidence-focus', 'gallery-space'],
  'briefing-board': ['flow-converge', 'evidence-stack'], 'lidar-survey': ['gallery-space', 'evidence-focus'], 'white-model': ['gallery-space', 'book-identity'],
  'data-physical': ['flow-rings', 'paper-popup'], teardown: ['flow-steps', 'gallery-grid'], microscope: ['evidence-focus', 'evidence-quote'],
  'archive-lighttable': ['evidence-stack', 'gallery-grid'], 'crayon-book': ['paper-popup', 'paper-polaroids'], watercolor: ['paper-polaroids', 'gallery-grid'],
  'ink-wash': ['paper-title', 'evidence-quote'], impasto: ['evidence-stack', 'paper-actors'], 'one-line': ['flow-causal', 'text-keywords'],
  whiteboard: ['flow-steps', 'flow-converge'], 'urban-sketch': ['gallery-grid', 'gallery-space'], 'shadow-puppet': ['paper-actors', 'paper-popup'],
  ukiyoe: ['gallery-space', 'paper-polaroids'], 'papercut-red': ['paper-polaroids', 'gallery-grid'], 'paper-lantern': ['gallery-space', 'paper-popup'],
  risograph: ['evidence-stack', 'paper-polaroids'], 'halftone-dossier': ['evidence-stack', 'evidence-quote'], woodcut: ['paper-actors', 'paper-popup'],
  engraving: ['evidence-focus', 'evidence-quote'], 'silkscreen-poster': ['gallery-grid', 'compare-split'], 'swiss-motion': ['text-keywords', 'flow-steps'],
  'spy-titles': ['text-opening', 'paper-title'], 'art-deco': ['gallery-space', 'flow-rings'], blueprint: ['flow-steps', 'evidence-stack'],
  'stained-glass': ['gallery-grid', 'paper-polaroids'], 'pictogram-motion': ['flow-converge', 'flow-rings'], 'ascii-crt': ['text-keywords', 'text-opening'],
  dataviz: ['text-opening', 'evidence-quote'], 'iso-infographic': ['flow-rings', 'gallery-space'], 'dark-keynote': ['text-opening', 'text-keywords'],
  'living-screencast': ['gallery-space', 'evidence-focus'], 'hologram-hud': ['evidence-focus', 'flow-rings'], 'rubber-hose': ['paper-actors', 'compare-split'],
  'cel-anime-80s': ['gallery-space', 'paper-polaroids'], 'scifi-toon': ['paper-popup', 'gallery-grid'], 'midcentury-toon': ['gallery-grid', 'paper-actors'],
  'pixel-rpg': ['gallery-grid', 'flow-steps'], 'hd-2d': ['gallery-space', 'paper-actors'], microgame: ['flow-converge', 'paper-popup'],
  'game-show': ['evidence-stack', 'compare-split'], 'silent-film': ['paper-title', 'evidence-quote'], backrooms: ['evidence-focus', 'gallery-space'],
  'brick-toy': ['flow-steps', 'paper-popup'], 'paper-popup': ['paper-popup', 'paper-polaroids'], 'tilt-shift': ['gallery-space', 'gallery-grid'],
  'lowpoly-island': ['gallery-grid', 'gallery-space'], 'glass-product': ['gallery-space', 'book-identity'],
};
const fallbackTemplateCandidates: Record<string, string[]> = {
  layers: ['paper-actors', 'paper-polaroids', 'paper-popup', 'flow-steps', 'text-opening'],
  focus: ['evidence-focus', 'evidence-stack', 'evidence-quote', 'text-keywords'],
  grid: ['gallery-grid', 'compare-split', 'flow-converge', 'text-keywords'],
  space: ['gallery-space', 'flow-rings', 'book-takeaways', 'text-opening'],
  popup: ['paper-popup', 'paper-polaroids', 'paper-title', 'text-opening'],
};
function creativeStyleTemplateId(styleSlug: string, fallback: NonNullable<ReturnType<typeof resolveCreativeStyle>>['adapter'] extends infer A ? A extends { fallback: infer F } ? F : never : never, imageCount: number, itemCount: number): string {
  const candidates = [...(styleTemplateCandidates[styleSlug] ?? []), ...(fallbackTemplateCandidates[fallback] ?? []), 'text-opening'];
  const unique = [...new Set(candidates)];
  return unique.find(id => {
    const template = voxTemplate(id);
    const minItems = ['compare-split', 'compare-values', 'compare-claims', 'time-year-counter', 'map-a-to-b', 'flow-converge'].includes(id) ? 2 : template?.items ? 1 : 0;
    return Boolean(template && imageCount >= (template.minImages ?? 0) && imageCount <= (template.maxImages ?? 24) && itemCount >= minItems);
  }) ?? 'text-opening';
}

export function assembleCreativeShot(d: Document, shot: EditorialCollageShot, settings: VoxProductionSettings, source: 'production' | 'local' = 'production'): EditorialCollageShot {
        const beat = d.beats.find(b => b.id === shot.beatId)!;
        const cues = beat.subtitleCues.filter(c => shot.subtitleCueIds.includes(c.id));
        const animation = createVoxAnimation(shot.title || '', '');
        const imageLayers = shot.layers.filter(l => !l.content && l.visible !== false && d.assets.some(a => a.id === l.assetVersionId && a.kind === 'image' && a.localPath));
        const imageIds = imageLayers.map(l => l.assetVersionId!);
        // Legacy drafts can have a single plate; semantic layers still own its motion.
        let templateId = imageIds.length === 1 ? 'paper-popup' : 'paper-actors';
        let props: Record<string, unknown> = { title: shot.title || '', assetIds: imageIds };
        if (settings.presetId === 'data-map') {
          const hasCoordinates = settings.data.every(row => row.lat !== undefined && row.lng !== undefined);
          templateId = hasCoordinates ? 'map-multi-stop' : 'data-bars';
          props = { ...props, assetIds: [], unit: settings.dataUnit ?? '', source: [...new Set(settings.data.map(r => r.source))].join('；').slice(0, 400), items: settings.data.map(({ label, value, lat, lng }) => ({ label, value, lat: lat ?? 0, lng: lng ?? 0 })) };
          if (!hasCoordinates) props.dataPresentation = voxDataPresentation(
            settings.data.map(row => row.label), cues,
            d.timeline?.clips.find(clip => clip.shotId === shot.id)?.startMs ?? 0,
            d.beats.flatMap(b => b.shots).find(s => !settings.lockedShotIds.includes(s.id))?.id === shot.id,
          );
        } else if (settings.presetId === 'archival-story') {
          templateId = 'paper-polaroids';
          props.source = [...new Set(settings.archives.map(r => r.source))].join('；').slice(0, 400);
        }
        const style = resolveCreativeStyle(settings.authoring?.styleId, settings.presetId);
        if (!style?.adapter) throw new Error('CREATIVE_STYLE_MISSING: 所选风格不存在或尚未适配');
        if (style?.adapter) {
          Object.assign(props, { background: style.adapter.background, foreground: style.adapter.foreground, accent: style.adapter.accent });
          if (settings.presetId === 'paper-explainer') {
            const cueTexts = cues.map(cue => cue.text).filter(Boolean);
            const items = (cueTexts.length ? cueTexts : [shot.title || '']).filter(Boolean).slice(0, 24).map(label => ({ label: label.slice(0, 160), detail: '' }));
            templateId = creativeStyleTemplateId(style.slug, style.adapter.fallback, imageIds.length, items.length);
            const selectedTemplate = voxTemplate(templateId);
            props.subtitle = cueTexts.join(' ').slice(0, 1800);
            if (selectedTemplate?.items) props.items = items.slice(0, selectedTemplate.maxItems ?? 24);
            // Inspection/gallery templates need the subject first, not an empty background plate.
            if (['evidence-focus', 'gallery-grid', 'gallery-space', 'compare-slider'].includes(templateId)) {
              props.assetIds = imageLayers.filter(l => l.kind !== 'background').map(l => l.assetVersionId!);
              if (!(props.assetIds as string[]).length) props.assetIds = imageIds;
            }
          }
        }
        animation.template = { id: templateId, props: voxPropsSchema.parse(props) };

  animation.creativeStyle = { styleId: style.slug, rendererRevision: CREATIVE_RENDER_REVISION, upstreamRevision: LEMO_REVISION, source, composition: settings.presetId === 'data-map' ? 'data' : 'scene' };
  if (source === 'local' && shot.animation && !shot.animation.native) { animation.code = shot.animation.code; animation.authoring = shot.animation.authoring; }
  const [rw, rh] = d.ratio.split(':').map(Number);
  const layout = creativeLayout(creativeRenderSpec(style.slug), rw, rh);
  const subjects = shot.layers.filter(layer => !layer.content && layer.kind !== 'background' && layer.visible !== false);
  const labels = shot.layers.filter(layer => layer.content && layer.visible !== false && layer.content.text.trim() !== (shot.title ?? '').trim());
  const layers = settings.presetId === 'data-map' ? shot.layers : shot.layers.map(layer => {
    const index = subjects.findIndex(item => item.id === layer.id);
    const labelIndex = labels.findIndex(item => item.id === layer.id);
    const note = labelIndex < 0 ? undefined : { ...layout.note, y: layout.note.y + layout.note.height * labelIndex / labels.length, height: layout.note.height / labels.length };
    const box = layer.visible === false ? undefined : layer.content ? (layer.content.text.trim() === (shot.title ?? '').trim() ? layout.title : note) : index >= 0 ? { ...layout.subject, x: layout.subject.x + layout.subject.width * index / subjects.length, width: layout.subject.width / subjects.length } : undefined;
    if (!box) return layer;
    // Applying a style deliberately recomposes; subsequent inspector edits remain authored keyframes.
    return { ...layer, width: box.width, height: box.height, motion: [{ atMs: 0, x: box.x + box.width / 2, y: box.y + box.height / 2, scale: 1, rotation: 0, opacity: 1 }, { atMs: shot.durationMs, x: box.x + box.width / 2, y: box.y + box.height / 2, scale: 1, rotation: 0, opacity: 1 }] };
  });
  return { ...shot, layers, renderStrategy: 'remotion', animation,
    ...(!shot.transitionIn ? { transitionIn: { type: 'cut' as const, durationMs: 0 } } : {}),
    cuePlan: settings.generateImages && settings.presetId === 'paper-explainer' ? createEditorialCuePlan(cues, layers, shot.motionStyle ?? 'focus-reveal') : undefined };
}

/** Applies real local layout/type/motion. Original paid attempts and imported assets remain available. */
export function applyCreativeStyleToDocument(d: Document, settings: VoxProductionSettings): Document {
  if (settings.authoring?.mode === 'ai-code') throw new Error('AI 风格需要按此风格创作全片，不能应用本地模板。');
  if (d.productionRun?.status === 'running') throw new Error('请先暂停自动制作，再应用镜头风格。');
  if (d.productionRun?.nodes.some(node => node.status === 'unknown')) throw new Error('请先在制作进度中核对待确认的云端结果，再应用风格。');
  return rebuildEditorialTimeline({ ...d, ...(d.productionRun ? { productionRun: { ...d.productionRun, status: 'cancelled' as const, message: '已应用本地风格。制作记录已保留；完整更新素材请重新开始自动制作。' } } : {}), stage: 'assets', productionSettings: settings, beats: d.beats.map(beat => ({ ...beat, shots: beat.shots.map(shot =>
    settings.lockedShotIds.includes(shot.id) || (shot.animation && !shot.animation.authoring && (shot.animation.mode === 'code' || shot.animation.code.source.trim()))
      ? shot : assembleCreativeShot(d, shot, settings, 'local')) })) });
}
