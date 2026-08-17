import { parseHtmlVideoPipelineData } from './html-video-workflow';
import type {
  HtmlVideoAsset,
  HtmlVideoCompositionSnapshot,
  HtmlVideoPipelineDataV2,
  HtmlVideoVoiceClip,
  Task,
  TaskArtifactSnapshot,
  TaskArtifactVideoPreview,
} from './types';
import type {
  HtmlVideoDurationSource,
  HtmlVideoWorkflowDocument,
  ProductionAssetKind,
  ProductionAssetVersion,
  ProductionProviderJob,
  ProductionSubtitleCue,
  ProductionTimelineClip,
  StandardWorkflowDocument,
} from './production-workflow';

type ProjectionTask = Pick<Task, 'id' | 'title' | 'ratio' | 'taskType' | 'pipelineData' | 'createdAt' | 'completedAt'>;

export interface StandardTaskProjectionInput {
  task: ProjectionTask;
  snapshot: Pick<TaskArtifactSnapshot, 'updatedAt' | 'artifact' | 'assets'>;
}

export interface HtmlVideoTaskProjectionInput {
  task: ProjectionTask;
  pipeline?: HtmlVideoPipelineDataV2;
}

interface AssetVersionInput {
  assetId: string;
  kind: ProductionAssetKind;
  path: string;
  createdAt: string;
  prompt?: string;
  providerJobId?: string;
  provider?: string;
  model?: string;
  license?: string;
  selected?: boolean;
}

const productionRatios = new Set(['9:16', '16:9', '1:1', '4:3']);

