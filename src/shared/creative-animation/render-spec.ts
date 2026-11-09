import { CREATIVE_ADAPTERS } from './adapters';

/** Bump only when the actual renderer changes. Persisted on each assembled shot. */
export const CREATIVE_RENDER_REVISION = 1;
export type CreativeLayout = 'board' | 'specimen' | 'scroll' | 'theatre' | 'poster' | 'grid' | 'focus' | 'stage' | 'terminal' | 'game' | 'technical' | 'montage' | 'archive' | 'news' | 'diagram' | 'product' | 'cinema';
export type CreativeTitle = 'marker' | 'note' | 'ink' | 'stamp' | 'draft' | 'terminal' | 'pixel' | 'poster' | 'caption' | 'broadcast' | 'deco' | 'intertitle' | 'hud' | 'overprint' | 'cutout' | 'glass' | 'comic' | 'plain';
export type CreativeReveal = 'draw' | 'wash' | 'stamp' | 'scroll' | 'hinge' | 'print' | 'wipe' | 'snap' | 'iris' | 'scan' | 'assemble' | 'elastic' | 'pose' | 'focus';
export type CreativeMaterial = 'board' | 'paper' | 'ink' | 'paint' | 'halftone' | 'print' | 'draft' | 'glass' | 'phosphor' | 'screen' | 'film' | 'flat' | 'stage' | 'miniature';
export interface CreativeRenderSpec {
  layout: CreativeLayout; title: CreativeTitle; reveal: CreativeReveal; material: CreativeMaterial;
  font: 'sans' | 'serif' | 'hand' | 'mono'; durationMs: number; travelX: number; travelY: number; zoom: number; tilt: number; stepFps: number;
}
const spec = (layout: CreativeLayout, title: CreativeTitle, reveal: CreativeReveal, material: CreativeMaterial,
  font: CreativeRenderSpec['font'], durationMs: number, travelX: number, travelY: number, zoom: number, tilt = 0, stepFps = 0): CreativeRenderSpec =>
  ({ layout, title, reveal, material, font, durationMs, travelX, travelY, zoom, tilt, stepFps });

