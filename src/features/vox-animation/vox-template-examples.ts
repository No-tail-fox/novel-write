import { createVoxAnimation, voxItemSchema, voxTemplate, type VoxAnimation, type VoxAnimationCue } from '../../shared/vox-animation';
import type { VoxLocalAsset } from './VoxAnimationPreview';

interface ExampleAsset extends VoxLocalAsset { url: string; }
const svg = (body: string, width = 960, height = 640) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`)}`;
const svgText = (text: string, y: number, color = '#242820', size = 56) => `<text x="50%" y="${y}" text-anchor="middle" fill="${color}" font-size="${size}" font-family="Microsoft YaHei,sans-serif" font-weight="700">${text}</text>`;
const exampleImage = (id: string, label: string, url: string): ExampleAsset => ({ id: `vox-example-${id}`, label, kind: 'image', path: `vox-example:${id}`, url });
let cachedAssets: readonly ExampleAsset[] | undefined;

/** Fully local illustrations and a changing test tone; never read or modify project media. */
export function voxTemplateExampleAssets(): readonly ExampleAsset[] {
  if (cachedAssets) return cachedAssets;
  const sampleRate = 12000, samples = sampleRate * 8;
  const bytes = new Uint8Array(44 + samples * 2), view = new DataView(bytes.buffer);
  const word = (offset: number, text: string) => [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) {
    const seconds = i / sampleRate, envelope = .2 + .7 * (.5 + .5 * Math.sin(seconds * 7));
    const tone = Math.sin(2 * Math.PI * (120 * seconds + 30 * seconds * seconds));
    view.setInt16(44 + i * 2, Math.round(tone * envelope * 18000), true);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  cachedAssets = [
    exampleImage('background', '示例纸面背景', svg('<rect width="960" height="640" fill="#e8dfcc"/><path d="M0 440L210 330L450 460L730 300L960 370V640H0" fill="#9cad91"/><circle cx="770" cy="145" r="75" fill="#c7513b"/><path d="M40 75H420M40 95H350" stroke="#b9ab92" stroke-width="4"/>')),
    exampleImage('subject', '示例透明纸片主体', svg('<path d="M300 200Q300 65 480 65Q660 65 660 200Q670 290 565 385L550 455H410L395 385Q290 290 300 200Z" fill="#d5a342" stroke="#fffaf0" stroke-width="18"/><path d="M420 470H540M425 505H535M450 535H510" stroke="#315b4e" stroke-width="22" stroke-linecap="round"/><path d="M400 225L465 320L550 190" fill="none" stroke="#fffaf0" stroke-width="16" stroke-linecap="round"/>')),
    exampleImage('cover', '示例书封', svg('<rect width="600" height="800" fill="#315b4e"/><rect x="35" y="35" width="530" height="730" fill="none" stroke="#d5a342" stroke-width="5"/><circle cx="300" cy="300" r="125" fill="#d5a342"/><path d="M180 450L300 220L420 450Z" fill="#eee8dc"/>' + svgText('示例书封', 600, '#eee8dc') + svgText('动画演示素材', 670, '#eee8dc', 28), 600, 800)),
    exampleImage('page', '示例书页', svg('<rect width="600" height="800" fill="#fffaf0"/>' + svgText('示例内页', 160) + '<path d="M70 240H530M70 280H530M70 320H450M70 450H530M70 490H530M70 530H480" stroke="#b9ab92" stroke-width="12"/><rect x="65" y="590" width="470" height="90" fill="#c7513b"/>', 600, 800)),
    { id: 'vox-example-audio', label: '示例合成音源', kind: 'audio', path: 'vox-example:audio', url: `data:audio/wav;base64,${btoa(binary)}` },
  ];
  return cachedAssets;
}

export function createVoxTemplateExample(id: string): { animation: VoxAnimation; durationMs: number; cues: VoxAnimationCue[] } {
  const template = voxTemplate(id);
  if (!template) throw new Error('动画模板不存在');
  const animation = createVoxAnimation(template.name, '观察、整理、表达');
  animation.template.id = id;
  if (template.recipe) animation.template.revision = 1;
  const p = animation.template.props;
  p.source = '动画示例 · 非项目内容'; p.author = '示例署名'; p.highlight = '整理'; p.unit = '份';
  p.items = [
    { label: '观察', detail: '让第一张纸片进入', value: 24, date: '01', lng: 20, lat: 10 },
    { label: '整理', detail: '展开下一条信息', value: 48, date: '02', lng: 60, lat: 30 },
    { label: '表达', detail: '停留并读完内容', value: 72, date: '03', lng: 100, lat: 20 },
  ].slice(0, template.maxItems ?? 3).map(item => voxItemSchema.parse(item));
  if (id === 'time-year-counter') p.items.forEach((item, i) => { item.date = String(i ? 2030 : 2020); });
  if (template.map) p.items.forEach((item, i) => { item.label = `示例点 ${i + 1}`; item.detail = '虚构路线，仅演示动画'; });
  if (id === 'map-region') p.geoJson = JSON.stringify({ type: 'Polygon', coordinates: [[[20, 10], [60, 10], [65, 40], [30, 45], [20, 10]]] });
  const imageIds = id === 'paper-actors' ? ['background', 'subject'] : template.kind === 'book' ? ['cover', 'page', 'cover'] : ['cover', 'page', 'subject'];
  p.assetIds = (template.recipe && template.maxImages === 0 ? [] : imageIds.slice(0, template.maxImages ?? 3)).map(key => `vox-example-${key}`);
  if (template.audio) p.audioAssetId = 'vox-example-audio';
  const durationMs = Math.round((template.recipe?.recommendedSeconds ?? 6) * 1000);
  const cues: VoxAnimationCue[] = ['这是动画示例', '文字按时间逐步出现', '应用后再编辑你的内容'].map((text, i) => ({
    id: `example-cue-${i}`, text, startMs: durationMs * i / 3, endMs: durationMs * (i + 1) / 3,
    tokens: [...text].map((text, j, chars) => ({ text, startMs: durationMs * (i + j / chars.length) / 3, endMs: durationMs * (i + (j + 1) / chars.length) / 3 })),
  }));
  return { animation, durationMs, cues: ['audio-captions', 'audio-lyrics'].includes(id) ? cues : [] };
}
