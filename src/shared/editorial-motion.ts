import type { EditorialCollageLayer, EditorialLayerKind, EditorialLayerMotionKeyframe } from './editorial-collage';

export const EDITORIAL_MOTION_STYLE_IDS = ['cutout-slide', 'focus-reveal', 'evidence-stack', 'path-progress', 'comparison'] as const;
export type EditorialMotionStyle = (typeof EDITORIAL_MOTION_STYLE_IDS)[number];
export const EDITORIAL_MOTION_STYLES: ReadonlyArray<{ id: EditorialMotionStyle; label: string; description: string }> = [
  { id: 'cutout-slide', label: '切片入场', description: '主体从画外切入、轻微旋转后停稳，标题错时出现。' },
  { id: 'focus-reveal', label: '聚焦揭示', description: '主体由小到大显现，再缓慢放大突出细节，标题定点揭示。' },
  { id: 'evidence-stack', label: '证据落版', description: '证据从上方旋转落下，再缩小归档；多条证据错时出现。' },
  { id: 'path-progress', label: '路径推进', description: '主体沿折线路径推进，在不同位置停顿，呈现过程和变化。' },
  { id: 'comparison', label: '并列对比', description: '两组内容先后出场并左右并列，依次放大强调差异；没有明确两组对象时以主体和标题并列。' },
];

export function editorialMotionDescription(style: EditorialMotionStyle): string {
  return EDITORIAL_MOTION_STYLES.find((item) => item.id === style)!.description;
}

export interface EditorialMotionLayerInput {
  shotId: string;
  narration: string;
  title: string;
  durationMs: number;
  ratio: string;
  index: number;
  evidence?: boolean;
  motionStyle?: EditorialMotionStyle;
}

/** Extract only comparison clauses actually stated in the copy. Never invent a second actor. */
export function editorialComparisonSubjects(narration: string): [string, string] | undefined {
  const copy = narration.replace(/\s+/g, ' ').trim();
  const patterns = [
    /([^。！？!?；;，,]{2,20}?)(?:和|与)([^。！？!?；;，,]{2,20}?)(?:的)?(?:区别|差异|对比|比较)/,
    /(?:相比(?:之下)?[，,:：]?\s*)?([^。！？!?；;]{2,48}?)\s*(?:相比于|相较于|对比| versus | vs\.? )\s*([^。！？!?；;]{2,48})/i,
    /(?:一边|一方面)[是为：:\s]*([^。！？!?；;]{2,48}?)[，,；;]\s*(?:另一边|另一方面)[是为：:\s]*([^。！？!?；;]{2,48})/,
    /(?:过去|以前|从前|曾经)[：:\s]*([^。！？!?；;]{2,48}?)[，,；;。]\s*(?:而?现在|如今)[：:\s]*([^。！？!?；;]{2,48})/,
    /(?:从)([^。！？!?；;，,]{2,24}?)(?:变成|变为|转向|变到)([^。！？!?；;，,]{2,24})/,
  ];
  for (const pattern of patterns) {
    const found = copy.match(pattern);
    if (!found) continue;
    const pair = [found[1].trim().replace(/[，,：:]+$/g, ''), found[2].trim().replace(/[，,：:]+$/g, '')] as [string, string];
    if (pair[0] !== pair[1] && pair.every((part) => part.length >= 2)) return pair;
  }
  return undefined;
}

