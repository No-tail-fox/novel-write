import { describe, expect, it } from 'vitest';
import { createMotionComicDraft, createMotionComicImportedProject, createMotionComicStarterProject } from '../src/shared/motion-comic';
import type { MotionComicScriptDraft } from '../src/shared/motion-comic-planning';
import type { MotionComicScriptSnapshot } from '../src/shared/motion-comic-script-batch';
import { motionComicAssetEpisodeUsages, type MotionComicAssetIdentity } from '../src/features/motion-comic/motion-comic-asset-usage';

const now = '2026-10-23T00:00:00.000Z';
function fixture() {
  const document = createMotionComicStarterProject(createMotionComicDraft({ id: 'usage-project', title: '来信', premise: '雨夜来信', now }));
  const imported = createMotionComicImportedProject(createMotionComicDraft({ id: document.id, title: document.title, premise: '雨夜来信', now }), {
    kind: 'novel', adaptationMode: 'novel-adaptation', originalText: '来信。追查。',
    episodes: [{ title: '来信', sourceText: '来信。' }, { title: '追查', sourceText: '追查。' }],
  });
  document.sourceDocument = imported.sourceDocument;
  const source = document.sourceDocument!.episodes[0];
  const script: MotionComicScriptDraft = {
    title: '来信', logline: '雨夜来信',
    characters: [{ key: 'person', name: document.characters[0].name, aliases: [], role: '主角', identityPrompt: '', personality: '', voiceNotes: '', looks: [], existingCharacterId: document.characters[0].id }],
    sceneAssets: [{ key: 'room', label: document.sceneAssets[0].label, description: '', prompt: '', continuityNotes: '', existingSceneAssetId: document.sceneAssets[0].id }],
    props: [{ key: 'letter', label: document.props[0].label, description: '', prompt: '', existingPropId: document.props[0].id }], scenes: [],
  };
  const snapshot: MotionComicScriptSnapshot = { projectId: document.id, paused: true, candidates: [], storyboards: [],
    tasks: [{ id: 'task-1', projectId: document.id, sourceEpisodeId: source.id, status: 'approved', inputFingerprint: 'input', seriesBibleVersion: 'bible', previousStateVersion: 'previous',
      provider: 'fixture', model: 'fixture', promptVersion: 'fixture', instructions: '', outputRevision: 1, attempt: 1, progress: 100, createdAt: now, updatedAt: now }],
    approvals: [{ sourceEpisodeId: source.id, taskId: 'task-1', outputRevision: 1, inputFingerprint: 'input', script, model: 'fixture', instructions: '', approvedAt: now, assetsConfirmedAt: now, stale: false }],
  };
  const targets: MotionComicAssetIdentity[] = [{ kind: 'character', id: document.characters[0].id }, { kind: 'scene', id: document.sceneAssets[0].id }, { kind: 'prop', id: document.props[0].id }];
  return { document, source, snapshot, targets };
}

describe('project asset episode references', () => {
  it('shows approved script references before any storyboard exists for all asset types', () => {
    const { document, source, snapshot, targets } = fixture(); document.episodes = [];
    for (const target of targets) expect(motionComicAssetEpisodeUsages(document, target, snapshot)).toEqual([
      { key: `source:${source.id}`, number: source.number, title: source.title, sourceEpisodeId: source.id, script: true, storyboard: false },
    ]);
  });

  it('requires confirmed identities rather than matching names or aliases', () => {
    const { document, snapshot, targets } = fixture(); document.episodes = [];
    delete snapshot.approvals[0].script.characters[0].existingCharacterId;
    delete snapshot.approvals[0].script.sceneAssets[0].existingSceneAssetId;
    delete snapshot.approvals[0].script.props[0].existingPropId;
    for (const target of targets) expect(motionComicAssetEpisodeUsages(document, target, snapshot)).toEqual([]);
  });

  it.each(['stale', 'legacy', 'revision', 'task', 'project', 'superseded', 'unapproved'] as const)('excludes %s script approvals', (kind) => {
    const { document, snapshot, targets } = fixture(); document.episodes = [];
    if (kind === 'stale') snapshot.approvals[0].stale = true;
    if (kind === 'legacy') delete snapshot.approvals[0].assetsConfirmedAt;
    if (kind === 'revision') snapshot.tasks[0].outputRevision = 2;
    if (kind === 'task') snapshot.approvals[0].taskId = 'old-task';
    if (kind === 'project') snapshot.projectId = 'other-project';
    if (kind === 'superseded') snapshot.tasks.push({ ...snapshot.tasks[0], id: 'new-task', status: 'review' });
    if (kind === 'unapproved') snapshot.tasks[0].status = 'review';
    expect(motionComicAssetEpisodeUsages(document, targets[0], snapshot)).toEqual([]);
  });

  it.each([true, false])('deduplicates script and applied references, with explicit source ID %s', (explicit) => {
    const { document, source, snapshot, targets } = fixture();
    const episode = document.episodes[0];
    episode.planningEvidence = { version: 1, sourceText: source.sourceText, sourceUnits: [{ id: 'S1', text: source.sourceText }], beats: [], shotClaims: [], adjustments: [], model: 'fixture', createdAt: now,
      ...(explicit ? { sourceEpisodeId: source.id } : {}) };
    const shot = episode.scenes[0].shots[0];
    shot.characterLookIds = [document.characters[0].looks[0].id]; shot.sceneAssetId = targets[1].id; shot.propAssetIds = [targets[2].id];
    for (const target of targets) expect(motionComicAssetEpisodeUsages(document, target, snapshot)).toEqual([
      { key: `source:${source.id}`, number: source.number, title: source.title, sourceEpisodeId: source.id, episodeId: episode.id, script: true, storyboard: true },
    ]);
  });

  it('includes dialogue-only characters and scene-level locations without a script snapshot', () => {
    const { document, targets } = fixture();
    const episode = document.episodes[0];
    episode.scenes.forEach((scene) => { scene.locationAssetId = targets[1].id; scene.shots.forEach((shot) => { shot.characterLookIds = []; shot.sceneAssetId = document.sceneAssets[1].id; }); });
    episode.dialogueCues = [{ id: 'cue', shotId: episode.scenes[0].shots[0].id, characterId: targets[0].id, text: '来信了。', emotion: '', startMs: 0, endMs: 1000 }];
    for (const target of targets.slice(0, 2)) expect(motionComicAssetEpisodeUsages(document, target, null)[0]).toMatchObject({ episodeId: episode.id, script: false, storyboard: true });
    episode.dialogueCues[0].characterId = 'another-person';
    expect(motionComicAssetEpisodeUsages(document, targets[0], null)).toEqual([]);
  });

  it('keeps independent applied episodes and sorts references by episode number', () => {
    const { document, snapshot, targets } = fixture();
    const applied = document.episodes[0]; applied.number = 8;
    applied.scenes[0].shots[0].propAssetIds = [targets[2].id];
    expect(motionComicAssetEpisodeUsages(document, targets[2], snapshot).map((usage) => [usage.number, usage.key])).toEqual([
      [1, `source:${snapshot.approvals[0].sourceEpisodeId}`], [8, `episode:${applied.id}`],
    ]);
  });
});
