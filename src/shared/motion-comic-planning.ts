/**
 * StoryDream adaptation of Jellyfish (a9678194) global entity/variant and source
 * evidence contracts, and shuohao-skills (7ebef4f2) script beat expansion,
 * ordered coverage and dialogue-fit gates. Modified for TypeScript, single-shot
 * remote video generation and non-destructive episode import (2026-09-18).
 * Both upstream projects are Apache-2.0; see third-party notices in this repo.
 */
import { z } from 'zod';
import type { AppErrorPayload } from './app-error';
import type { MotionComicCharacter, MotionComicDialogueCue, MotionComicEpisode, MotionComicPipelineData, MotionComicShot } from './motion-comic';

const text = (max = 8_000) => z.string().trim().min(1).max(max);
const key = text(256);
const optionalText = z.string().max(8_000).optional();
const keys = z.array(key).max(100);
const timestamp = z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)), '时间格式无效');
export const MOTION_COMIC_PLAN_VERSION = 1 as const;
export const MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH = 30_000;

export const motionComicSourceUnitSchema = z.object({ id: key, text: text(MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH) }).strict();
export type MotionComicSourceUnit = z.infer<typeof motionComicSourceUnitSchema>;
export const motionComicShotContinuitySchema = z.object({
  startState: text(), endState: text(), screenDirection: text(1_000), actionBeats: z.array(text(2_000)).min(1).max(8),
}).strict();
export type MotionComicShotContinuity = z.infer<typeof motionComicShotContinuitySchema>;

const lookSchema = z.object({
  key, existingLookId: key.optional(), label: text(512), appearancePrompt: text(), wardrobe: text(), continuityNotes: text(),
}).strict();
const characterSchema = z.object({
  key, existingCharacterId: key.optional(), name: text(512), aliases: z.array(text(512)).max(20), role: text(512),
  identityPrompt: text(), personality: text(), voiceNotes: text(), looks: z.array(lookSchema).min(1).max(12),
}).strict();
const locationSchema = z.object({
  key, existingSceneAssetId: key.optional(), label: text(512), description: text(), prompt: text(), continuityNotes: text(),
}).strict();
const propSchema = z.object({ key, existingPropId: key.optional(), label: text(512), description: text(), prompt: text() }).strict();
export const motionComicScriptBeatSchema = z.object({
  key, sourceUnitIds: keys.min(1), kind: z.enum(['action', 'dialogue', 'narration']), text: text(2_000),
  characterKey: key.optional(), emotion: optionalText,
}).strict();
export type MotionComicScriptBeat = z.infer<typeof motionComicScriptBeatSchema>;
export const motionComicScriptDraftSchema = z.object({
  title: text(512), logline: text(2_000),
  characters: z.array(characterSchema).max(40), sceneAssets: z.array(locationSchema).min(1).max(40), props: z.array(propSchema).max(60),
  scenes: z.array(z.object({
    key, actIndex: z.number().int().min(1).max(12), actTitle: text(512), actBoundaryReason: text(2_000),
    title: text(512), summary: text(), locationKey: key, beats: z.array(motionComicScriptBeatSchema).min(1).max(100),
  }).strict()).min(1).max(30),
}).strict();
export type MotionComicScriptDraft = z.infer<typeof motionComicScriptDraftSchema>;
export const motionComicPlannedShotSchema = z.object({
  key, sceneKey: key, title: text(512), durationSec: z.number().finite().min(3).max(60),
  prompt: text(), motionPrompt: text(), framing: text(512), characterLookKeys: keys, propKeys: keys, beatKeys: keys.min(1),
  continuity: motionComicShotContinuitySchema,
}).strict();
export type MotionComicPlannedShot = z.infer<typeof motionComicPlannedShotSchema>;
export const motionComicStoryboardDraftSchema = z.object({ shots: z.array(motionComicPlannedShotSchema).min(1).max(120) }).strict();
export type MotionComicStoryboardDraft = z.infer<typeof motionComicStoryboardDraftSchema>;

export const motionComicPlanAdjustmentSchema = z.object({
  path: text(512), kind: z.enum(['filled', 'normalized', 'duration', 'manual']),
  before: z.string().max(2_001), after: z.string().max(2_001),
}).strict();
export type MotionComicPlanAdjustment = z.infer<typeof motionComicPlanAdjustmentSchema>;
const adjustmentsSchema = z.array(motionComicPlanAdjustmentSchema).max(20_000);
export const motionComicScriptCheckpointSchema = z.object({
  script: motionComicScriptDraftSchema, repaired: z.boolean(), adjustments: adjustmentsSchema,
}).strict();
export type MotionComicScriptCheckpoint = z.infer<typeof motionComicScriptCheckpointSchema>;
// A local review may temporarily contain an empty text field while the author is typing.
// Generation still uses motionComicScriptDraftSchema and the strict checkpoint schema.
const editableScriptSchema = motionComicScriptDraftSchema.extend({
  scenes: motionComicScriptDraftSchema.shape.scenes.element.extend({
    beats: z.array(motionComicScriptBeatSchema.extend({ text: z.string().max(2_000) })).min(1).max(100),
  }).array().min(1).max(30),
});
export const motionComicPlanRecoverySchema = z.object({
  token: z.string().uuid(), projectId: key, sourceText: text(MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH),
  instructions: z.string().max(4_000), targetDurationSec: z.number().optional(),
  title: text(512), scenes: z.number().int().positive(), script: editableScriptSchema, createdAt: timestamp,
  // Optional for checkpoints written before the explicit script-review stage.
  phase: z.enum(['script-review', 'storyboard-failed']).optional(),
  adjustments: adjustmentsSchema.optional(),
  needsValidation: z.boolean().optional(),
}).strict();
export type MotionComicPlanRecovery = z.infer<typeof motionComicPlanRecoverySchema>;

