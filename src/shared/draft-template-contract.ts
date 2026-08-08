import { z } from 'zod';
import { draftFontFamilies, draftImageMotions, imageAnimations } from './templates';
import type { DraftTemplate } from './types';

const MAX_TEXT = 65_536;
const finite = z.number().finite();
const color = z.string().regex(/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu, 'Invalid color.');
const ratio = z.string().regex(/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/u, 'Invalid ratio.').max(64);
const coordinate = finite.min(-2).max(2);
const width = finite.min(0.1).max(2);
const alpha = finite.min(0).max(1);
const catalogValue = z.string().max(1024).refine(
  (value) => !['__proto__', 'prototype', 'constructor'].includes(value) && !/[\u0000-\u001f\u007f]/u.test(value),
  'Invalid catalog value.',
);

const borderSchema = z.object({
  color,
  width: finite.min(0).max(500),
  alpha,
}).strict();

const textStyleShape = {
  visible: z.boolean(),
  x: coordinate,
  y: coordinate,
  width,
  fontSize: finite.min(1).max(500),
  fontFamily: z.enum(draftFontFamilies),
  color,
  alpha,
  bold: z.boolean(),
  underline: z.boolean(),
  align: finite.int().min(0).max(2),
  letterSpacing: finite.min(-100).max(100),
  lineSpacing: finite.min(-100).max(100),
  border: borderSchema,
};

const textLayerSchema = z.object({
  ...textStyleShape,
  text: z.string().max(MAX_TEXT),
}).strict();

export const draftTemplateSchema: z.ZodType<DraftTemplate> = z.object({
  id: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/u),
  name: z.string().trim().min(1).max(1024),
  isDefault: z.boolean(),
  updatedAt: z.string().max(128).optional(),
  canvas: z.object({
    width: finite.int().min(1).max(8192),
    height: finite.int().min(1).max(8192),
    ratio,
    backgroundColor: color,
    backgroundImage: z.string().max(4096),
  }).strict(),
  image: z.object({
    visible: z.boolean(),
    ratio,
    fit: z.enum(['cover', 'contain']),
    focusX: finite.min(0).max(1).default(0.5),
    focusY: finite.min(0).max(1).default(0.5),
    left: finite.min(0).max(1).default(0),
    top: coordinate,
    width: finite.min(0).max(1).default(1),
    height: finite.min(0).max(2),
    mediaScale: finite.min(1).max(8).default(1),
    animation: z.string().max(256).refine((value) => imageAnimations.includes(value), 'Unknown image animation.'),
    motion: z.enum(draftImageMotions.map((option) => option.value) as [DraftTemplate['image']['motion'], ...DraftTemplate['image']['motion'][]]),
    motionStrength: finite.min(0).max(2),
  }).strict(),
  frame: z.object({
    enabled: z.boolean(),
    headerColor: color,
    headerColorEnd: color,
    footerColor: color,
    footerColorEnd: color,
    imageBorderColor: color,
    imageBorderWidth: finite.min(0).max(500),
    imageBorderSides: z.enum(['all', 'horizontal', 'vertical']),
  }).strict(),
  title: textLayerSchema,
  subtitle: textLayerSchema,
  caption: z.object({
    ...textStyleShape,
    maxCharsPerLine: finite.int().min(1).max(500),
    background: z.object({
      color,
      alpha,
      roundRadius: finite.min(0).max(1),
    }).strict(),
  }).strict(),
  disclaimer: textLayerSchema,
  audio: z.object({
    narrationVolume: finite.min(0).max(10),
    bgmVolume: finite.min(0).max(10),
    transitionType: catalogValue,
    transitionDurationMs: finite.int().min(0).max(600_000),
    narrationFadeInMs: finite.int().min(0).max(600_000),
    narrationFadeOutMs: finite.int().min(0).max(600_000),
    bgmFadeInMs: finite.int().min(0).max(600_000),
    bgmFadeOutMs: finite.int().min(0).max(600_000),
    filterType: catalogValue,
    videoEffectType: catalogValue,
    audioEffectType: catalogValue,
  }).strict(),
}).strict();

export function parseDraftTemplate(value: unknown): DraftTemplate {
  assertNoPrototypePollution(value);
  return draftTemplateSchema.parse(value);
}

function assertNoPrototypePollution(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error(`DRAFT_TEMPLATE_UNSAFE_KEY: ${key}`);
    }
    assertNoPrototypePollution((value as Record<string, unknown>)[key], seen);
  }
}