export function projectStandardTaskToProductionDocument(input: StandardTaskProjectionInput): StandardWorkflowDocument {
  const { task, snapshot } = input;
  if (task.taskType === 'html-video' || task.taskType === 'editorial-collage') {
    throw new Error(`Cannot project ${task.taskType} as a standard workflow.`);
  }

  const scope = projectionScope('standard', task.id);
  const createdAt = task.createdAt;
  const updatedAt = snapshot.updatedAt ?? task.completedAt ?? createdAt;
  const scenes = snapshot.artifact.scenes ?? [];
  const subtitleSource = snapshot.artifact.subtitles?.cues ?? [];
  const assets: ProductionAssetVersion[] = [];
  const providerJobs: ProductionProviderJob[] = [];
  const imagesByScene = new Map<number, string[]>();
  const videosByScene = new Map<number, string[]>();
  const narrationByScene = new Map<number, string[]>();
  const selectedImageByScene = new Map<number, string>();
  const selectedVideoByScene = new Map<number, string>();

  const lastImageIndex = lastIndexBy(snapshot.assets.images, (asset) => asset.sceneId);
  snapshot.assets.images.forEach((asset, index) => {
    const assetId = `${scope}-scene-${asset.sceneId}-image`;
    const prompt = snapshot.artifact.imagePrompts?.find((item) => item.sceneId === asset.sceneId)?.prompt;
    const version = createAssetVersion({
      assetId,
      kind: 'image',
      path: asset.path,
      createdAt: updatedAt,
      prompt,
      selected: lastImageIndex.get(asset.sceneId) === index,
    });
    assets.push(version);
    appendMapValue(imagesByScene, asset.sceneId, version.id);
    if (version.selected) selectedImageByScene.set(asset.sceneId, version.id);
  });

  const lastVideoIndex = lastIndexBy(snapshot.assets.videos, (asset) => asset.sceneId);
  snapshot.assets.videos.forEach((asset, index) => {
    const assetId = `${scope}-scene-${asset.sceneId}-video`;
    const selected = lastVideoIndex.get(asset.sceneId) === index;
    const providerJob = standardVideoProviderJob(scope, asset, createdAt, updatedAt);
    if (providerJob) providerJobs.push(providerJob);
    const version = createAssetVersion({
      assetId,
      kind: 'video',
      path: asset.path,
      createdAt: updatedAt,
      providerJobId: providerJob?.id,
      provider: asset.providerId,
      model: asset.model,
      license: asset.license,
      selected,
    });
    assets.push(version);
    appendMapValue(videosByScene, asset.sceneId, version.id);
    if (selected) selectedVideoByScene.set(asset.sceneId, version.id);
  });

  snapshot.assets.narration.forEach((asset, index) => {
    const turn = asset.turnIndex ?? index + 1;
    const assetId = `${scope}-scene-${asset.sceneId}-narration-${turn}`;
    const version = createAssetVersion({ assetId, kind: 'audio', path: asset.path, createdAt: updatedAt, selected: true });
    assets.push(version);
    appendMapValue(narrationByScene, asset.sceneId, version.id);
  });

  let cursorMs = 0;
  const sceneRanges = scenes.map((scene) => {
    const startMs = cursorMs;
    cursorMs += scene.durationMs;
    return { sceneId: scene.id, startMs, endMs: cursorMs, shotId: `${scope}-scene-${scene.id}` };
  });
  const shotIdByScene = new Map(sceneRanges.map((item) => [item.sceneId, item.shotId]));
  const subtitleCues: ProductionSubtitleCue[] = subtitleSource.map((cue) => {
    const shotId = cue.sceneId === undefined
      ? sceneRanges.find((range, index) => cue.startMs < range.endMs || (index === sceneRanges.length - 1 && cue.startMs === range.endMs))?.shotId
      : shotIdByScene.get(cue.sceneId);
    return {
      id: `${scope}-subtitle-${cue.index}-${stableToken(`${cue.startMs}|${cue.endMs}|${cue.text}`)}`,
      ...(shotId ? { shotId } : {}),
      sourceId: String(cue.index),
      startMs: cue.startMs,
      endMs: cue.endMs,
      text: cue.text,
    };
  });
  const subtitlesByShot = groupSubtitleIdsByShot(subtitleCues);

  const shots = scenes.map((scene) => {
    const id = `${scope}-scene-${scene.id}`;
    return {
      id,
      sceneId: scene.id,
      title: scene.cap,
      prompt: scene.descPrompt,
      durationMs: scene.durationMs,
      segmentIds: (scene.segments ?? []).map((segment) => `${id}-segment-${segment.id}`),
      visualAssetVersionIds: unique([
        ...(videosByScene.get(scene.id) ?? []),
        ...(imagesByScene.get(scene.id) ?? []),
      ]),
      narrationAssetVersionIds: narrationByScene.get(scene.id) ?? [],
      subtitleCueIds: subtitlesByShot.get(id) ?? [],
    };
  });

  const clips: ProductionTimelineClip[] = [];
  let startMs = 0;
  for (const shot of shots) {
    const selectedVisual = selectedVideoByScene.get(shot.sceneId) ?? selectedImageByScene.get(shot.sceneId);
    const selectedVideo = snapshot.assets.videos[lastVideoIndex.get(shot.sceneId) ?? -1];
    clips.push({
      id: `${shot.id}-clip`,
      shotId: shot.id,
      startMs,
      durationMs: shot.durationMs,
      assetVersionIds: selectedVisual ? [selectedVisual] : [],
      subtitleCueIds: shot.subtitleCueIds,
      source: selectedVideo?.source === 'ai-video' ? 'ai-video' : selectedVideo ? 'local' : 'deterministic',
    });
    startMs += shot.durationMs;
  }

  return {
    version: 1,
    id: scope,
    workflowKind: 'standard',
    title: task.title,
    ratio: normalizeRatio(task.ratio),
    createdAt,
    updatedAt,
    source: { taskId: task.id, taskType: 'standard', readOnly: true, ...(snapshot.updatedAt ? { updatedAt: snapshot.updatedAt } : {}) },
    assets,
    providerJobs,
    timeline: {
      durationMs: Math.max(startMs, subtitleCues.reduce((maximum, cue) => Math.max(maximum, cue.endMs), 0)),
      clips,
      audioAssetVersionIds: unique([...narrationByScene.values()].flat()),
    },
    qualityReports: [],
    shots,
    subtitleCues,
  };
}