export const motionComicPlanDraftSchema = z.object({
  version: z.literal(MOTION_COMIC_PLAN_VERSION), sourceText: text(MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH),
  sourceUnits: z.array(motionComicSourceUnitSchema).min(1).max(500), script: motionComicScriptDraftSchema,
  shots: z.array(motionComicPlannedShotSchema).min(1).max(120), targetDurationSec: z.number().finite().min(5).max(1_800).optional(),
  instructions: z.string().max(4_000).optional(), model: text(512), createdAt: timestamp,
  adjustments: adjustmentsSchema.optional(),
}).strict();
export type MotionComicPlanDraft = z.infer<typeof motionComicPlanDraftSchema>;
export const motionComicPlanInputSchema = z.object({
  id: key, expectedUpdatedAt: timestamp, sourceText: text(MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH),
  instructions: z.string().trim().max(4_000).optional(), targetDurationSec: z.number().finite().min(5).max(1_800).optional(),
  resumeToken: z.string().uuid().optional(),
  stage: z.enum(['script', 'storyboard']).optional(),
  scriptRevisionToken: z.string().uuid().optional(),
  restart: z.boolean().optional(),
  // Manual repair reuses the validated entity/script shape and skips the script LLM stage.
  scriptDraft: motionComicScriptDraftSchema.optional(),
}).strict();
export type MotionComicPlanInput = z.infer<typeof motionComicPlanInputSchema>;
export const motionComicApplyPlanInputSchema = z.object({
  id: key,
  expectedUpdatedAt: timestamp,
  plan: motionComicPlanDraftSchema,
  replaceStarter: z.boolean().optional(),
  sourceEpisodeId: key.optional(),
  reviewedAdjustments: z.boolean().optional(),
}).strict();
export type MotionComicApplyPlanInput = z.infer<typeof motionComicApplyPlanInputSchema>;
export interface MotionComicPlanningIssue {
  path: string;
  message: string;
  code?: 'DIALOGUE_SPEAKER_MISSING' | 'CHARACTER_REFERENCE_INVALID';
}
export const motionComicPlanningIssueSchema = z.object({
  path: key, message: text(2_000), code: z.enum(['DIALOGUE_SPEAKER_MISSING', 'CHARACTER_REFERENCE_INVALID']).optional(),
}).strict();
export const motionComicScriptFailureSchema = z.object({
  token: z.string().uuid(), projectId: key, sourceText: text(MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH),
  instructions: z.string().max(4_000), targetDurationSec: z.number().finite().positive().optional(),
  draft: motionComicScriptDraftSchema, issues: z.array(motionComicPlanningIssueSchema).min(1).max(500),
  adjustments: adjustmentsSchema, createdAt: timestamp,
}).strict();
export type MotionComicScriptFailure = z.infer<typeof motionComicScriptFailureSchema>;
export interface MotionComicPlanResult {
  plan: MotionComicPlanDraft;
  model: string;
  repaired: boolean;
  warnings: string[];
  summary: { characters: number; acts: number; scenes: number; shots: number; dialogueLines: number; durationSec: number; sourceUnits: number; coveredSourceUnits: number };
}
export type MotionComicPlanResponse =
  | { status: 'script-ready'; recovery: MotionComicPlanRecovery }
  | { status: 'complete'; result: MotionComicPlanResult }
  | { status: 'storyboard-failed'; error: AppErrorPayload; recovery: MotionComicPlanRecovery }
  | { status: 'script-invalid'; error: AppErrorPayload; failure: MotionComicScriptFailure };

/** Historical evidence of the accepted draft; manual edits do not rewrite source history. */
export const motionComicPlanningEvidenceSchema = z.object({
  version: z.literal(1), sourceText: text(MOTION_COMIC_PLAN_MAX_SOURCE_LENGTH), sourceUnits: z.array(motionComicSourceUnitSchema).min(1).max(500),
  sourceEpisodeId: key.optional(),
  model: text(512), createdAt: timestamp, targetDurationSec: z.number().finite().positive().optional(),
  adjustments: adjustmentsSchema.optional(), adjustmentsReviewedAt: timestamp.optional(),
  actAssignments: z.array(z.object({
    sceneId: key, actIndex: z.number().int().min(1).max(12), actTitle: text(512), actBoundaryReason: text(2_000),
  }).strict()).max(30).optional(),
  beats: z.array(z.object({ id: key, sceneId: key, sourceUnitIds: keys.min(1), kind: z.enum(['action', 'dialogue', 'narration']), text: text(2_000), characterId: key.optional() }).strict()).max(500),
  shotClaims: z.array(z.object({ shotId: key, beatIds: keys.min(1) }).strict()).max(120),
}).strict();
export type MotionComicPlanningEvidence = z.infer<typeof motionComicPlanningEvidenceSchema>;

export function motionComicSourceEpisodeIdForEpisode(
  document: MotionComicPipelineData,
  episode: MotionComicEpisode,
): string | undefined {
  const sourceEpisodes = document.sourceDocument?.episodes ?? [];
  const explicit = episode.planningEvidence?.sourceEpisodeId;
  if (explicit && sourceEpisodes.some((sourceEpisode) => sourceEpisode.id === explicit)) return explicit;
  const evidenceText = episode.planningEvidence?.sourceText.trim();
  return evidenceText ? sourceEpisodes.find((sourceEpisode) => sourceEpisode.sourceText.trim() === evidenceText)?.id : undefined;
}

export function plannedMotionComicSourceEpisodeIds(document: MotionComicPipelineData): Set<string> {
  return new Set(document.episodes.flatMap((episode) => motionComicSourceEpisodeIdForEpisode(document, episode) ?? []));
}

export function nextUnplannedMotionComicSourceEpisodeId(document: MotionComicPipelineData): string | undefined {
  const planned = plannedMotionComicSourceEpisodeIds(document);
  return document.sourceDocument?.episodes.find((episode) => !planned.has(episode.id))?.id;
}

/** Deterministic source units prevent a model from inventing its own evidence. */
export function splitMotionComicSource(sourceText: string): MotionComicSourceUnit[] {
  const parts = sourceText.trim().split(/\r?\n+|(?<=[。！？!?；;])\s*/u).map((value) => value.trim()).filter(Boolean);
  if (parts.length > 500) throw new Error('MOTION_COMIC_SOURCE_TOO_LONG: 原文超过 500 个句段，请按集拆分后生成。');
  return parts.map((value, index) => ({ id: `S${index + 1}`, text: value }));
}

/** Adapted from shuohao novel-script lineChars / charsPerSecond (4.5). */
export function estimateMotionComicDialogueMs(value: string): number {
  // English words take time too; treating each Latin letter as a Chinese syllable
  // makes bilingual scripts unusable. Punctuation retains a small pause budget.
  const latin = value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu) ?? [];
  const rest = value.replace(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/gu, '').replace(/\s/gu, '');
  return Math.max(350, Math.ceil((Array.from(rest).length / 4.5 + latin.length / 2.5) * 1_000));
}

function dedupeKeys<T>(
  items: T[],
  getKey: (item: T) => string,
  setKey: (item: T, val: string) => void,
  prefix = "item",
): void {
  const seen = new Set<string>();
  items.forEach((item, idx) => {
    let raw = (getKey(item) || "").trim();
    if (!raw) raw = prefix + "-" + (idx + 1);
    let cand = raw;
    let counter = 2;
    while (seen.has(cand)) {
      cand = raw + "-" + counter;
      counter++;
    }
    seen.add(cand);
    setKey(item, cand);
  });
}

function dedupeNames<T>(
  items: T[],
  getName: (item: T) => string,
  setName: (item: T, val: string) => void,
  fallback = "未命名",
): void {
  const seen = new Set<string>();
  items.forEach((item) => {
    let raw = (getName(item) || "").trim();
    raw = raw.replace(/\s*\(\d+\)$/, "").trim();
    const base = raw || fallback;
    let cand = base;
    let counter = 2;
    while (seen.has(cand)) {
      cand = `${base} (${counter})`;
      counter++;
    }
    seen.add(cand);
    setName(item, cand);
  });
}

function duplicates(values: string[], path: string, issues: MotionComicPlanningIssue[], label = '标识'): void {
  const seen = new Set<string>();
  values.forEach((value) => { if (seen.has(value)) issues.push({ path, message: `${label}重复：${value}` }); seen.add(value); });
}

