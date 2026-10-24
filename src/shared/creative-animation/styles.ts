import catalog from './lemo-catalog.json';

export const LEMO_REVISION = '3961ddb3d24d8876e0e2754f7790d66908acee51';
export const CREATIVE_ADAPTER_REVISION = 1;
const adapters: Record<string, { background: string; foreground: string; accent: string; direction: string }> = {
  'halftone-dossier': { background: '#efe7d4', foreground: '#25251e', accent: '#bb4030', direction: 'Cream paper, ink halftone dots, stamped evidence, oversized restrained headings. Reveal one concrete idea at a time.' },
  'archive-lighttable': { background: '#eee6d4', foreground: '#292921', accent: '#a5412f', direction: 'Lighttable archive, photographic evidence, thin provenance labels, slow purposeful camera. Preserve original evidence without invented annotations.' },
  dataviz: { background: '#f4eedf', foreground: '#272c30', accent: '#bf4939', direction: 'The chart is the story. Draw exact supplied values on consistent axes with source and unit. Annotate the relevant mark at its narration cue.' },
  'swiss-motion': { background: '#f1eee6', foreground: '#171a1a', accent: '#df3828', direction: 'Swiss grid, asymmetric typography, disciplined whitespace, strong red accent and meaningful geometric transitions.' },
  'dark-keynote': { background: '#10151d', foreground: '#f0f3f7', accent: '#73b8f0', direction: 'Dark stage, large legible typography, restrained spotlight, polished easing and a single visual focus per beat.' },
  'paper-popup': { background: '#eee6d7', foreground: '#302b28', accent: '#b94d36', direction: 'Cut-paper pop-up theatre, hinged paper elements, layered depth, soft shadows and readable pauses.' },
};
const descriptions: Record<string, string> = {
  'halftone-dossier': '米色纸张、半调网点与证据标记，逐条揭示观点。',
  'archive-lighttable': '以真实档案为中心，保留出处，用缓慢镜头突出证据。',
  dataviz: '以准确图表解释数据，随旁白强调当前数值，保留单位和来源。',
  'swiss-motion': '网格排版、清晰留白与红色强调，用文字和图形表达关系。',
  'dark-keynote': '深色舞台、大字与克制的聚光，每段聚焦一个核心观点。',
  'paper-popup': '纸张折叠、层次和柔和阴影，以立体纸景展开叙述。',
};
export const CREATIVE_STYLES = catalog.map(style => ({ ...style, description: descriptions[style.slug], readiness: adapters[style.slug] ? 'adapted' as const : 'collected' as const, adapter: adapters[style.slug] }));
export const creativeStyle = (slug: string) => CREATIVE_STYLES.find(style => style.slug === slug);
export function resolveCreativeStyle(styleId: string | undefined, presetId: string) {
  return creativeStyle(!styleId || styleId === 'auto' ? presetId === 'data-map' ? 'dataviz' : presetId === 'archival-story' ? 'archive-lighttable' : 'halftone-dossier' : styleId);
}