export function projectHtmlVideoTaskToProductionDocument(input: HtmlVideoTaskProjectionInput): HtmlVideoWorkflowDocument {
  const { task } = input;
  if (task.taskType && task.taskType !== 'html-video') {
    throw new Error(`Cannot project ${task.taskType} as an HTML video workflow.`);
  }
  const pipeline = input.pipeline ?? parseHtmlVideoPipelineData(task.pipelineData);
  const scope = projectionScope('html-video', task.id);
  const createdAt = task.createdAt;
  const updatedAt = task.completedAt ?? createdAt;
  const assets: ProductionAssetVersion[] = [];
  const layerIdsByScene = new Map<number, string[]>();
  const voiceIdByScene = new Map<number, string>();
  const compositionIdByScene = new Map<number, string>();
  const compositionByScene = new Map(pipeline.compositions.map((composition) => [composition.index, composition]));
  const voiceByScene = new Map(pipeline.voices.map((voice) => [voice.sceneIndex, voice]));

  pipeline.assets.forEach((asset) => {
    const version = htmlLayerAsset(scope, asset, updatedAt);
    assets.push(version);
    appendMapValue(layerIdsByScene, asset.sceneIndex, version.id);
  });

  pipeline.voices.forEach((voice) => {
    const version = htmlVoiceAsset(scope, voice, updatedAt);
    assets.push(version);
    voiceIdByScene.set(voice.sceneIndex, version.id);
  });

  pipeline.compositions.forEach((composition) => {
    if (composition.htmlPath) {
      const version = createAssetVersion({
        assetId: `${scope}-scene-${composition.index}-composition`,
        kind: 'document',
        path: composition.htmlPath,
        createdAt: updatedAt,
        selected: true,
      });
      assets.push(version);
      compositionIdByScene.set(composition.index, version.id);
    }
    if (composition.thumbnailPath) {
      assets.push(createAssetVersion({
        assetId: `${scope}-scene-${composition.index}-thumbnail`,
        kind: 'image',
        path: composition.thumbnailPath,
        createdAt: updatedAt,
        selected: true,
      }));
    }
    if (!voiceIdByScene.has(composition.index) && composition.audio.src) {
      const fallbackVoice = htmlVoiceAsset(scope, {
        sceneIndex: composition.index,
        src: composition.audio.src,
        durationSec: composition.audio.durationSec,
      }, updatedAt);
      assets.push(fallbackVoice);
      voiceIdByScene.set(composition.index, fallbackVoice.id);
      voiceByScene.set(composition.index, {
        sceneIndex: composition.index,
        src: composition.audio.src,
        durationSec: composition.audio.durationSec,
      });
    }
  });

  if (pipeline.coverAsset) {
    assets.push(createAssetVersion({
      assetId: `${scope}-cover`,
      kind: 'image',
      path: pipeline.coverAsset.path,
      createdAt: pipeline.coverAsset.createdAt,
      selected: true,
    }));
  }
  if (pipeline.output) {
    assets.push(createAssetVersion({
      assetId: `${scope}-output`,
      kind: 'video',
      path: pipeline.output.path,
      createdAt: updatedAt,
      selected: true,
    }));
  }

  const scenes: HtmlVideoWorkflowDocument['scenes'] = [];
  const subtitleCues: ProductionSubtitleCue[] = [];
  const clips: ProductionTimelineClip[] = [];
  let startMs = 0;
  for (const scene of pipeline.scenes) {
    const id = `${scope}-scene-${scene.index}`;
    const composition = compositionByScene.get(scene.index);
    const voice = voiceByScene.get(scene.index);
    const duration = htmlSceneDuration(composition, voice);
    const sceneSubtitleCues = (composition?.captions ?? []).map((caption) => ({
      id: `${id}-subtitle-${stableToken(`${caption.id}|${caption.startSec}|${caption.text}`)}`,
      shotId: id,
      sourceId: caption.id,
      startMs: startMs + secondsToMs(caption.startSec),
      endMs: startMs + secondsToMs(caption.startSec + caption.durationSec),
      text: caption.text,
    }));
    subtitleCues.push(...sceneSubtitleCues);
    const compositionAssetVersionId = compositionIdByScene.get(scene.index);
    const layerAssetVersionIds = unique([
      ...(layerIdsByScene.get(scene.index) ?? []),
      ...(compositionAssetVersionId ? [compositionAssetVersionId] : []),
    ]);
    scenes.push({
      id,
      sceneIndex: scene.index,
      title: scene.title,
      narration: scene.narration,
      captionTexts: [...scene.captions],
      durationMs: duration.durationMs,
      durationSource: duration.source,
      layerAssetVersionIds,
      ...(compositionAssetVersionId ? { compositionAssetVersionId } : {}),
      subtitleCueIds: sceneSubtitleCues.map((cue) => cue.id),
    });
    clips.push({
      id: `${id}-clip`,
      shotId: id,
      startMs,
      durationMs: duration.durationMs,
      assetVersionIds: layerAssetVersionIds,
      subtitleCueIds: sceneSubtitleCues.map((cue) => cue.id),
      source: 'deterministic',
    });
    startMs += duration.durationMs;
  }

  return {
    version: 1,
    id: scope,
    workflowKind: 'html-video',
    title: task.title,
    ratio: normalizeRatio(pipeline.config.ratio ?? task.ratio),
    createdAt,
    updatedAt,
    source: { taskId: task.id, taskType: 'html-video', readOnly: true, revision: pipeline.revision },
    assets,
    providerJobs: [],
    timeline: {
      durationMs: startMs,
      clips,
      audioAssetVersionIds: pipeline.scenes.flatMap((scene) => {
        const voiceId = voiceIdByScene.get(scene.index);
        return voiceId ? [voiceId] : [];
      }),
    },
    qualityReports: [],
    scenes,
    subtitleCues,
  };
}