export function validateMotionComicScriptDraft(script: MotionComicScriptDraft, sourceUnits: MotionComicSourceUnit[], document?: MotionComicPipelineData): MotionComicPlanningIssue[] {
  const issues: MotionComicPlanningIssue[] = [];
  const units = new Set(sourceUnits.map((unit) => unit.id));
  const unitOrder = new Map(sourceUnits.map((unit, index) => [unit.id, index] as const));
  const covered = new Set<string>();
  const actTitles = new Map<number, string>();
  let previousActIndex = 0;
  let previousSourceUnitIndex = -1;
  let sourceOrderBroken = false;
  const characterKeys = new Set(script.characters.map((character) => character.key));
  const locationKeys = new Set(script.sceneAssets.map((location) => location.key));
  const allKeys = [...script.characters.map((v) => v.key), ...script.characters.flatMap((v) => v.looks.map((look) => look.key)), ...script.sceneAssets.map((v) => v.key), ...script.props.map((v) => v.key), ...script.scenes.map((v) => v.key), ...script.scenes.flatMap((v) => v.beats.map((beat) => beat.key))];
  duplicates(allKeys, 'script', issues);
  duplicates(script.characters.map((v) => v.name), 'script.characters', issues, '角色名');
  duplicates(script.sceneAssets.map((v) => v.label), 'script.sceneAssets', issues, '场景名');
  duplicates(script.props.map((v) => v.label), 'script.props', issues, '道具名');
  if (script.scenes.flatMap((scene) => scene.beats).length > 500) issues.push({ path: 'script.scenes', message: '剧情节拍超过 500 个，请拆分为多集。' });
  script.characters.forEach((character, ci) => {
    duplicates(character.looks.map((look) => look.label), `script.characters[${ci}].looks`, issues, '造型名');
    const existing = document?.characters.find((v) => v.id === character.existingCharacterId);
    if (document && character.existingCharacterId && !existing) issues.push({ path: `script.characters[${ci}].existingCharacterId`, message: '引用的既有角色不存在，请从系列角色表中选择。' });
    character.looks.forEach((look, li) => {
      if (document && look.existingLookId && !(existing ?? document.characters.find((v) => v.name === character.name))?.looks.some((v) => v.id === look.existingLookId)) {
        issues.push({ path: `script.characters[${ci}].looks[${li}].existingLookId`, message: '造型不属于所引用角色。' });
      }
    });
  });
  for (const [items, field, available] of [
    [script.sceneAssets, 'existingSceneAssetId', document?.sceneAssets], [script.props, 'existingPropId', document?.props],
  ] as const) for (const item of items) {
    const id = (item as Record<string, unknown>)[field];
    if (document && id && !available?.some((v) => v.id === id)) issues.push({ path: `script.${field}`, message: `引用的既有资产不存在：${id}` });
  }
  script.scenes.forEach((scene, si) => {
    if (si === 0 && scene.actIndex !== 1) {
      issues.push({ path: 'script.scenes[0].actIndex', message: '第一场必须从第 1 幕开始。' });
    } else if (si > 0 && scene.actIndex < previousActIndex) {
      issues.push({ path: `script.scenes[${si}].actIndex`, message: `幕编号不能从第 ${previousActIndex} 幕回退到第 ${scene.actIndex} 幕。` });
    } else if (si > 0 && scene.actIndex > previousActIndex + 1) {
      issues.push({ path: `script.scenes[${si}].actIndex`, message: `幕编号必须连续，不能从第 ${previousActIndex} 幕跳到第 ${scene.actIndex} 幕。` });
    }
    const knownActTitle = actTitles.get(scene.actIndex);
    if (knownActTitle && knownActTitle !== scene.actTitle) {
      issues.push({ path: `script.scenes[${si}].actTitle`, message: `同一幕必须使用一致标题：第 ${scene.actIndex} 幕应为「${knownActTitle}」。` });
    } else {
      actTitles.set(scene.actIndex, scene.actTitle);
    }
    previousActIndex = scene.actIndex;
    if (!locationKeys.has(scene.locationKey)) issues.push({ path: `script.scenes[${si}].locationKey`, message: `场景引用不存在：${scene.locationKey}` });
    scene.beats.forEach((beat, bi) => {
      const path = `script.scenes[${si}].beats[${bi}]`;
      if (beat.kind === 'dialogue' && !beat.characterKey) issues.push({ path, code: 'DIALOGUE_SPEAKER_MISSING', message: '对白必须指定说话角色；仅确认是旁白时使用 narration，不得把未知说话人的对白直接改成旁白。' });
      if (beat.characterKey && !characterKeys.has(beat.characterKey)) issues.push({ path: `${path}.characterKey`, code: 'CHARACTER_REFERENCE_INVALID', message: `角色引用不存在：${beat.characterKey}` });
      duplicates(beat.sourceUnitIds, `${path}.sourceUnitIds`, issues, '原文引用');
      beat.sourceUnitIds.forEach((id) => {
        if (!units.has(id)) {
          issues.push({ path: `${path}.sourceUnitIds`, message: `原文句段不存在：${id}` });
          return;
        }
        covered.add(id);
        const currentSourceUnitIndex = unitOrder.get(id)!;
        if (currentSourceUnitIndex < previousSourceUnitIndex) sourceOrderBroken = true;
        previousSourceUnitIndex = Math.max(previousSourceUnitIndex, currentSourceUnitIndex);
      });
    });
  });
  if (sourceOrderBroken) issues.push({ path: 'script.scenes', message: '场次与节拍必须保持原文句段顺序，不可把后文排到前文之前。' });
  const omitted = sourceUnits.filter((unit) => !covered.has(unit.id));
  if (omitted.length) issues.push({ path: 'script.scenes', message: `漏掉原文句段：${omitted.map((unit) => unit.id).join('、')}；请补全剧情或缩短输入原文。` });
  return issues;
}

