import { z } from 'zod';
import { motionComicScriptDraftSchema, type MotionComicScriptDraft } from './motion-comic-planning';
import type { MotionComicPipelineData } from './motion-comic';
import { confirmMotionComicScriptAssets } from './motion-comic-script-assets';
const key = z.string().trim().min(1).max(256);
export const motionComicAssetCategorySchema = z.enum(['characters', 'sceneAssets', 'props']);
export type MotionComicAssetCategory = z.infer<typeof motionComicAssetCategorySchema>;
export const assetExtractionOutputSchemas = {
  characters: z.object({ characters: motionComicScriptDraftSchema.shape.characters }).strict(),
  sceneAssets: z.object({ sceneAssets: z.array(motionComicScriptDraftSchema.shape.sceneAssets.element).max(40) }).strict(),
  props: z.object({ props: motionComicScriptDraftSchema.shape.props }).strict(),
};
export const motionComicAssetExtractSchema = z.object({ id: key, sourceEpisodeId: key, category: motionComicAssetCategorySchema, expectedUpdatedAt: z.string().datetime(), requestId: key }).strict();
export const motionComicAssetExtractionApplySchema = z.object({ id: key, candidateId: key, revision: z.number().int().positive(), expectedUpdatedAt: z.string().datetime(), inputFingerprint: key,
  selections: z.array(z.discriminatedUnion('mode', [z.object({ key, mode: z.literal('existing'), existingId: key }).strict(), z.object({ key, mode: z.literal('new') }).strict()])).min(1).max(60),
}).strict();
export const motionComicAssetExtractionCandidateSchema = z.object({
  id: key, projectId: key, sourceEpisodeId: key, category: motionComicAssetCategorySchema, requestId: key, requestFingerprint: key,
  inputFingerprint: key, sourceFingerprint: key, projectFingerprint: key, revision: z.number().int().positive(),
  status: z.enum(['running', 'ready', 'failed', 'unknown', 'stale', 'applied']), dispatchState: z.enum(['prepared', 'dispatched', 'settled', 'unknown']),
  output: z.union([assetExtractionOutputSchemas.characters, assetExtractionOutputSchemas.sceneAssets, assetExtractionOutputSchemas.props]).optional(),
  error: z.string().max(8000).optional(), provider: key, model: key, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().refine(value => (!['ready', 'applied'].includes(value.status) || Boolean(value.output)) && (!value.output || assetExtractionOutputSchemas[value.category].safeParse(value.output).success), '候选类别与结果不匹配');
export type MotionComicAssetExtractInput = z.infer<typeof motionComicAssetExtractSchema>;
export type MotionComicAssetExtractionApplyInput = z.infer<typeof motionComicAssetExtractionApplySchema>;
export type MotionComicAssetExtractionCandidate = z.infer<typeof motionComicAssetExtractionCandidateSchema>;
export function validateAssetExtractionOutput(category: MotionComicAssetCategory, output: unknown) {
  const parsed = assetExtractionOutputSchemas[category].parse(output);
  const items = Object.values(parsed)[0] as { key: string }[];
  if (new Set(items.map(item => item.key)).size !== items.length) throw new Error('ASSET_EXTRACTION_DUPLICATE_KEY');
  return parsed;
}
export function applyAssetExtractionSelections(document: MotionComicPipelineData, candidate: MotionComicAssetExtractionCandidate, selections: MotionComicAssetExtractionApplyInput['selections'], newId: () => string) {
  const output = validateAssetExtractionOutput(candidate.category, candidate.output);
  const items = Object.values(output)[0] as { key: string }[];
  if (!selections.length || new Set(selections.map(s => s.key)).size !== selections.length || selections.some(s => !items.some(item => item.key === s.key))) throw new Error('ASSET_EXTRACTION_EXPLICIT_SELECTION_REQUIRED');
  const draft: MotionComicScriptDraft = { title: '资产候选', logline: '资产候选', characters: [], sceneAssets: [], props: [], scenes: [], ...structuredClone(output) };
  draft.characters = draft.characters.filter(item => selections.some(s => s.key === item.key));
  draft.sceneAssets = draft.sceneAssets.filter(item => selections.some(s => s.key === item.key));
  draft.props = draft.props.filter(item => selections.some(s => s.key === item.key));
  for (const item of draft.characters) {
    const choice = selections.find(s => s.key === item.key)!;
    delete item.existingCharacterId; delete item.createNew;
    if (choice.mode === 'existing') { item.existingCharacterId = choice.existingId; item.looks = []; }
    else { item.createNew = true; for (const look of item.looks) { delete look.existingLookId; look.createNew = true; } }
  }
  for (const item of draft.sceneAssets) { const choice = selections.find(s => s.key === item.key)!; delete item.existingSceneAssetId; delete item.createNew; if (choice.mode === 'existing') item.existingSceneAssetId = choice.existingId; else item.createNew = true; }
  for (const item of draft.props) { const choice = selections.find(s => s.key === item.key)!; delete item.existingPropId; delete item.createNew; if (choice.mode === 'existing') item.existingPropId = choice.existingId; else item.createNew = true; }
  return confirmMotionComicScriptAssets(document, draft, newId).document;
}