/** Semantic choices take priority; otherwise neighbouring scenes use different compositions. */
export function selectEditorialMotionStyle(input: Pick<EditorialMotionLayerInput, 'narration' | 'index' | 'evidence' | 'motionStyle'>): EditorialMotionStyle {
  if (input.motionStyle) return input.motionStyle;
  if (editorialComparisonSubjects(input.narration)) return 'comparison';
  if (input.evidence || /数据|证据|调查|档案|研究发现|统计|报告显示|记录|实验结果|\d+(?:\.\d+)?[%％]/.test(input.narration)) return 'evidence-stack';
  if (/随后|接着|逐渐|一步|流程|路线|沿着|经过|传到|传入|流向|演变|历经|从.+(?:走到|抵达|到达)/.test(input.narration)) return 'path-progress';
  if (/秘密|关键|原因|答案|细节|揭开|揭示|发现|核心|为什么|究竟/.test(input.narration)) return 'focus-reveal';
  return (['cutout-slide', 'focus-reveal', 'path-progress', 'evidence-stack'] as const)[Math.abs(input.index) % 4];
}

/** Keep the environment and actor prompts separate so they can actually move independently. */
export function editorialLayerPrompt(kind: EditorialLayerKind, narration: string): string {
  if (kind === 'background') return `Editorial documentary collage environment for: ${narration}. Background plate only: textured paper and contextual scenery, generous negative space. No people, no foreground hero objects, no labels, no letters, no numbers, no watermark. The subject will be composited separately.`;
  return `One isolated editorial photographic cutout representing: ${narration}. A single complete subject or evidence object, centered and fully in frame with clear silhouette and generous margin. Solid pure green chroma-key background (#00FF00), no green on the subject. No scene background, no floor, no cast shadow, no text, no labels, no watermark. The background will be removed for paper collage animation.`;
}