/** Port of shuohao's exactly-once, contiguous, ordered beat claims and fit gates. */
export function validateMotionComicStoryboard(script: MotionComicScriptDraft, shots: MotionComicPlannedShot[], targetDurationSec?: number): MotionComicPlanningIssue[] {
  const issues: MotionComicPlanningIssue[] = [];
  duplicates(shots.map((shot) => shot.key), 'shots', issues, '镜头标识');
  const looks = new Map(script.characters.flatMap((character) => character.looks.map((look) => [look.key, character.key] as const)));
  const props = new Set(script.props.map((prop) => prop.key));
  const sceneKeys = new Set(script.scenes.map((scene) => scene.key));
  const expected = script.scenes.flatMap((scene) => scene.beats.map((beat) => beat.key));
  const claimed = shots.flatMap((shot) => shot.beatKeys);
  if (claimed.length !== expected.length || expected.some((id, i) => claimed[i] !== id)) {
    issues.push({ path: 'shots.beatKeys', message: '每个剧情节拍必须按剧本顺序、连续且恰好归属一个镜头；不可遗漏、重复或倒序。' });
  }
  shots.forEach((shot, index) => {
    const path = `shots[${index}]`;
    const scene = script.scenes.find((item) => item.key === shot.sceneKey);
    if (!sceneKeys.has(shot.sceneKey)) issues.push({ path: `${path}.sceneKey`, message: `场次引用不存在：${shot.sceneKey}` });
    const sceneBeats = new Map(scene?.beats.map((beat) => [beat.key, beat]) ?? []);
    let speechMs = 0;
    shot.beatKeys.forEach((id) => {
      const beat = sceneBeats.get(id);
      if (!beat) issues.push({ path: `${path}.beatKeys`, message: `节拍不属于此场次：${id}` });
      else if (beat.kind !== 'action') speechMs += estimateMotionComicDialogueMs(beat.text);
    });
    if (speechMs > Math.round((shot.durationSec + 2.5) * 1_000)) issues.push({ path: `${path}.durationSec`, message: `对白/旁白预计需要 ${(speechMs / 1_000).toFixed(1)} 秒，超过镜头 ${shot.durationSec} 秒；请拆镜或增加时长。` });
    duplicates(shot.characterLookKeys, `${path}.characterLookKeys`, issues, '造型引用');
    duplicates(shot.propKeys, `${path}.propKeys`, issues, '道具引用');
    shot.characterLookKeys.forEach((id) => { if (!looks.has(id)) issues.push({ path: `${path}.characterLookKeys`, message: `造型引用不存在：${id}` }); });
    duplicates(shot.characterLookKeys.map((id) => looks.get(id)).filter((id): id is string => Boolean(id)), `${path}.characterLookKeys`, issues, '同镜头角色（不能同时穿两套造型）');
    shot.propKeys.forEach((id) => { if (!props.has(id)) issues.push({ path: `${path}.propKeys`, message: `道具引用不存在：${id}` }); });
  });
  const total = shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  if (targetDurationSec && Math.abs(total - targetDurationSec) > targetDurationSec * 0.15) issues.push({ path: 'shots', message: `总时长 ${total.toFixed(1)} 秒与目标 ${targetDurationSec} 秒相差超过 15%，请重新分配镜头时长。` });
  return issues;
}