function standardVideoProviderJob(
  scope: string,
  asset: TaskArtifactVideoPreview,
  createdAt: string,
  updatedAt: string,
): ProductionProviderJob | undefined {
  if (asset.source !== 'ai-video' || !asset.providerId || !asset.model) return undefined;
  const inputHash = stableToken(`${asset.sceneId}|${asset.path}|${asset.providerId}|${asset.model}`);
  return {
    id: `${scope}-scene-${asset.sceneId}-video-job-${inputHash}`,
    workflowKind: 'standard',
    nodeId: `${scope}-scene-${asset.sceneId}-video`,
    providerId: asset.providerId,
    model: asset.model,
    capability: 'image-to-video',
    status: 'completed',
    inputHash,
    idempotencyKey: `${scope}:scene:${asset.sceneId}:video:${inputHash}`,
    estimatedCost: asset.estimatedCost ?? 0,
    attempt: 1,
    ...(asset.remoteTaskId ? { remoteTaskId: asset.remoteTaskId } : {}),
    createdAt,
    updatedAt,
  };
}

function htmlLayerAsset(scope: string, asset: HtmlVideoAsset, createdAt: string): ProductionAssetVersion {
  return createAssetVersion({
    assetId: `${scope}-scene-${asset.sceneIndex}-${asset.kind}-${asset.slot}`,
    kind: 'image',
    path: asset.src,
    createdAt,
    prompt: asset.prompt,
    selected: true,
  });
}

function htmlVoiceAsset(scope: string, voice: HtmlVideoVoiceClip, createdAt: string): ProductionAssetVersion {
  return createAssetVersion({
    assetId: `${scope}-scene-${voice.sceneIndex}-voice`,
    kind: 'audio',
    path: voice.src,
    createdAt,
    selected: true,
  });
}

function htmlSceneDuration(
  composition: HtmlVideoCompositionSnapshot | undefined,
  voice: HtmlVideoVoiceClip | undefined,
): { durationMs: number; source: HtmlVideoDurationSource } {
  if (composition && composition.durationSec > 0) return { durationMs: secondsToMs(composition.durationSec), source: 'composition' };
  if (voice && voice.durationSec > 0) return { durationMs: secondsToMs(voice.durationSec), source: 'voice' };
  return { durationMs: 0, source: 'pending' };
}

function createAssetVersion(input: AssetVersionInput): ProductionAssetVersion {
  const signature = [input.kind, input.path, input.provider ?? '', input.model ?? '', input.prompt ?? ''].join('|');
  return {
    id: `${input.assetId}-v-${stableToken(signature)}`,
    assetId: input.assetId,
    kind: input.kind,
    localPath: input.path,
    createdAt: input.createdAt,
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(input.providerJobId ? { providerJobId: input.providerJobId } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.license ? { license: input.license } : {}),
    ...(input.selected === undefined ? {} : { selected: input.selected }),
  };
}

function groupSubtitleIdsByShot(cues: ProductionSubtitleCue[]): Map<string, string[]> {
  const output = new Map<string, string[]>();
  cues.forEach((cue) => {
    if (cue.shotId) appendMapValue(output, cue.shotId, cue.id);
  });
  return output;
}

function appendMapValue<K>(map: Map<K, string[]>, key: K, value: string): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function lastIndexBy<T, K>(values: readonly T[], key: (value: T) => K): Map<K, number> {
  const output = new Map<K, number>();
  values.forEach((value, index) => output.set(key(value), index));
  return output;
}

function projectionScope(kind: 'standard' | 'html-video', taskId: string): string {
  return `production-${kind}-${stableToken(taskId)}`;
}

function normalizeRatio(value: string | undefined): StandardWorkflowDocument['ratio'] {
  return productionRatios.has(value ?? '') ? value as StandardWorkflowDocument['ratio'] : '9:16';
}

function secondsToMs(value: number): number {
  return Math.round(value * 1000);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stableToken(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
