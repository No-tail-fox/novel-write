import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { readTaskArtifactSnapshot } from '@shared/artifact-preview';
import type { Task } from '@shared/types';

describe('task artifact preview reader', () => {
  it('reads the pipeline state and exposes every observable artifact group', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-artifact-preview-'));
    const pipelineDir = join(dir, 'pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const statePath = join(pipelineDir, 'state.json');
    await writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          taskId: 'task-1',
          updatedAt: '2026-05-27T00:00:00.000Z',
          steps: {
            0: { status: 'completed', outputPath: join(dir, '00-reviewed.txt') },
            1: { status: 'completed', outputPath: join(dir, '01-rewritten-copy.md') },
            2: { status: 'completed', outputPath: join(dir, '02-sentences.json') },
            3: { status: 'completed', outputPath: join(dir, '03-image-prompts.json') },
            4: { status: 'completed' },
            5: { status: 'completed' },
            6: { status: 'completed', outputPath: join(dir, 'draft') },
          },
          artifact: {
            sourceContext: {
              query: 'Wu Zetian',
              warnings: [],
              sections: [{ source: 'web', title: 'Selected page', url: 'https://example.test/a', content: 'source body' }],
            },
            reviewedText: 'Reviewed source text.',
            rewrittenCopy: 'Rewritten story copy.',
            cover: { title: 'Cover Title', subtitle: ['Subtitle'], summary: 'Summary', tags: ['#tag'], comments: ['comment'] },
            scenes: [{ id: 1, cap: 'Scene line', descPrompt: 'Scene prompt', durationMs: 1200 }],
            imagePrompts: [{ sceneId: 1, cap: 'Scene line', prompt: 'Image prompt', negativePrompt: 'bad', style: 'photo-real', ratio: '9:16', characterProfile: 'profile' }],
            subtitles: { cues: [{ index: 1, startMs: 0, endMs: 1200, text: 'Scene line' }], srt: '1\\n00:00:00,000 --> 00:00:01,200\\nScene line\\n' },
          },
          assets: {
            images: [{ sceneId: 1, path: join(dir, 'images', 'scene-1.png'), borrowedFrom: 3 }],
            videos: [{ sceneId: 1, path: join(dir, 'videos', 'scene-1.mp4'), source: 'local-upload', originalName: 'clip.mov', durationMs: 4200, width: 1080, height: 1920, trimStartMs: 300, fit: 'cover', muted: true }],
            narration: [{ sceneId: 1, path: join(dir, 'audio', 'scene-1.wav') }],
          },
          draft: { draftDir: join(dir, 'draft'), draftContentPath: join(dir, 'draft', 'draft_content.json'), draftMetaPath: join(dir, 'draft', 'draft_meta_info.json') },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshot = await readTaskArtifactSnapshot(makeTask({ artifactStatePath: statePath, outputDir: join(dir, 'draft') }));

    expect(snapshot.available).toBe(true);
    expect(snapshot.artifact.reviewedText).toBe('Reviewed source text.');
    expect(snapshot.artifact.rewrittenCopy).toBe('Rewritten story copy.');
    expect(snapshot.artifact.cover?.title).toBe('Cover Title');
    expect(snapshot.artifact.scenes?.[0]?.cap).toBe('Scene line');
    expect(snapshot.artifact.imagePrompts?.[0]?.prompt).toBe('Image prompt');
    expect(snapshot.assets.images[0].path).toContain('scene-1.png');
    expect(snapshot.assets.images[0].borrowedFrom).toBe(3);
    expect(snapshot.assets.videos[0]).toMatchObject({ sceneId: 1, source: 'local-upload', trimStartMs: 300, muted: true });
    expect(snapshot.assets.narration[0].path).toContain('scene-1.wav');
    expect(snapshot.draft?.draftDir).toContain('draft');
  });

  it('preserves multiple narration turn metadata for one scene', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-artifact-preview-turns-'));
    const pipelineDir = join(dir, 'pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const statePath = join(pipelineDir, 'state.json');
    await writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          taskId: 'task-1',
          updatedAt: '2026-06-16T00:00:00.000Z',
          steps: {},
          artifact: {
            scenes: [{ id: 1, cap: 'Host A: First\nHost B: Second', descPrompt: 'prompt', durationMs: 1200 }],
          },
          assets: {
            narration: [
              { sceneId: 1, path: join(dir, 'audio', '001-turn-001-A.mp3'), speaker: 'A', turnIndex: 1, text: 'First' },
              { sceneId: 1, path: join(dir, 'audio', '001-turn-002-B.mp3'), speaker: 'B', turnIndex: 2, text: 'Second' },
            ],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshot = await readTaskArtifactSnapshot(makeTask({ artifactStatePath: statePath }));

    expect(snapshot.assets.narration).toEqual([
      { sceneId: 1, path: join(dir, 'audio', '001-turn-001-A.mp3'), speaker: 'A', turnIndex: 1, text: 'First' },
      { sceneId: 1, path: join(dir, 'audio', '001-turn-002-B.mp3'), speaker: 'B', turnIndex: 2, text: 'Second' },
    ]);
  });

  it('exposes per-scene image generation errors for gallery slots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-artifact-preview-image-errors-'));
    const pipelineDir = join(dir, 'pipeline');
    await mkdir(pipelineDir, { recursive: true });
    const statePath = join(pipelineDir, 'state.json');
    const providerError = 'Image provider API error (400): content_policy_violation';
    await writeFile(
      statePath,
      JSON.stringify(
        {
          version: 1,
          taskId: 'task-1',
          updatedAt: '2026-06-24T00:00:00.000Z',
          steps: { 4: { status: 'failed', error: providerError } },
          artifact: {
            scenes: [
              { id: 1, cap: 'Scene one', descPrompt: 'first prompt', durationMs: 1200 },
              { id: 2, cap: 'Scene two', descPrompt: 'blocked prompt', durationMs: 1200 },
            ],
          },
          assets: {
            images: [{ sceneId: 1, path: join(dir, 'images', 'scene-1.png') }],
            imageErrors: [{ sceneId: 2, message: providerError }],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const snapshot = await readTaskArtifactSnapshot(makeTask({ artifactStatePath: statePath }));
    const assets = snapshot.assets as typeof snapshot.assets & { imageErrors?: Array<{ sceneId: number; message: string }> };

    expect(assets.imageErrors).toEqual([{ sceneId: 2, message: providerError }]);
  });

  it('returns an unavailable snapshot when no pipeline state exists yet', async () => {
    const snapshot = await readTaskArtifactSnapshot(makeTask({ artifactStatePath: '' }));

    expect(snapshot.available).toBe(false);
    expect(snapshot.message).toContain('等待');
    expect(snapshot.assets.images).toEqual([]);
    expect(snapshot.assets.videos).toEqual([]);
    expect(snapshot.assets.narration).toEqual([]);
  });
});

function makeTask(patch: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'task',
    inputText: '',
    taskKind: 'story',
    processingMode: 'full-auto',
    publishMode: 'review-rewrite',
    status: 'running',
    currentStep: 0,
    track: 'character-story',
    style: 'photo-real',
    speaker: 'voice',
    ratio: '9:16',
    templateId: 'default-portrait-9-16',
    bgmId: '__builtin__',
    pausePoints: [],
    outputDir: '',
    errorMessage: '',
    createdAt: new Date().toISOString(),
    completedAt: null,
    startedAt: null,
    lastHeartbeatAt: null,
    mode: 'ai',
    aiKeyword: 'Wu Zetian',
    aiSources: ['web'],
    selectedSources: [],
    extraRequirements: '',
    imagePromptReference: '',
    promptTemplateId: null,
    promptTemplateType: null,
    referenceImagePath: '',
    rewriteIntensity: 'standard',
    narrativePov: 'keep-original',
    keepPromotion: false,
    ttsProvider: 'mock',
    ttsSpeed: 1,
    storyboardSceneCount: 12,
    step3PromptSnapshot: '',
    musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
    failedStep: null,
    retryFromStep: null,
    artifactStatePath: '',
    ...patch,
  };
}
