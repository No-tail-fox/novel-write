import { z } from 'zod';
import type { ViralAnalysisResult } from './types';

const text = z.string().max(500000);
const optionalText = text.default('');
const texts = z.array(text).max(10000).default([]);
const section = z.object({ type: optionalText, analysis: optionalText, reusablePattern: optionalText });
const resultSchema = z.object({
  schemaVersion: z.literal(2).optional(), recreationState: z.enum(['not-requested', 'completed']).optional(),
  referenceAnalysisRef: z.object({ path: text, hash: z.string().regex(/^[a-f0-9]{64}$/), revision: z.number().int().positive() }).optional(),
  source: z.object({
    kind: z.enum(['url', 'local']).optional(), platform: z.enum(['douyin', 'kuaishou', 'bilibili', 'unknown']),
    url: optionalText, normalizedUrl: optionalText,
    downloadProvider: z.enum(['douyin-internal', 'kuaishou-playwright', 'bilibili-internal', 'local-import']),
    usedCookieSource: z.enum(['none', 'browser-chrome', 'browser-edge', 'cookie-file']),
    videoPath: optionalText, coverPath: optionalText, title: optionalText, author: optionalText, duration: z.number().nonnegative(),
    stats: z.object({ likes: z.number().nullable(), comments: z.number().nullable(), shares: z.number().nullable() }),
  }),
  transcript: z.array(z.object({ text, start: z.number().nonnegative(), end: z.number().nonnegative(),
    words: z.array(z.object({ word: text, start: z.number().nonnegative(), end: z.number().nonnegative() })).default([]) })),
  frames: z.array(z.object({ timestamp: z.number().nonnegative(), framePath: optionalText, shotType: optionalText,
    cameraMovement: optionalText, composition: optionalText, transition: optionalText, textOverlay: text.nullable().default(null),
    visualDescription: optionalText, mood: optionalText, keyElements: texts, imagePrompt: optionalText })),
  contentBreakdown: z.object({ topic: optionalText,
    title: z.object({ original: optionalText, pattern: optionalText, suggestions: texts }),
    cover: z.object({ observed: optionalText, pattern: optionalText, suggestions: texts }),
    opening: section, structure: z.object({ type: optionalText, analysis: optionalText, outline: texts }),
    ending: section, viralPoint: z.object({ summary: optionalText, evidence: texts, reusablePattern: optionalText }),
  }),
  recreation: z.object({
    formula: z.object({ main: optionalText, title: optionalText, cover: optionalText, opening: optionalText, structure: optionalText, ending: optionalText }).default({ main: '', title: '', cover: '', opening: '', structure: '', ending: '' }),
    templatePrompt: optionalText,
    storyCore: z.object({ who: optionalText, where: optionalText, whatHappened: optionalText, why: optionalText, turningPoint: optionalText, result: optionalText }).default({ who: '', where: '', whatHappened: '', why: '', turningPoint: '', result: '' }),
    storyContent: optionalText, blueprint: optionalText, script: optionalText, openingOptions: texts, titleOptions: texts, coverIdeas: texts, storyboardHints: texts,
    taskDefaults: z.object({ track: optionalText, style: optionalText, ratio: optionalText, storyboardSceneCount: z.number().int().positive() }),
  }),
  createdAt: text,
}).superRefine((value, ctx) => {
  if (value.schemaVersion === 2 && (!value.referenceAnalysisRef || !value.recreationState)) {
    ctx.addIssue({ code: 'custom', message: '整体拆解结果必须引用独立报告，并声明复刻状态。' });
  }
});

/** Legacy reports have no schemaVersion; normalize optional older fields without writing them back. */
export function parseViralAnalysisResult(value: unknown): ViralAnalysisResult {
  return resultSchema.parse(value);
}
