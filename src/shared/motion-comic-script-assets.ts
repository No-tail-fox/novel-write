import { parseMotionComicPipelineData, type MotionComicPipelineData } from './motion-comic';
import type { MotionComicScriptDraft } from './motion-comic-planning';

interface Identity { id: string; name?: string; label?: string; aliases?: string[] }
export interface MotionComicAssetChoice { existingId?: string; createNew?: boolean; name: string; aliases?: string[] }
const normalize = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase();

/** Names only suggest identity; ambiguous suggestions always require an explicit choice. */
export function motionComicAssetMatches<T extends Identity>(items: readonly T[], choice: MotionComicAssetChoice): T[] {
  if (choice.existingId) return items.filter((item) => item.id === choice.existingId);
  if (choice.createNew) return [];
  const names = new Set([choice.name, ...(choice.aliases ?? [])].map(normalize));
  return items.filter((item) => [item.name ?? item.label ?? '', ...(item.aliases ?? [])].some((value) => names.has(normalize(value))));
}

export function motionComicScriptAssetSummary(document: MotionComicPipelineData, script: MotionComicScriptDraft) {
  const result = { reused: 0, created: 0, unresolved: 0 };
  function count<T extends Identity>(items: readonly T[], choice: MotionComicAssetChoice) {
    const matches = motionComicAssetMatches(items, choice);
    if ((choice.existingId && (choice.createNew || !matches.length)) || matches.length > 1) result.unresolved += 1;
    else if (matches.length === 1) result.reused += 1;
    else result.created += 1;
    return matches.length === 1 ? matches[0] : undefined;
  }
  for (const item of script.characters) {
    const character = count(document.characters, { name: item.name, aliases: item.aliases, existingId: item.existingCharacterId, createNew: item.createNew });
    for (const look of item.looks) count(character?.looks ?? [], { name: look.label, existingId: look.existingLookId, createNew: look.createNew });
  }
  for (const item of script.sceneAssets) count(document.sceneAssets, { name: item.label, existingId: item.existingSceneAssetId, createNew: item.createNew });
  for (const item of script.props) count(document.props, { name: item.label, existingId: item.existingPropId, createNew: item.createNew });
  return result;
}

function resolve<T extends Identity>(items: readonly T[], choice: MotionComicAssetChoice): T | undefined {
  if (choice.createNew && choice.existingId) throw new Error('MOTION_COMIC_ASSET_BINDING: 新建和复用不能同时选择。');
  const matches = motionComicAssetMatches(items, choice);
  if (choice.existingId && !matches.length) throw new Error(`MOTION_COMIC_ASSET_BINDING: 「${choice.name}」引用的项目资产已不存在，请重新选择。`);
  if (matches.length > 1) throw new Error(`MOTION_COMIC_ASSET_AMBIGUOUS: 「${choice.name}」有多个同名或别名资产，请在本集资产中明确选择，或选择新建。`);
  return matches[0];
}

export function confirmMotionComicScriptAssets(document: MotionComicPipelineData, value: MotionComicScriptDraft, newId: () => string = () => globalThis.crypto.randomUUID()) {
  const next = structuredClone(document);
  const script = structuredClone(value);
  for (const item of script.characters) {
    let character = resolve(next.characters, { name: item.name, aliases: item.aliases, existingId: item.existingCharacterId, createNew: item.createNew });
    if (!character) {
      character = { id: `character-${newId()}`, name: item.name, aliases: item.aliases, role: item.role, identityPrompt: item.identityPrompt, personality: item.personality, voiceNotes: item.voiceNotes, looks: [] };
      next.characters.push(character);
    }
    item.existingCharacterId = character.id;
    delete item.createNew;
    for (const look of item.looks) {
      let existing = resolve(character.looks, { name: look.label, existingId: look.existingLookId, createNew: look.createNew });
      if (!existing) {
        existing = { id: `look-${newId()}`, characterId: character.id, label: look.label, appearancePrompt: look.appearancePrompt, wardrobe: look.wardrobe, continuityNotes: look.continuityNotes, referenceAssetVersionIds: [], pinned: true };
        character.looks.push(existing);
      }
      Object.assign(look, { existingLookId: existing.id, label: existing.label, appearancePrompt: existing.appearancePrompt, wardrobe: existing.wardrobe, continuityNotes: existing.continuityNotes });
      delete look.createNew;
    }
    Object.assign(item, { name: character.name, aliases: character.aliases ?? [], role: character.role, identityPrompt: character.identityPrompt, personality: character.personality, voiceNotes: character.voiceNotes });
  }
  for (const item of script.sceneAssets) {
    let existing = resolve(next.sceneAssets, { name: item.label, existingId: item.existingSceneAssetId, createNew: item.createNew });
    if (!existing) {
      existing = { id: `location-${newId()}`, label: item.label, description: item.description, prompt: item.prompt, continuityNotes: item.continuityNotes, referenceAssetVersionIds: [] };
      next.sceneAssets.push(existing);
    }
    Object.assign(item, { existingSceneAssetId: existing.id, label: existing.label, description: existing.description, prompt: existing.prompt, continuityNotes: existing.continuityNotes });
    delete item.createNew;
  }
  for (const item of script.props) {
    let existing = resolve(next.props, { name: item.label, existingId: item.existingPropId, createNew: item.createNew });
    if (!existing) {
      existing = { id: `prop-${newId()}`, label: item.label, description: item.description, prompt: item.prompt, referenceAssetVersionIds: [] };
      next.props.push(existing);
    }
    Object.assign(item, { existingPropId: existing.id, label: existing.label, description: existing.description, prompt: existing.prompt });
    delete item.createNew;
  }
  const ids = motionComicScriptAssetIds(script);
  next.series.characterIds = [...new Set([...next.series.characterIds, ...ids.characters])];
  next.series.sceneAssetIds = [...new Set([...next.series.sceneAssetIds, ...ids.sceneAssets])];
  next.series.propAssetIds = [...new Set([...next.series.propAssetIds, ...ids.props])];
  assertMotionComicScriptAssets(next, script);
  return { document: parseMotionComicPipelineData(next), script };
}

export function motionComicScriptAssetIds(script: MotionComicScriptDraft) {
  return { characters: script.characters.flatMap((item) => item.existingCharacterId ?? []), looks: script.characters.flatMap((item) => item.looks.flatMap((look) => look.existingLookId ?? [])), sceneAssets: script.sceneAssets.flatMap((item) => item.existingSceneAssetId ?? []), props: script.props.flatMap((item) => item.existingPropId ?? []) };
}

/** The server checks this again immediately before storyboard generation and application. */
export function assertMotionComicScriptAssets(document: MotionComicPipelineData, script: MotionComicScriptDraft): void {
  const missing: string[] = [];
  for (const item of script.characters) {
    const character = document.characters.find((candidate) => candidate.id === item.existingCharacterId);
    if (!character || item.createNew) missing.push(item.name);
    for (const look of item.looks) if (look.createNew || !character?.looks.some((candidate) => candidate.id === look.existingLookId && candidate.characterId === character.id)) missing.push(`${item.name} / ${look.label}`);
  }
  for (const item of script.sceneAssets) if (item.createNew || !document.sceneAssets.some((candidate) => candidate.id === item.existingSceneAssetId)) missing.push(item.label);
  for (const item of script.props) if (item.createNew || !document.props.some((candidate) => candidate.id === item.existingPropId)) missing.push(item.label);
  if (missing.length) throw new Error(`MOTION_COMIC_ASSETS_REQUIRED: 请先确认人物、地点和道具到项目资产库：${missing.join('、')}。`);
}