export function parseMotionComicPlanDraft(value: unknown, document?: MotionComicPipelineData): MotionComicPlanDraft {
  let normalizedValue = value;
  if (value && typeof value === "object") {
    const rawObj = { ...(value as Record<string, unknown>) };
    const adjustments: MotionComicPlanAdjustment[] = [];
    if (rawObj.script) {
      const normalized = normalizeMotionComicScriptRaw(rawObj.script, typeof rawObj.sourceText === 'string' ? splitMotionComicSource(rawObj.sourceText) : []);
      adjustments.push(...collectMotionComicPlanAdjustments(rawObj.script, normalized, 'script'));
      rawObj.script = normalized;
    }
    if (rawObj.shots) {
      const sbNorm = normalizeMotionComicStoryboardRaw({ shots: rawObj.shots }, rawObj.script as MotionComicScriptDraft) as Record<string, unknown>;
      adjustments.push(...collectMotionComicPlanAdjustments(rawObj.shots, sbNorm.shots, 'shots'));
      if (Array.isArray(sbNorm.shots)) rawObj.shots = sbNorm.shots;
    }
    if (adjustments.length) rawObj.adjustments = [...(Array.isArray(rawObj.adjustments) ? rawObj.adjustments : []), ...adjustments];
    normalizedValue = rawObj;
  }
  const parsed = motionComicPlanDraftSchema.safeParse(normalizedValue);
  if (!parsed.success) throw new Error(`MOTION_COMIC_PLAN_INVALID: ${parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  const plan = parsed.data;
  const expectedUnits = splitMotionComicSource(plan.sourceText);
  if (JSON.stringify(expectedUnits) !== JSON.stringify(plan.sourceUnits)) throw new Error('MOTION_COMIC_PLAN_INVALID: 原文句段被修改，请重新生成分镜方案。');
  const issues = [...validateMotionComicScriptDraft(plan.script, plan.sourceUnits, document), ...validateMotionComicStoryboard(plan.script, plan.shots, plan.targetDurationSec)];
  if (issues.length) throw new Error(`MOTION_COMIC_PLAN_INVALID: ${issues.slice(0, 8).map((issue) => `${issue.path} ${issue.message}`).join('；')}`);
  return plan;
}

export function summarizeMotionComicPlan(plan: MotionComicPlanDraft): MotionComicPlanResult['summary'] {
  const beats = plan.script.scenes.flatMap((scene) => scene.beats);
  return { characters: plan.script.characters.length, acts: new Set(plan.script.scenes.map((scene) => scene.actIndex)).size, scenes: plan.script.scenes.length, shots: plan.shots.length, dialogueLines: beats.filter((beat) => beat.kind !== 'action').length, durationSec: plan.shots.reduce((sum, shot) => sum + shot.durationSec, 0), sourceUnits: plan.sourceUnits.length, coveredSourceUnits: new Set(beats.flatMap((beat) => beat.sourceUnitIds)).size };
}

/** Only the deterministic, media-free starter can be replaced without review risk. */
export function isUntouchedMotionComicStarter(document: MotionComicPipelineData): boolean {
  if (document.episodes.length !== 1 || document.assets.length > 0 || document.providerJobs.length > 0 || document.qualityReports.length > 0) return false;
  const episode = document.episodes[0];
  if (document.sourceDocument
    && episode.id === `episode-${document.id}-source-placeholder`
    && episode.status === 'draft'
    && episode.scenes.length === 0
    && episode.dialogueCues.length === 0
    && episode.timeline.clips.length === 0) return true;
  if (episode.id !== `episode-${document.id}-1` || episode.status !== 'boarded') return false;
  if (episode.scenes.length !== 3 || episode.scenes.some((scene) => scene.shots.length !== 2) || episode.dialogueCues.length !== 9) return false;
  if (episode.scenes.map((scene) => scene.title).join('|') !== '异常出现|线索升级|选择与钩子') return false;
  if (episode.scenes.flatMap((scene) => scene.shots).some((shot) => (
    shot.firstFrameAssetVersionId || shot.lastFrameAssetVersionId || shot.videoAssetVersionId || shot.videoJobId
    || shot.voiceAssetVersionId || shot.sourceBeatIds?.length || shot.continuity
  ))) return false;
  if (episode.dialogueCues.some((cue) => cue.voiceAssetVersionId || cue.audioAssetVersionId || cue.tokens?.length)) return false;
  const expectedShotTitles = episode.scenes.flatMap((scene) => [`${scene.title} · 建立`, `${scene.title} · 推进`]);
  const shots = episode.scenes.flatMap((scene) => scene.shots);
  if (shots.some((shot, index) => shot.title !== expectedShotTitles[index])) return false;
  const expectedDialogue = episode.scenes.flatMap((scene) => [
    `${scene.title}，事情和预想的不一样。`,
    '先别下结论，看清楚这个细节。',
    `${scene.title}，事情和预想的不一样。`,
  ]);
  return episode.dialogueCues.every((cue, index) => cue.text === expectedDialogue[index]);
}

/** Import uses app-owned IDs and adds one episode unless the untouched starter is explicitly replaced. */
export function applyMotionComicPlan(
  document: MotionComicPipelineData,
  value: MotionComicPlanDraft,
  options: { episodeId?: string; now?: string; replaceStarter?: boolean; sourceEpisodeId?: string; reviewedAdjustments?: boolean } = {},
): MotionComicPipelineData {
  const plan = parseMotionComicPlanDraft(value, document);
  if (plan.adjustments?.length && !options.reviewedAdjustments) {
    throw new Error('MOTION_COMIC_PLAN_REVIEW_REQUIRED: 请先审阅并确认自动整理与补齐项，再写入分集。');
  }
  const sourceEpisodeId = options.sourceEpisodeId
    ?? document.sourceDocument?.episodes.find((episode) => episode.sourceText.trim() === plan.sourceText.trim())?.id;
  if (document.sourceDocument) {
    if (!sourceEpisodeId || !document.sourceDocument.episodes.some((episode) => episode.id === sourceEpisodeId)) {
      throw new Error('MOTION_COMIC_SOURCE_EPISODE_REQUIRED: 规划必须关联当前项目中的一个源分集。');
    }
    const planned = plannedMotionComicSourceEpisodeIds(document);
    if (planned.has(sourceEpisodeId)) {
      throw new Error('MOTION_COMIC_SOURCE_EPISODE_PLANNED: 该源分集已经完成结构化，请直接进入分幕分场。');
    }
    const nextSourceEpisodeId = nextUnplannedMotionComicSourceEpisodeId(document);
    if (nextSourceEpisodeId && nextSourceEpisodeId !== sourceEpisodeId) {
      throw new Error('MOTION_COMIC_SOURCE_EPISODE_ORDER: 请先完成前一集的结构化。');
    }
  }
  if (options.replaceStarter && !isUntouchedMotionComicStarter(document)) {
    throw new Error('MOTION_COMIC_STARTER_CHANGED: 默认首集已有编辑或媒体，不能自动替换；请应用为新一集。');
  }
  const baseDocument: MotionComicPipelineData = options.replaceStarter ? {
    ...document,
    characters: [],
    sceneAssets: [],
    props: [],
    episodes: [],
    activeEpisodeId: '',
    series: { ...document.series, characterIds: [], sceneAssetIds: [], propAssetIds: [] },
  } : document;
  const episodeId = options.episodeId ?? `episode-${globalThis.crypto.randomUUID()}`;
  if (baseDocument.episodes.some((episode) => episode.id === episodeId)) throw new Error('MOTION_COMIC_DUPLICATE_ID: 分集标识已存在。');
  const characters = structuredClone(baseDocument.characters);
  const sceneAssets = structuredClone(baseDocument.sceneAssets);
  const props = structuredClone(baseDocument.props);
  const characterIds = new Map<string, string>();
  const lookIds = new Map<string, string>();
  const locationIds = new Map<string, string>();
  const propIds = new Map<string, string>();
  plan.script.characters.forEach((item, index) => {
    const matches = characters.filter((existing) => item.existingCharacterId ? existing.id === item.existingCharacterId : existing.name === item.name);
    if (matches.length > 1) throw new Error(`MOTION_COMIC_PLAN_INVALID: 系列中有多个同名角色「${item.name}」，请明确 existingCharacterId。`);
    let character = matches[0];
    if (!character) {
      character = { id: `${episodeId}-character-${index + 1}`, name: item.name, aliases: item.aliases, role: item.role, identityPrompt: item.identityPrompt, personality: item.personality, voiceNotes: item.voiceNotes, looks: [] } satisfies MotionComicCharacter;
      characters.push(character);
    }
    characterIds.set(item.key, character.id);
    item.looks.forEach((look, lookIndex) => {
      let existing = character.looks.find((candidate) => look.existingLookId ? candidate.id === look.existingLookId : candidate.label === look.label);
      if (!existing) {
        existing = { id: `${episodeId}-look-${index + 1}-${lookIndex + 1}`, characterId: character.id, label: look.label, appearancePrompt: look.appearancePrompt, wardrobe: look.wardrobe, continuityNotes: look.continuityNotes, pinned: true, referenceAssetVersionIds: [] };
        character.looks.push(existing);
      }
      lookIds.set(look.key, existing.id);
    });
  });
  plan.script.sceneAssets.forEach((item, index) => {
    let existing = sceneAssets.find((candidate) => item.existingSceneAssetId ? candidate.id === item.existingSceneAssetId : candidate.label === item.label);
    if (!existing) { existing = { id: `${episodeId}-location-${index + 1}`, label: item.label, description: item.description, prompt: item.prompt, continuityNotes: item.continuityNotes, referenceAssetVersionIds: [] }; sceneAssets.push(existing); }
    locationIds.set(item.key, existing.id);
  });
  plan.script.props.forEach((item, index) => {
    let existing = props.find((candidate) => item.existingPropId ? candidate.id === item.existingPropId : candidate.label === item.label);
    if (!existing) { existing = { id: `${episodeId}-prop-${index + 1}`, label: item.label, description: item.description, prompt: item.prompt, referenceAssetVersionIds: [] }; props.push(existing); }
    propIds.set(item.key, existing.id);
  });
  const dialogueCues: MotionComicDialogueCue[] = [];
  const timelineClips: MotionComicEpisode['timeline']['clips'] = [];
  const actAssignments: NonNullable<MotionComicPlanningEvidence['actAssignments']> = [];
  const evidence: MotionComicPlanningEvidence = {
    version: 1,
    sourceText: plan.sourceText,
    sourceUnits: plan.sourceUnits,
    ...(sourceEpisodeId ? { sourceEpisodeId } : {}),
    model: plan.model,
    createdAt: plan.createdAt,
    targetDurationSec: plan.targetDurationSec,
    ...(plan.adjustments?.length ? { adjustments: plan.adjustments, adjustmentsReviewedAt: options.now ?? new Date().toISOString() } : {}),
    actAssignments,
    beats: [],
    shotClaims: [],
  };
  let timelineOffset = 0;
  const scenes = plan.script.scenes.map((scene, si) => {
    const sceneId = `${episodeId}-scene-${si + 1}`;
    actAssignments.push({ sceneId, actIndex: scene.actIndex, actTitle: scene.actTitle, actBoundaryReason: scene.actBoundaryReason });
    const beatIds = new Map(scene.beats.map((beat, bi) => [beat.key, `${sceneId}-beat-${bi + 1}`]));
    scene.beats.forEach((beat) => evidence.beats.push({ id: beatIds.get(beat.key)!, sceneId, sourceUnitIds: beat.sourceUnitIds, kind: beat.kind, text: beat.text, ...(beat.characterKey ? { characterId: characterIds.get(beat.characterKey)! } : {}) }));
    const shots = plan.shots.filter((shot) => shot.sceneKey === scene.key).map((item, shotIndex): MotionComicShot => {
      const id = `${sceneId}-shot-${shotIndex + 1}`;
      const durationMs = Math.round(item.durationSec * 1_000);
      const claimed = item.beatKeys.map((beatKey) => scene.beats.find((beat) => beat.key === beatKey)!);
      const speech = claimed.filter((beat) => beat.kind !== 'action');
      const speechMs = speech.reduce((sum, beat) => sum + estimateMotionComicDialogueMs(beat.text), 0);
      const gapMs = Math.max(0, (durationMs - speechMs) / (speech.length + 1));
      let cueOffset = timelineOffset + gapMs;
      const cueIds = speech.map((beat, ci) => {
        const cueId = `${id}-cue-${ci + 1}`;
        const endMs = cueOffset + estimateMotionComicDialogueMs(beat.text);
        dialogueCues.push({ id: cueId, shotId: id, ...(beat.characterKey ? { characterId: characterIds.get(beat.characterKey)! } : {}), text: beat.text, emotion: beat.emotion ?? '', startMs: Math.round(cueOffset), endMs: Math.min(timelineOffset + durationMs, Math.round(endMs)) });
        cueOffset = endMs + gapMs;
        return cueId;
      });
      const sourceBeatIds = item.beatKeys.map((beatKey) => beatIds.get(beatKey)!);
      evidence.shotClaims.push({ shotId: id, beatIds: sourceBeatIds });
      timelineClips.push({ id: `clip-${id}`, shotId: id, startMs: timelineOffset, durationMs, assetVersionIds: [], subtitleCueIds: cueIds, source: 'ai-video' });
      timelineOffset += durationMs;
      return { id, episodeId, sceneId, index: shotIndex + 1, title: item.title, durationMs, prompt: item.prompt, motionPrompt: item.motionPrompt, framing: item.framing, characterLookIds: item.characterLookKeys.map((k) => lookIds.get(k)!), sceneAssetId: locationIds.get(scene.locationKey)!, propAssetIds: item.propKeys.map((k) => propIds.get(k)!), renderStrategy: 'remote-video', dialogueCueIds: cueIds, continuity: item.continuity, sourceBeatIds };
    });
    return {
      id: sceneId,
      episodeId,
      index: si + 1,
      actIndex: scene.actIndex,
      actTitle: scene.actTitle,
      actBoundaryReason: scene.actBoundaryReason,
      actSource: 'ai-planned' as const,
      title: scene.title,
      summary: scene.summary,
      locationAssetId: locationIds.get(scene.locationKey)!,
      shots,
    };
  });
  const episode: MotionComicEpisode = { id: episodeId, seriesId: baseDocument.series.id, number: baseDocument.episodes.length + 1, title: plan.script.title, logline: plan.script.logline, script: plan.script.scenes.map((scene) => `${scene.title}\n${scene.beats.map((beat) => `${beat.characterKey ? `${plan.script.characters.find((c) => c.key === beat.characterKey)!.name}：` : ''}${beat.text}`).join('\n')}`).join('\n\n'), status: 'boarded', scenes, dialogueCues, planningEvidence: evidence, timeline: { durationMs: timelineOffset, clips: timelineClips, audioAssetVersionIds: [] } };
  return { ...baseDocument, ...(options.now ? { updatedAt: options.now } : {}), stage: 'shot-board', characters, sceneAssets, props, episodes: [...baseDocument.episodes, episode], activeEpisodeId: episode.id, series: { ...baseDocument.series, characterIds: Array.from(new Set([...baseDocument.series.characterIds, ...characterIds.values()])), sceneAssetIds: Array.from(new Set([...baseDocument.series.sceneAssetIds, ...locationIds.values()])), propAssetIds: Array.from(new Set([...baseDocument.series.propAssetIds, ...propIds.values()])) } };
}


/**
 * Normalizes and sanitizes raw JSON output from LLM for the script stage.
 * Handles schema differences, missing default looks for minor characters,
 * alias fields like name -> label, environmentPrompt/lightingPrompt -> prompt,
 * and strips unknown keys to satisfy strict Zod schemas.
 */

/** Resolve explicit names/aliases only. Never infer a speaker from proximity or cast order. */
function resolveExplicitBeatSpeaker(beat: Record<string, unknown>, characters: unknown): string | undefined {
  const explicitKey = typeof beat.characterKey === 'string' ? beat.characterKey.trim() : '';
  const cast = Array.isArray(characters) ? characters.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object') : [];
  // Preserve unknown explicit keys for validation; do not silently replace contradictory evidence.
  if (explicitKey) return explicitKey;
  const names = [beat.speakerName, beat.speaker, beat.character]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim().normalize('NFKC'));
  if (!names.length) return undefined;
  const resolved = names.map((name) => cast.filter((character) =>
    [character.key, character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])]
      .some((candidate) => typeof candidate === 'string' && candidate.trim().normalize('NFKC') === name)));
  if (resolved.some((matches) => matches.length !== 1)) return undefined;
  const keys = new Set(resolved.map((matches) => matches[0].key));
  return keys.size === 1 && typeof resolved[0][0].key === 'string' ? resolved[0][0].key : undefined;
}

export function normalizeMotionComicScriptRaw(raw: unknown, sourceUnits: readonly MotionComicSourceUnit[] = []): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const data = { ...(raw as Record<string, unknown>) };

  if (typeof data.title !== "string" || !data.title.trim()) {
    data.title = "未命名漫剧";
  }
  if (typeof data.logline !== "string" || !data.logline.trim()) {
    data.logline = typeof data.title === "string" ? data.title : "漫剧故事简介";
  }

  if (Array.isArray(data.characters)) {
    data.characters = data.characters.map((charRaw, charIdx) => {
      if (!charRaw || typeof charRaw !== "object") return charRaw;
      const char = { ...(charRaw as Record<string, unknown>) };
      const key = typeof char.key === "string" && char.key ? char.key : "char-" + (charIdx + 1);
      const name = typeof char.name === "string" && char.name ? char.name.trim() : "角色" + (charIdx + 1);
      const aliases = Array.isArray(char.aliases) ? char.aliases.filter((a): a is string => typeof a === "string") : [];
      const role = typeof char.role === "string" && char.role ? char.role : "主角";
      const identityPrompt = typeof char.identityPrompt === "string" && char.identityPrompt ? char.identityPrompt : name + "的视觉设定";
      const personality = typeof char.personality === "string" && char.personality ? char.personality : "性格沉稳";
      const voiceNotes = typeof char.voiceNotes === "string" && char.voiceNotes ? char.voiceNotes : "自然声线";

      let looks = Array.isArray(char.looks) ? [...char.looks] : [];
      if (looks.length === 0) {
        looks = [
          {
            key: key + "-look-1",
            label: "默认造型",
            appearancePrompt: identityPrompt,
            wardrobe: "日常服饰",
            continuityNotes: "保持面部特征与发型一致",
          },
        ];
      } else {
        looks = looks.map((lookRaw, lIdx) => {
          if (!lookRaw || typeof lookRaw !== "object") return lookRaw;
          const look = { ...(lookRaw as Record<string, unknown>) };
          const lKey = typeof look.key === "string" && look.key ? look.key : key + "-look-" + (lIdx + 1);
          const label = typeof look.label === "string" && look.label ? look.label.trim() : "日常造型";
          const appearancePrompt = typeof look.appearancePrompt === "string" && look.appearancePrompt
            ? look.appearancePrompt
            : (typeof look.prompt === "string" && look.prompt ? look.prompt : identityPrompt);
          const wardrobe = typeof look.wardrobe === "string" && look.wardrobe ? look.wardrobe : "日常服饰";
          const continuityNotes = typeof look.continuityNotes === "string" && look.continuityNotes ? look.continuityNotes : "保持特征一致";
          const res: Record<string, unknown> = {
            key: lKey,
            label,
            appearancePrompt,
            wardrobe,
            continuityNotes,
          };
          if (typeof look.existingLookId === "string") res.existingLookId = look.existingLookId;
          return res;
        });

        // Deduplicate look labels and keys within this character
        dedupeNames(looks as Record<string, unknown>[], (l) => String(l.label || ""), (l, val) => { l.label = val; }, "日常造型");
        dedupeKeys(looks as Record<string, unknown>[], (l) => String(l.key || ""), (l, val) => { l.key = val; }, key + "-look");
      }

      const resChar: Record<string, unknown> = {
        key,
        name,
        aliases,
        role,
        identityPrompt,
        personality,
        voiceNotes,
        looks,
      };
      if (typeof char.existingCharacterId === "string") resChar.existingCharacterId = char.existingCharacterId;
      return resChar;
    });

    // Deduplicate character names and keys across script
    dedupeNames(data.characters as Record<string, unknown>[], (c) => String(c.name || ""), (c, val) => { c.name = val; }, "角色");
    dedupeKeys(data.characters as Record<string, unknown>[], (c) => String(c.key || ""), (c, val) => { c.key = val; }, "char");
  }

  const normalizeLocationList = (list: unknown, defaultPrefix: string) => {
    if (!Array.isArray(list)) return list;
    const mapped = list.map((itemRaw, idx) => {
      if (!itemRaw || typeof itemRaw !== "object") return itemRaw;
      const item = { ...(itemRaw as Record<string, unknown>) };
      const key = typeof item.key === "string" && item.key ? item.key : defaultPrefix + "-" + (idx + 1);
      const label = typeof item.label === "string" && item.label
        ? item.label.trim()
        : (typeof item.name === "string" && item.name ? item.name.trim() : defaultPrefix + "-" + (idx + 1));

      let prompt = typeof item.prompt === "string" && item.prompt ? item.prompt : "";
      if (!prompt) {
        const parts: string[] = [];
        if (typeof item.environmentPrompt === "string" && item.environmentPrompt) parts.push(String(item.environmentPrompt));
        if (typeof item.lightingPrompt === "string" && item.lightingPrompt) parts.push(String(item.lightingPrompt));
        if (typeof item.description === "string" && item.description) parts.push(String(item.description));
        prompt = parts.join("，") || (label + "环境氛围");
      }

      const description = typeof item.description === "string" && item.description ? item.description : label + "场景设定";
      const continuityNotes = typeof item.continuityNotes === "string" && item.continuityNotes ? item.continuityNotes : "保持空间结构一致";

      const res: Record<string, unknown> = {
        key,
        label,
        description,
        prompt,
        continuityNotes,
      };
      if (typeof item.existingSceneAssetId === "string") res.existingSceneAssetId = item.existingSceneAssetId;
      return res;
    });

    dedupeNames(mapped as Record<string, unknown>[], (s) => String(s.label || ""), (s, val) => { s.label = val; }, "场景");
    dedupeKeys(mapped as Record<string, unknown>[], (s) => String(s.key || ""), (s, val) => { s.key = val; }, defaultPrefix);
    return mapped;
  };

  if (Array.isArray(data.sceneAssets)) {
    data.sceneAssets = normalizeLocationList(data.sceneAssets, "scene");
  }

  if (Array.isArray(data.props)) {
    const mappedProps = data.props.map((itemRaw, idx) => {
      if (!itemRaw || typeof itemRaw !== "object") return itemRaw;
      const item = { ...(itemRaw as Record<string, unknown>) };
      const key = typeof item.key === "string" && item.key ? item.key : "prop-" + (idx + 1);
      const label = typeof item.label === "string" && item.label
        ? item.label.trim()
        : (typeof item.name === "string" && item.name ? item.name.trim() : "道具" + (idx + 1));
      const description = typeof item.description === "string" && item.description ? item.description : label + "道具设定";
      const prompt = typeof item.prompt === "string" && item.prompt ? item.prompt : label + "特写细节";
      const res: Record<string, unknown> = { key, label, description, prompt };
      if (typeof item.existingPropId === "string") res.existingPropId = item.existingPropId;
      return res;
    });

    dedupeNames(mappedProps as Record<string, unknown>[], (p) => String(p.label || ""), (p, val) => { p.label = val; }, "道具");
    dedupeKeys(mappedProps as Record<string, unknown>[], (p) => String(p.key || ""), (p, val) => { p.key = val; }, "prop");
    data.props = mappedProps;
  }

  if (Array.isArray(data.scenes)) {
    data.scenes = data.scenes.map((sceneRaw, sIdx) => {
      if (!sceneRaw || typeof sceneRaw !== "object") return sceneRaw;
      const s = { ...(sceneRaw as Record<string, unknown>) };
      const key = typeof s.key === "string" && s.key ? s.key : "scene-" + (sIdx + 1);
      const title = typeof s.title === "string" && s.title ? s.title : "第" + (sIdx + 1) + "场";
      const summary = typeof s.summary === "string" && s.summary
        ? s.summary
        : (typeof s.narrativeGoal === "string" && s.narrativeGoal ? s.narrativeGoal : title);
      const locationKey = s.locationKey;

      let beats = Array.isArray(s.beats) ? s.beats : [];
      beats = beats.map((bRaw, bIdx) => {
        if (!bRaw || typeof bRaw !== "object") return bRaw;
        const b = { ...(bRaw as Record<string, unknown>) };
        const bKey = typeof b.key === "string" && b.key ? b.key : key + "-beat-" + (bIdx + 1);

        let kind: "action" | "dialogue" | "narration" = "action";
        const rawKind = String(b.kind || b.type || "").toLowerCase();
        if (rawKind === "dialogue" || rawKind.includes("dialog") || rawKind.includes("对白") || rawKind.includes("台词")) {
          kind = "dialogue";
        } else if (rawKind === "narration" || rawKind.includes("narrat") || rawKind.includes("旁白") || rawKind.includes("独白") || rawKind.includes("vo") || rawKind.includes("os")) {
          kind = "narration";
        } else if (rawKind === "action") {
          kind = "action";
        } else if (b.characterKey || b.character || b.speaker || b.speakerName) {
          kind = "dialogue";
        } else {
          kind = "action";
        }

        let text = typeof b.text === "string" && b.text ? b.text : "";
        if (!text) {
          if (typeof b.content === "string") text = b.content;
          else if (typeof b.description === "string") text = b.description;
          else if (typeof b.action === "string") text = b.action;
          else if (typeof b.dialogue === "string") text = b.dialogue;
          else if (typeof b.summary === "string") text = b.summary;
          // Missing story content must be repaired by the model, never invented locally.
        }

        let sourceUnitIds = Array.isArray(b.sourceUnitIds) && b.sourceUnitIds.length > 0
          ? b.sourceUnitIds.filter((u): u is string => typeof u === "string")
          : [];
        // Only restore evidence from a unique textual match. Invented IDs or
        // ordinal assignments can conceal missing source content.
        if (sourceUnitIds.length === 0) {
          const excerpt = text.replace(/\s/gu, '');
          const matches = sourceUnits.filter((unit) => {
            const source = unit.text.replace(/\s/gu, '');
            return source === excerpt || (excerpt.length >= 8 && source.includes(excerpt));
          });
          if (matches.length === 1) sourceUnitIds = [matches[0].id];
        }

        const resBeat: Record<string, unknown> = {
          key: bKey,
          sourceUnitIds,
          kind,
        };
        if (text) resBeat.text = text;
        const characterKey = resolveExplicitBeatSpeaker(b, data.characters);
        if (characterKey) resBeat.characterKey = characterKey;
        if (typeof b.emotion === "string" && b.emotion) resBeat.emotion = b.emotion;
        return resBeat;
      });

      return {
        key,
        actIndex: s.actIndex,
        actTitle: s.actTitle,
        actBoundaryReason: s.actBoundaryReason,
        title,
        summary,
        locationKey,
        beats,
      };
    });

    dedupeNames(data.scenes as Record<string, unknown>[], (sc) => String(sc.title || ""), (sc, val) => { sc.title = val; }, "场景");
    dedupeKeys(data.scenes as Record<string, unknown>[], (sc) => String(sc.key || ""), (sc, val) => { sc.key = val; }, "scene");
  }


  return data;
}

export function normalizeMotionComicStoryboardRaw(raw: unknown, script?: MotionComicScriptDraft): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const data = { ...(raw as Record<string, unknown>) };

  if (Array.isArray(data.shots)) {
    data.shots = data.shots.map((shotRaw, idx) => {
      if (!shotRaw || typeof shotRaw !== "object") return shotRaw;
      const s = { ...(shotRaw as Record<string, unknown>) };
      const key = typeof s.key === "string" && s.key ? s.key : "shot-" + (idx + 1);
      const sceneKey = s.sceneKey;
      const title = typeof s.title === "string" && s.title ? s.title : "镜头 " + (idx + 1);
      let durationSec = typeof s.durationSec === "number" && !isNaN(s.durationSec) ? Math.min(60, Math.max(3, s.durationSec)) : 4;
      if (script && Array.isArray(s.beatKeys)) {
        let requiredSpeechMs = 0;
        const allBeats = new Map<string, { kind: string; text: string }>();
        script.scenes.forEach((sc) => sc.beats.forEach((b) => allBeats.set(b.key, b)));
        s.beatKeys.forEach((bk: unknown) => {
          if (typeof bk === "string") {
            const beat = allBeats.get(bk);
            if (beat && beat.kind !== "action") {
              requiredSpeechMs += estimateMotionComicDialogueMs(beat.text);
            }
          }
        });
        if (requiredSpeechMs > 0) {
          const neededSec = Math.ceil(requiredSpeechMs / 1000) + 1;
          if (neededSec > durationSec) {
            durationSec = Math.min(60, neededSec);
          }
        }
      }
      const prompt = typeof s.prompt === "string" && s.prompt ? s.prompt : "画面主体细节";
      const motionPrompt = typeof s.motionPrompt === "string" && s.motionPrompt ? s.motionPrompt : "平稳运镜，镜头推近";
      const framing = typeof s.framing === "string" && s.framing ? s.framing : "中景";
      const characterLookKeys = Array.isArray(s.characterLookKeys) ? s.characterLookKeys.filter((k): k is string => typeof k === "string") : [];
      const propKeys = Array.isArray(s.propKeys) ? s.propKeys.filter((k): k is string => typeof k === "string") : [];
      const beatKeys = Array.isArray(s.beatKeys) ? s.beatKeys.filter((k): k is string => typeof k === "string") : [];

      const rawContinuity = (s.continuity && typeof s.continuity === "object") ? (s.continuity as Record<string, unknown>) : {};
      const startState = typeof rawContinuity.startState === "string" && rawContinuity.startState ? rawContinuity.startState : "镜头开启，保持角色与场景初始姿态";
      const endState = typeof rawContinuity.endState === "string" && rawContinuity.endState ? rawContinuity.endState : "镜头结束，角色与场景过渡至终态";
      const screenDirection = typeof rawContinuity.screenDirection === "string" && rawContinuity.screenDirection ? rawContinuity.screenDirection : "视线自然对焦，平视居中";
      const actionBeats = Array.isArray(rawContinuity.actionBeats) && rawContinuity.actionBeats.length > 0
        ? rawContinuity.actionBeats.filter((b): b is string => typeof b === "string" && !!b.trim())
        : ["角色进行剧情动作并保持连贯"];

      const continuity = {
        startState,
        endState,
        screenDirection,
        actionBeats: actionBeats.length > 0 ? actionBeats : ["角色进行剧情动作并保持连贯"],
      };

      return {
        key,
        sceneKey,
        title,
        durationSec,
        prompt,
        motionPrompt,
        framing,
        characterLookKeys,
        propKeys,
        beatKeys,
        continuity,
      };
    });
  }

  return data;
}

/** Record every local transformation, including discarded aliases, without mutating the response. */
export function collectMotionComicPlanAdjustments(before: unknown, after: unknown, path: string): MotionComicPlanAdjustment[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(after)) {
    const previous = Array.isArray(before) ? before : [];
    return Array.from({ length: Math.max(previous.length, after.length) }, (_, index) =>
      collectMotionComicPlanAdjustments(previous[index], after[index], `${path}[${index}]`)).flat();
  } else if (after && typeof after === 'object') {
    const previous = before && typeof before === 'object' ? before as Record<string, unknown> : {};
    const next = after as Record<string, unknown>;
    return [...new Set([...Object.keys(previous), ...Object.keys(next)])].flatMap((field) =>
      collectMotionComicPlanAdjustments(previous[field], next[field], `${path}.${field}`));
  }
  const display = (value: unknown) => {
    const full = value === undefined ? '（缺失）' : typeof value === 'string' ? value : JSON.stringify(value);
    return full.length > 2_000 ? `${full.slice(0, 2_000)}…` : full;
  };
  return [{ path, kind: path.endsWith('.durationSec') ? 'duration' : before === undefined || before === '' || before === null ? 'filled' : 'normalized', before: display(before), after: display(after) }];
}