/** Separate artwork and native text, with choreography chosen for the narration. */
export function createEditorialMotionLayers(input: EditorialMotionLayerInput): EditorialCollageLayer[] {
  const portrait = input.ratio === '9:16';
  const direction = input.index % 2 === 0 ? 1 : -1;
  const subjectX = portrait ? 0.5 : direction === 1 ? 0.65 : 0.35;
  const labelX = portrait ? 0.5 : direction === 1 ? 0.24 : 0.76;
  const subjectY = portrait ? 0.48 : 0.47;
  const labelY = portrait ? 0.17 : 0.25;
  const at = (fraction: number) => Math.round(input.durationMs * fraction);
  const style = selectEditorialMotionStyle(input);
  const subjectKind = input.evidence || style === 'evidence-stack' ? 'archival' : 'subject';
  const layers: EditorialCollageLayer[] = [
    {
      id: `${input.shotId}-background`, label: '独立场景底板', kind: 'background', source: 'generated-image',
      zIndex: 0, depth: -0.08, width: 1.04, height: 1.04, fit: 'cover', required: true,
      prompt: editorialLayerPrompt('background', input.narration),
      motion: [
        { atMs: 0, x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 },
        { atMs: input.durationMs, x: 0.5 - direction * 0.012, y: 0.5, scale: 1.02, rotation: 0, opacity: 1 },
      ],
    },
    {
      id: `${input.shotId}-subject`, label: subjectKind === 'archival' ? '独立证据切片' : '独立主体切片',
      kind: subjectKind, source: 'generated-image', zIndex: 10, depth: 0.12,
      width: portrait ? 0.9 : 0.64, height: portrait ? 0.59 : 0.76, fit: 'contain', required: true,
      prompt: editorialLayerPrompt(subjectKind, input.narration),
      motion: [
        { atMs: 0, x: subjectX + direction * 0.9, y: subjectY + 0.08, scale: 0.88, rotation: direction * 12, opacity: 0 },
        { atMs: at(0.05), x: subjectX + direction * 0.9, y: subjectY + 0.08, scale: 0.88, rotation: direction * 12, opacity: 0 },
        { atMs: at(0.16), x: subjectX - direction * 0.025, y: subjectY - 0.012, scale: 1.025, rotation: -direction * 2.5, opacity: 1 },
        { atMs: at(0.23), x: subjectX, y: subjectY, scale: 1, rotation: -direction * 1.5, opacity: 1 },
        { atMs: at(0.86), x: subjectX - direction * 0.025, y: subjectY - 0.012, scale: 1.015, rotation: direction * 0.5, opacity: 1 },
        { atMs: input.durationMs, x: subjectX - direction * 0.75, y: subjectY - 0.06, scale: 0.96, rotation: -direction * 8, opacity: 0 },
      ],
    },
    {
      id: `${input.shotId}-label`, label: input.title, kind: 'label', source: 'svg', zIndex: 20, depth: 0.2,
      width: portrait ? 0.82 : 0.37, height: portrait ? 0.13 : 0.19, fit: 'contain', required: true,
      content: { type: 'text', text: input.title.trim() },
      ...(!input.title.trim() ? { visible: false } : {}),
      motion: [
        { atMs: 0, x: labelX, y: labelY - 0.16, scale: 0.92, rotation: -direction * 5, opacity: 0 },
        { atMs: at(0.18), x: labelX, y: labelY - 0.16, scale: 0.92, rotation: -direction * 5, opacity: 0 },
        { atMs: at(0.27), x: labelX, y: labelY + 0.01, scale: 1.025, rotation: direction * 1.5, opacity: 1 },
        { atMs: at(0.33), x: labelX, y: labelY, scale: 1, rotation: 0, opacity: 1 },
        { atMs: at(0.9), x: labelX, y: labelY, scale: 1, rotation: 0, opacity: 1 },
        { atMs: input.durationMs, x: labelX, y: labelY - 0.14, scale: 0.96, rotation: direction * 3, opacity: 0 },
      ],
    },
  ];
  if (style === 'cutout-slide') return layers;

  const [background, subject, label] = layers;
  const frame = (fraction: number, x: number, y: number, scale = 1, rotation = 0, opacity = 1): EditorialLayerMotionKeyframe => ({ atMs: at(fraction), x, y, scale, rotation, opacity });
  label.width = portrait ? 0.84 : 0.68;
  label.height = portrait ? 0.13 : 0.15;
  label.motion = [frame(0, 0.5, 0.16, 0.95, 0, 0), frame(0.15, 0.5, 0.16, 0.95, 0, 0), frame(0.25, 0.5, 0.16), frame(0.91, 0.5, 0.16), frame(1, 0.5, 0.16, 1, 0, 0)];

  if (style === 'focus-reveal') {
    subject.width = portrait ? 0.88 : 0.68;
    subject.height = portrait ? 0.6 : 0.7;
    subject.motion = [
      frame(0, 0.5, 0.53, 0.12, 0, 0), frame(0.04, 0.5, 0.53, 0.12, 0, 0),
      frame(0.19, 0.5, 0.53, 1.04), frame(0.28, 0.5, 0.53, 0.9),
      frame(0.82, 0.5, 0.5, 1.1), frame(0.93, 0.5, 0.5, 1.1), frame(1, 0.5, 0.5, 1.15, 0, 0),
    ];
    background.motion = [frame(0, 0.5, 0.5, 1.07), frame(0.3, 0.5, 0.5), frame(1, 0.5, 0.5)];
    return layers;
  }

  if (style === 'path-progress') {
    subject.width = portrait ? 0.58 : 0.4;
    subject.height = portrait ? 0.46 : 0.54;
    const startX = portrait ? 0.3 : 0.19;
    const endX = portrait ? 0.68 : 0.8;
    subject.motion = [
      frame(0, startX, 0.69, 0.6, -4, 0), frame(0.12, startX, 0.69, 0.88, -4),
      frame(0.3, startX, 0.69, 0.88, -4), frame(0.43, 0.5, 0.43, 0.96, 3),
      frame(0.62, 0.5, 0.43, 0.96, 3), frame(0.75, endX, 0.61, 1, 0),
      frame(0.93, endX, 0.61, 1, 0), frame(1, endX, 0.61, 0.85, 0, 0),
    ];
    // A counter-moving environment gives the actor a sense of travelling through space.
    background.motion = [frame(0, 0.51, 0.49, 1.06), frame(0.43, 0.5, 0.51, 1.06), frame(1, 0.47, 0.49, 1.06)];
    label.motion = [frame(0, 0.5, 0.15, 1, 0, 0), frame(0.12, 0.5, 0.15), frame(0.91, 0.5, 0.15), frame(1, 0.5, 0.15, 1, 0, 0)];
    return layers;
  }

  if (style === 'evidence-stack') {
    const excerpts = input.narration.split(/[。！？!?；;]/).map((part) => part.trim()).filter((part) => part.length >= 4);
    const secondExcerpt = excerpts.length >= 2 && excerpts[0] !== excerpts[1] ? excerpts[1] : undefined;
    subject.width = portrait ? 0.72 : 0.6;
    subject.height = portrait ? 0.58 : 0.7;
    const archivedX = secondExcerpt ? portrait ? 0.31 : 0.26 : 0.46;
    subject.prompt = editorialLayerPrompt('archival', secondExcerpt ? excerpts[0] : input.narration);
    subject.motion = [
      frame(0, 0.53, -0.45, 1.2, -23, 0), frame(0.05, 0.53, -0.45, 1.2, -23, 0),
      frame(0.2, 0.5, 0.53, 1, 4), frame(0.27, 0.5, 0.52, 1, -3),
      frame(0.44, 0.5, 0.52, 1, -3), frame(0.58, archivedX, 0.55, secondExcerpt ? 0.64 : 0.93, -11),
      frame(0.92, archivedX, 0.55, secondExcerpt ? 0.64 : 0.93, -11), frame(1, archivedX, 0.75, 0.55, -14, 0),
    ];
    if (secondExcerpt) layers.splice(2, 0, {
      ...subject, id: `${input.shotId}-subject-secondary`, label: '第二条证据切片', zIndex: 11,
      prompt: editorialLayerPrompt('archival', secondExcerpt),
      motion: [frame(0, 0.69, -0.5, 1.15, 21, 0), frame(0.48, 0.69, -0.5, 1.15, 21, 0), frame(0.65, 0.66, 0.53, 0.82, 4), frame(0.74, 0.66, 0.53, 0.78, 2), frame(0.94, 0.66, 0.53, 0.78, 2), frame(1, 0.66, 0.74, 0.65, 8, 0)],
    });
    return layers;
  }

  const pair = editorialComparisonSubjects(input.narration);
  subject.width = portrait ? 0.46 : 0.43;
  subject.height = portrait ? 0.44 : 0.64;
  subject.prompt = editorialLayerPrompt(subjectKind, pair?.[0] ?? input.narration);
  subject.motion = [frame(0, 0.26, 0.53, 0.2, 0, 0), frame(0.16, 0.26, 0.53), frame(0.38, 0.26, 0.53), frame(0.49, 0.26, 0.53, 1.1), frame(0.59, 0.26, 0.53), frame(0.69, 0.26, 0.53, 0.92, 0, 0.7), frame(0.88, 0.26, 0.53), frame(1, 0.26, 0.53, 0.88, 0, 0)];
  background.motion = [frame(0, 0.5, 0.5), frame(1, 0.5, 0.5)];
  if (pair) {
    layers.splice(2, 0, {
      ...subject, id: `${input.shotId}-subject-secondary`, label: '对比主体切片', zIndex: 11,
      prompt: editorialLayerPrompt(subjectKind, pair[1]),
      motion: [frame(0, 0.74, 0.53, 0.2, 0, 0), frame(0.2, 0.74, 0.53, 0.2, 0, 0), frame(0.36, 0.74, 0.53), frame(0.49, 0.74, 0.53, 0.92, 0, 0.7), frame(0.59, 0.74, 0.53), frame(0.69, 0.74, 0.53, 1.1), frame(0.88, 0.74, 0.53), frame(1, 0.74, 0.53, 0.88, 0, 0)],
    });
    pair.forEach((text, index) => layers.push({
      id: `${input.shotId}-comparison-label-${index}`, label: text, kind: 'label', source: 'svg',
      zIndex: 21, depth: 0.2, width: 0.42, height: portrait ? 0.11 : 0.12, fit: 'contain', required: true,
      content: { type: 'text', text },
      motion: [frame(0, index ? 0.74 : 0.26, 0.73, 1, 0, 0), frame(index ? 0.35 : 0.15, index ? 0.74 : 0.26, 0.73, 1, 0, 0), frame(index ? 0.43 : 0.23, index ? 0.74 : 0.26, 0.73), frame(0.93, index ? 0.74 : 0.26, 0.73), frame(1, index ? 0.74 : 0.26, 0.73, 1, 0, 0)],
    }));
  } else {
    // User-chosen split layout without two concrete subjects: pair the artwork with the actual title.
    label.width = portrait ? 0.44 : 0.4;
    label.height = portrait ? 0.23 : 0.29;
    label.motion = [frame(0, 0.74, 0.49, 0.9, 0, 0), frame(0.24, 0.74, 0.49, 0.9, 0, 0), frame(0.37, 0.74, 0.49), frame(0.9, 0.74, 0.49), frame(1, 0.74, 0.49, 0.95, 0, 0)];
  }
  return layers;
}

