import type { DraftTemplate, PipelineArtifact, SubtitleCue, SubtitleTrack, Task, TaskArtifactAssetPreview } from '../../shared/types';
import { resolveCoverDisplayMetadata } from '../../shared/cover-copy';

export interface TaskPreviewContent {
  title: string;
  subtitle: string;
  caption: string;
  disclaimer: string;
}

export function indexTaskAssetsBySceneId<T extends Pick<TaskArtifactAssetPreview, 'sceneId'>>(assets: readonly T[]): Map<number, T> {
  return new Map(assets.map((asset) => [asset.sceneId, asset] as const));
}

export function taskPreviewCuesForScene(subtitles: Pick<SubtitleTrack, 'cues'> | undefined, sceneId: number | undefined): SubtitleCue[] {
  if (!subtitles || sceneId === undefined) return [];
  return subtitles.cues.filter((cue) => cue.sceneId === sceneId);
}

export function resolveTaskPreviewContent(input: {
  task: Pick<Task, 'title' | 'track'>;
  cover?: PipelineArtifact['cover'];
  sourceText?: string;
  sceneCap?: string;
  sceneCue?: string;
  template: DraftTemplate;
}): TaskPreviewContent {
  const cover = input.cover
    ? resolveCoverDisplayMetadata(input.cover, { track: input.task.track, sourceText: input.sourceText })
    : undefined;
  const subtitleLines = cover?.subtitle.map((line) => line.trim()).filter(Boolean) ?? [];
  return {
    title: firstNonEmpty(cover?.title, input.task.title, input.template.title.text),
    subtitle: subtitleLines.length > 0
      ? subtitleLines.join('\n')
      : firstNonEmpty(cover?.summary, input.sceneCap, input.template.subtitle.text),
    caption: firstNonEmpty(input.sceneCue, input.sceneCap, '等待分镜字幕'),
    disclaimer: input.template.disclaimer.text,
  };
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((value) => value?.trim())?.trim() ?? '';
}