/** Explicit implementations of the pinned STYLE.md vocabulary. No catch-all style. */
export const CREATIVE_RENDER_SPECS: Record<string, CreativeRenderSpec> = {
  'caption-news': spec('news', 'caption', 'snap', 'screen', 'sans', 260, -.015, 0, .045),
  newsreel: spec('cinema', 'intertitle', 'iris', 'film', 'serif', 750, .006, 0, .025, -.5, 12),
  countdown: spec('grid', 'terminal', 'wipe', 'screen', 'mono', 430, 0, -.012, .018),
  'city-symphony': spec('cinema', 'plain', 'wipe', 'film', 'sans', 850, -.035, 0, .045),
  'visual-investigation': spec('focus', 'stamp', 'focus', 'screen', 'mono', 580, .018, -.008, .07),
  'kino-montage': spec('montage', 'poster', 'wipe', 'print', 'sans', 340, -.035, .018, .035, -6),
  telestrator: spec('focus', 'marker', 'draw', 'screen', 'hand', 900, -.01, 0, .04),
  'news-package': spec('news', 'broadcast', 'hinge', 'screen', 'sans', 430, 0, -.01, .012),
  'satellite-briefing': spec('technical', 'hud', 'focus', 'screen', 'mono', 1100, -.026, .012, .1),
  'briefing-board': spec('board', 'cutout', 'stamp', 'board', 'hand', 650, -.025, .008, .025, -1.5),
  'lidar-survey': spec('technical', 'hud', 'scan', 'phosphor', 'mono', 1050, .012, -.02, .035),
  'white-model': spec('product', 'plain', 'scan', 'stage', 'sans', 1200, .012, -.008, .03),
  'data-physical': spec('diagram', 'stamp', 'assemble', 'miniature', 'mono', 720, -.012, .006, .025, 0, 12),
  teardown: spec('technical', 'draft', 'assemble', 'stage', 'mono', 1000, .025, 0, .035),
  microscope: spec('specimen', 'note', 'focus', 'paper', 'serif', 1250, -.006, .006, .075),
  'archive-lighttable': spec('archive', 'note', 'focus', 'paper', 'serif', 1300, -.018, .008, .035, -1),
  'crayon-book': spec('specimen', 'marker', 'draw', 'paper', 'hand', 950, -.022, .005, .018, -2, 12),
  watercolor: spec('specimen', 'note', 'wash', 'paper', 'serif', 1500, -.035, 0, .016),
  'ink-wash': spec('scroll', 'ink', 'wash', 'ink', 'serif', 1800, -.022, -.004, .012),
  impasto: spec('poster', 'plain', 'pose', 'paint', 'serif', 1150, -.008, .004, .04, -.8),
  'one-line': spec('diagram', 'plain', 'draw', 'flat', 'sans', 1200, -.012, 0, .014),
  whiteboard: spec('board', 'marker', 'draw', 'board', 'hand', 1000, -.028, .012, .022),
  'urban-sketch': spec('specimen', 'note', 'draw', 'paper', 'hand', 1350, -.03, .006, .024, -1),
  'shadow-puppet': spec('theatre', 'cutout', 'hinge', 'paper', 'serif', 780, -.026, 0, .018, 4, 12),
  ukiyoe: spec('scroll', 'ink', 'scroll', 'print', 'serif', 1450, -.046, 0, .012),
  'papercut-red': spec('theatre', 'cutout', 'hinge', 'paper', 'serif', 850, -.01, .006, .02, -2, 12),
  'paper-lantern': spec('theatre', 'glass', 'wash', 'stage', 'serif', 1650, -.026, -.004, .04),
  risograph: spec('poster', 'overprint', 'print', 'print', 'sans', 650, -.016, 0, .008, -1),
  'halftone-dossier': spec('archive', 'stamp', 'stamp', 'halftone', 'sans', 520, -.022, .006, .028, -2),
  woodcut: spec('poster', 'poster', 'wipe', 'ink', 'serif', 900, -.024, 0, .022, -.4),
  engraving: spec('specimen', 'note', 'draw', 'ink', 'serif', 1450, -.012, -.005, .045),
  'silkscreen-poster': spec('poster', 'poster', 'print', 'print', 'sans', 800, -.038, 0, .01),
  'swiss-motion': spec('grid', 'poster', 'wipe', 'flat', 'sans', 500, -.016, 0, .008),
  'spy-titles': spec('montage', 'poster', 'iris', 'print', 'sans', 700, -.045, .012, .045, -4),
  'art-deco': spec('theatre', 'deco', 'hinge', 'stage', 'serif', 1450, 0, -.008, .025),
  blueprint: spec('technical', 'draft', 'draw', 'draft', 'mono', 1150, -.023, -.008, .025),
  'stained-glass': spec('theatre', 'glass', 'scan', 'glass', 'serif', 1550, -.014, 0, .02),
  'pictogram-motion': spec('diagram', 'plain', 'wipe', 'flat', 'sans', 650, -.008, .004, .012),
  'ascii-crt': spec('terminal', 'terminal', 'scan', 'phosphor', 'mono', 750, 0, 0, 0, 0, 12),
  dataviz: spec('diagram', 'plain', 'draw', 'paper', 'sans', 950, 0, 0, 0),
  'iso-infographic': spec('diagram', 'draft', 'assemble', 'flat', 'sans', 950, -.022, -.008, .025),
  'dark-keynote': spec('stage', 'plain', 'focus', 'stage', 'sans', 1000, -.01, 0, .04),
  'living-screencast': spec('focus', 'glass', 'focus', 'screen', 'sans', 900, -.022, -.008, .09),
  'hologram-hud': spec('technical', 'hud', 'scan', 'phosphor', 'mono', 1200, -.016, 0, .035),
  'rubber-hose': spec('theatre', 'comic', 'elastic', 'film', 'sans', 680, -.018, .006, .015, 4, 12),
  'cel-anime-80s': spec('cinema', 'caption', 'pose', 'flat', 'sans', 450, -.035, 0, .03, 0, 12),
  'scifi-toon': spec('poster', 'comic', 'pose', 'flat', 'sans', 500, -.025, .006, .02, 2, 12),
  'midcentury-toon': spec('grid', 'overprint', 'pose', 'print', 'sans', 700, -.026, 0, .012, -2, 12),
  'pixel-rpg': spec('game', 'pixel', 'snap', 'flat', 'mono', 380, -.025, 0, 0, 0, 8),
  'hd-2d': spec('cinema', 'pixel', 'pose', 'stage', 'mono', 1000, -.035, -.004, .03, 0, 12),
  microgame: spec('game', 'pixel', 'elastic', 'flat', 'sans', 500, -.015, .012, .01, 0, 10),
  'game-show': spec('game', 'broadcast', 'hinge', 'stage', 'sans', 700, 0, -.012, .02),
  'silent-film': spec('cinema', 'intertitle', 'iris', 'film', 'serif', 1100, .004, 0, .02, .3, 12),
  backrooms: spec('cinema', 'plain', 'focus', 'miniature', 'sans', 1900, -.028, .004, .055),
  'brick-toy': spec('diagram', 'cutout', 'assemble', 'miniature', 'sans', 850, -.016, .006, .015, 0, 8),
  'paper-popup': spec('theatre', 'cutout', 'hinge', 'paper', 'serif', 1050, -.018, -.006, .03, -2),
  'tilt-shift': spec('cinema', 'note', 'pose', 'miniature', 'serif', 1400, -.024, -.005, .035, 0, 10),
  'lowpoly-island': spec('diagram', 'plain', 'assemble', 'flat', 'sans', 950, -.028, -.01, .025, 0, 12),
  'glass-product': spec('product', 'plain', 'focus', 'glass', 'sans', 1600, -.008, -.012, .035),
};
export const creativeRenderSpec = (styleId: string) => CREATIVE_RENDER_SPECS[styleId];
export const creativePalette = (styleId: string) => CREATIVE_ADAPTERS[styleId];
export const creativeFont = (font: CreativeRenderSpec['font']) => ({
  sans: 'Microsoft YaHei UI,Microsoft YaHei,Noto Sans CJK SC,sans-serif',
  serif: 'Noto Serif CJK SC,Source Han Serif SC,SimSun,serif',
  hand: 'KaiTi,STKaiti,Microsoft YaHei,serif',
  mono: 'Cascadia Mono,Consolas,Microsoft YaHei,monospace',
})[font];
export interface CreativeRect { x: number; y: number; width: number; height: number; }
const rect = (x: number, y: number, width: number, height: number): CreativeRect => ({ x, y, width, height });
const layouts: Record<CreativeLayout, [CreativeRect, CreativeRect, CreativeRect]> = {
  board: [rect(.07,.065,.55,.18), rect(.13,.3,.5,.45), rect(.68,.35,.25,.28)],
  specimen: [rect(.07,.08,.3,.21), rect(.4,.19,.52,.55), rect(.07,.42,.28,.29)],
  scroll: [rect(.76,.09,.17,.59), rect(.08,.16,.62,.53), rect(.08,.7,.6,.1)],
  theatre: [rect(.18,.06,.64,.17), rect(.17,.25,.66,.48), rect(.22,.66,.56,.13)],
  poster: [rect(.06,.06,.68,.25), rect(.35,.3,.57,.45), rect(.06,.51,.27,.24)],
  grid: [rect(.06,.06,.65,.19), rect(.43,.29,.49,.44), rect(.06,.35,.3,.32)],
  focus: [rect(.06,.055,.54,.18), rect(.12,.25,.72,.48), rect(.62,.61,.31,.17)],
  stage: [rect(.07,.15,.42,.32), rect(.54,.22,.39,.49), rect(.07,.55,.4,.21)],
  terminal: [rect(.07,.07,.84,.2), rect(.42,.33,.48,.4), rect(.07,.39,.28,.32)],
  game: [rect(.08,.06,.84,.16), rect(.2,.27,.6,.38), rect(.08,.665,.84,.135)],
  technical: [rect(.06,.065,.63,.17), rect(.17,.29,.5,.43), rect(.72,.44,.21,.3)],
  montage: [rect(.05,.06,.55,.29), rect(.42,.3,.52,.44), rect(.07,.54,.29,.23)],
  archive: [rect(.065,.065,.63,.19), rect(.14,.28,.61,.44), rect(.68,.6,.25,.17)],
  news: [rect(.05,.07,.52,.32), rect(.61,.22,.33,.44), rect(.05,.57,.5,.2)],
  diagram: [rect(.06,.06,.68,.18), rect(.22,.3,.56,.42), rect(.08,.68,.84,.12)],
  product: [rect(.07,.16,.36,.29), rect(.49,.2,.44,.54), rect(.07,.56,.35,.19)],
  cinema: [rect(.06,.07,.54,.18), rect(.2,.24,.65,.47), rect(.08,.65,.64,.14)],
};
export function creativeLayout(spec: CreativeRenderSpec, width: number, height: number) {
  const [title,subject,note] = layouts[spec.layout];
  if(height>width*1.1 && spec.layout!=='scroll') return { title:rect(.075,.055,.85,.21), subject:rect(.12,.3,.76,.34), note:rect(.075,.68,.85,.13) };
  return {title,subject,note};
}
export const creativeClamp = (value: number) => Math.max(0,Math.min(1,value));
export const creativeEase = (value: number) => { const n=creativeClamp(value); return n*n*(3-2*n); };
/** The action clock is the spoken cue. Stepping affects poses only, never the camera. */
export function creativeMotion(spec: CreativeRenderSpec, atMs: number, startMs: number, endMs: number, durationMs: number) {
  const room=Math.max(1,Math.min(spec.durationMs,endMs-startMs||spec.durationMs,durationMs-250-startMs));
  const poseMs=spec.stepFps?Math.floor(atMs*spec.stepFps/1000)*1000/spec.stepFps:atMs;
  const raw=creativeClamp((poseMs-startMs)/room),progress=creativeEase(raw);
  const arrival=spec.reveal==='elastic'?1+Math.sin(raw*Math.PI*2.5)*(1-raw)*.18:progress;
  const camera=creativeEase(atMs/Math.max(1,durationMs-250));
  return { progress, raw, arrival, camera, x:spec.travelX*camera, y:spec.travelY*camera, zoom:1+spec.zoom*camera, rotation:spec.tilt*(1-arrival) };
}