/** Re-choreograph stable slots while keeping selected media and authored extra layers. */
export function recomposeEditorialMotionLayers(previousLayers: readonly EditorialCollageLayer[], input: EditorialMotionLayerInput): EditorialCollageLayer[] {
  const nextLayers = createEditorialMotionLayers(input);
  const used = new Set<string>();
  const managedId = (id: string) => id === `${input.shotId}-background` || id === `${input.shotId}-subject`
    || id === `${input.shotId}-subject-secondary` || id === `${input.shotId}-label`
    || id.startsWith(`${input.shotId}-comparison-label-`);
  const result = nextLayers.map((next) => {
    // Older/split scenes may have different IDs; their first matching role still owns its media.
    const previous = previousLayers.find((layer) => layer.id === next.id)
      ?? (next.id === `${input.shotId}-background` ? previousLayers.find((layer) => layer.kind === 'background')
        : next.id === `${input.shotId}-subject` ? previousLayers.find((layer) => ['subject', 'archival'].includes(layer.kind))
          : next.id === `${input.shotId}-subject-secondary` ? previousLayers.filter((layer) => ['subject', 'archival'].includes(layer.kind))[1]
            : next.id === `${input.shotId}-label` ? previousLayers.find((layer) => layer.kind === 'label' && layer.content?.type === 'text')
              : next.id.startsWith(`${input.shotId}-comparison-label-`) ? previousLayers.filter((layer) => layer.kind === 'label' && layer.content?.type === 'text')[Number(next.id.at(-1)) + 1] : undefined);
    if (!previous || used.has(previous.id)) return next;
    used.add(previous.id);
    const generatedPrompt = previous.prompt?.startsWith('Editorial documentary collage environment for:')
      || previous.prompt?.startsWith('One isolated editorial photographic cutout representing:');
    return {
      ...previous, ...next, id: previous.id,
      ...(previous.assetVersionId ? { assetVersionId: previous.assetVersionId } : {}),
      ...(!next.content ? { source: previous.source, prompt: generatedPrompt ? next.prompt : previous.prompt ?? next.prompt } : {}),
      ...(next.visible === false || (previous.visible === false && previous.required !== false) ? { visible: false } : { visible: true }),
    };
  });
  for (const previous of previousLayers) {
    if (used.has(previous.id)) continue;
    // Retain inactive generated slots so returning to comparison/stack restores their assets.
    if (managedId(previous.id) || (previous.id.startsWith(`${input.shotId}-layer-`) && previous.required !== undefined)) result.push({ ...previous, visible: false, required: false });
    else result.push(previous);
  }
  return result;
}
