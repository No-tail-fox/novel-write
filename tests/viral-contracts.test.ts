import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileDatabase } from '@shared/storage';
import { ipcInputSchemas } from '@shared/ipc-contract';
import * as reconciliation from '@shared/state-reconciliation';
import * as viralAnalysis from '@shared/viral-analysis';
import type {
  CustomStyle,
  PromptTemplate,
  ViralAnalysisEvent,
  ViralAnalysisRecord,
  ViralAnalysisResult,
} from '@shared/types';

function viralRecord(): ViralAnalysisRecord {
  return {
    id: 'viral-contract', archivedAt: null, managedStorageKey: 'viral-contract-key',
    url: 'https://www.douyin.com/video/123', platform: 'douyin', title: 'Contract clip',
    status: 'pending', currentStage: 'queued', progress: 0,
    settings: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', templateId: 'default-portrait-9-16' },
    resultPath: '', videoPath: '', errorMessage: '', createdAt: '2026-07-20T00:00:00.000Z',
    startedAt: null, completedAt: null, lastHeartbeatAt: null,
  };
}

function viralResult(): ViralAnalysisResult {
  return {
    source: {
      platform: 'douyin', url: viralRecord().url, normalizedUrl: viralRecord().url,
      downloadProvider: 'douyin-internal', usedCookieSource: 'none', title: 'Clip', author: 'Creator',
      duration: 12, videoPath: 'video.mp4', coverPath: '', stats: { likes: 1, comments: 2, shares: 3 },
    },
    transcript: [{ text: 'Transcript', start: 0, end: 1, words: [] }],
    frames: [{
      timestamp: 0, framePath: 'frame.jpg', shotType: 'close', cameraMovement: 'fixed',
      composition: 'center', transition: 'cut', textOverlay: null, visualDescription: 'Frame',
      mood: 'calm', keyElements: ['person'], imagePrompt: 'prompt',
    }],
    contentBreakdown: {
      topic: 'Topic', title: { original: 'Title', pattern: 'Pattern', suggestions: [] },
      cover: { observed: 'Cover', pattern: 'Pattern', suggestions: [] },
      opening: { type: '开门见山', analysis: 'Opening', reusablePattern: 'Opening pattern' },
      structure: { type: '递进结构', analysis: 'Structure', outline: [] },
      ending: { type: '总结型结尾', analysis: 'Ending', reusablePattern: 'Ending pattern' },
      viralPoint: { summary: 'Point', evidence: [], reusablePattern: 'Point pattern' },
    },
    recreation: {
      formula: { main: 'Main', title: 'Title', cover: 'Cover', opening: 'Opening', structure: 'Structure', ending: 'Ending' },
      templatePrompt: 'Template',
      storyCore: { who: 'Who', where: 'Where', whatHappened: 'What', why: 'Why', turningPoint: 'Turn', result: 'Result' },
      storyContent: 'Story', blueprint: 'Blueprint', script: 'Script', openingOptions: [], titleOptions: [], coverIdeas: [], storyboardHints: [],
      taskDefaults: { track: 'ecommerce', style: 'photo-real', ratio: '9:16', storyboardSceneCount: 12 },
    },
    createdAt: '2026-07-20T00:00:00.000Z',
  };
}

function viralEvent(seq: number): ViralAnalysisEvent {
  return { seq, analysisId: 'viral-contract', type: 'tick', stage: 'downloading', detail: `event-${seq}`, dataJson: null, ts: seq };
}

function storyTemplate(): PromptTemplate {
  return {
    id: 'viral-story', name: 'Viral story', type: 'task', description: '', content: 'Story prompt',
    isBuiltin: false, updatedAt: '2026-07-20T00:00:00.000Z', origin: 'custom',
  };
}

function imageTemplate(): CustomStyle {
  return {
    id: 'viral-image', name: 'Viral image', tag: 'viral', shortName: 'viral', prefix: 'prefix', suffix: 'suffix',
    negativePrompt: '', allowColor: true, description: '', createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

describe('Viral lifecycle and event contracts', () => {
  it('collects every cursor page and rejects cursor loops', async () => {
    const collect = (reconciliation as unknown as {
      collectViralEventPages?: (
        first: { items: ViralAnalysisEvent[]; nextCursor: string | null },
        load: (cursor: string) => Promise<{ items: ViralAnalysisEvent[]; nextCursor: string | null }>,
      ) => Promise<ViralAnalysisEvent[]>;
    }).collectViralEventPages;
    expect(typeof collect).toBe('function');
    await expect(collect!(
      { items: Array.from({ length: 100 }, (_, index) => viralEvent(index + 2)), nextCursor: 'older' },
      async () => ({ items: [viralEvent(1)], nextCursor: null }),
    )).resolves.toHaveLength(101);
    await expect(collect!({ items: [viralEvent(2)], nextCursor: 'loop' }, async () => ({ items: [viralEvent(1)], nextCursor: 'loop' })))
      .rejects.toThrow(/CURSOR_LOOP/);
  });

  it('drops prior-generation events when a newer detail is reconciled', () => {
    const previous = { ...viralRecord(), runGeneration: 1 };
    const current = {
      tasks: [], events: [], viralAnalyses: [previous],
      viralEvents: [{ ...viralEvent(1), runGeneration: 1 }],
    };
    const next = reconciliation.mergeReconciliationSlices(current, {
      task: null, taskEvents: [], viralAnalysis: { ...previous, runGeneration: 2 },
      viralEvents: [{ ...viralEvent(2), runGeneration: 2 }],
    });
    expect(next.viralEvents.map((event) => event.runGeneration)).toEqual([2]);
  });

  it('guards persisted events and status updates by run generation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-viral-generation-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      const record = await db.createViralAnalysis({ url: viralRecord().url, platform: 'douyin', settings: viralRecord().settings });
      const runtime = db as unknown as {
        beginViralAnalysisRun?: (id: string) => Promise<ViralAnalysisRecord>;
        addViralAnalysisEvent: (id: string, event: { type: string; stage: string; detail: string; dataJson?: string; runGeneration: number }) => Promise<ViralAnalysisEvent>;
        updateViralAnalysisForGeneration?: (id: string, generation: number, patch: { progress: number }) => Promise<boolean>;
      };
      expect(typeof runtime.beginViralAnalysisRun).toBe('function');
      expect(typeof runtime.updateViralAnalysisForGeneration).toBe('function');
      const first = await runtime.beginViralAnalysisRun!(record.id);
      await runtime.addViralAnalysisEvent(record.id, { type: 'first', stage: 'downloading', detail: 'first run', runGeneration: first.runGeneration ?? 0 });
      const second = await runtime.beginViralAnalysisRun!(record.id);
      const firstGeneration = first.runGeneration ?? 0;
      expect(second.runGeneration).toBe(firstGeneration + 1);
      await expect(runtime.addViralAnalysisEvent(record.id, { type: 'late', stage: 'failed', detail: 'old run', runGeneration: firstGeneration }))
        .rejects.toThrow(/STALE_VIRAL_RUN/);
      await expect(runtime.updateViralAnalysisForGeneration!(record.id, firstGeneration, { progress: 0.9 })).resolves.toBe(false);
      await runtime.addViralAnalysisEvent(record.id, {
        type: 'large', stage: 'downloading', detail: 'large event', runGeneration: second.runGeneration ?? 0,
        dataJson: JSON.stringify({ payload: 'x'.repeat(300_000) }),
      });
      const stored = (await db.listViralAnalysisEvents(record.id, { limit: 10 })).items.at(-1);
      expect((await db.listViralAnalysisEvents(record.id, { limit: 10 })).items.every((event) => event.runGeneration === second.runGeneration)).toBe(true);
      expect(stored?.dataJson?.length).toBeLessThanOrEqual(262_144);
      expect(JSON.parse(stored?.dataJson ?? '{}')).toMatchObject({ truncated: true });
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resumes from a persisted stage checkpoint without repeating completed providers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-viral-resume-'));
    const result = viralResult();
    const calls: string[] = [];
    const checkpoints: unknown[] = [];
    try {
      await viralAnalysis.runViralAnalysis(viralRecord(), {
        workDir: dir,
        resumeFrom: {
          runGeneration: 3,
          downloaded: {
            source: result.source, videoPath: result.source.videoPath, provider: 'douyin-internal',
            normalizedUrl: result.source.normalizedUrl, usedCookieSource: 'none',
          },
          extracted: { audioPath: 'audio.wav', frames: [{ timestamp: 0, framePath: 'frame.jpg' }] },
          transcript: result.transcript,
          frames: result.frames,
        },
        persistCheckpoint: async (checkpoint: unknown) => { checkpoints.push(checkpoint); },
        download: async () => { calls.push('download'); throw new Error('completed download repeated'); },
        extract: async () => { calls.push('extract'); throw new Error('completed extraction repeated'); },
        transcribe: async () => { calls.push('transcribe'); throw new Error('completed transcription repeated'); },
        analyzeFrame: async () => { calls.push('frame'); throw new Error('completed frame analysis repeated'); },
        analyzeBreakdown: async () => { calls.push('breakdown'); return result.contentBreakdown; },
        createRecreation: async () => { calls.push('recreation'); return result.recreation; },
      } as Parameters<typeof viralAnalysis.runViralAnalysis>[1] & Record<string, unknown>);
      expect(calls).toEqual(['breakdown', 'recreation']);
      expect(checkpoints.at(-1)).toMatchObject({ runGeneration: 3, completed: expect.any(Object) });
      expect((checkpoints.at(-1) as { completed: { resultPath: string } }).completed.resultPath).toMatch(/viral-analysis-result-3\.json$/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('invalidates old report references when a new run generation begins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-viral-result-generation-'));
    const db = await FileDatabase.open(join(dir, 'data.db'));
    try {
      const created = await db.createViralAnalysis({ url: viralRecord().url, platform: 'douyin', settings: viralRecord().settings });
      const first = await db.beginViralAnalysisRun(created.id);
      await (db as unknown as {
        updateViralAnalysisForGeneration(id: string, generation: number, patch: Record<string, unknown>): Promise<boolean>;
      }).updateViralAnalysisForGeneration(created.id, first.runGeneration ?? 0, {
        status: 'completed', resultPath: 'old-result.json', videoPath: 'old-video.mp4', completedAt: '2026-07-20T00:00:00.000Z',
        resultGeneration: first.runGeneration,
        checkpoint: { runGeneration: first.runGeneration, completed: { resultPath: 'old-result.json', videoPath: 'old-video.mp4' } },
      });
      const second = await db.beginViralAnalysisRun(created.id);
      expect(second).toMatchObject({ resultPath: '', videoPath: '', completedAt: null, resultGeneration: null });
      expect(second.checkpoint).not.toHaveProperty('completed');

      const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
      const getResult = main.slice(main.indexOf("trustedHandle('viral:get-result'"), main.indexOf("trustedHandle('viral:create-production-task'"));
      const handoff = main.slice(main.indexOf("trustedHandle('viral:create-production-task'"), main.indexOf("trustedHandle('task:update-status'"));
      for (const source of [getResult, handoff]) {
        expect(source).toContain("record.status !== 'completed'");
        expect(source).toContain('record.resultGeneration !== record.runGeneration');
      }
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('derives the visible resume stage from the last persisted checkpoint', () => {
    const resumeState = (viralAnalysis as unknown as {
      viralCheckpointResumeState?: (checkpoint: unknown) => { stage: string; progress: number };
    }).viralCheckpointResumeState;
    expect(typeof resumeState).toBe('function');
    expect(resumeState!({ downloaded: {}, extracted: {}, transcript: [], frames: [] })).toEqual({ stage: 'breaking_down', progress: 0.72 });
    expect(resumeState!({ downloaded: {}, extracted: {} })).toEqual({ stage: 'transcribing', progress: 0.32 });
  });

  it('recovers a process-crashed running analysis as resumable without dropping its checkpoint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-viral-crash-recovery-'));
    const file = join(dir, 'data.db');
    try {
      const first = await FileDatabase.open(file);
      const created = await first.createViralAnalysis({ url: viralRecord().url, platform: 'douyin', settings: viralRecord().settings });
      const running = await first.beginViralAnalysisRun(created.id);
      await first.updateViralAnalysisForGeneration(created.id, running.runGeneration ?? 0, {
        status: 'running', currentStage: 'transcribing', progress: 0.32,
        checkpoint: { runGeneration: running.runGeneration ?? 0, downloaded: {
          source: viralResult().source, videoPath: 'video.mp4', provider: 'douyin-internal',
          normalizedUrl: viralRecord().url, usedCookieSource: 'none',
        } },
      });
      await first.close();

      const recovered = await FileDatabase.open(file);
      expect(await recovered.getViralAnalysisDetail(created.id)).toMatchObject({
        status: 'paused', currentStage: 'transcribing', progress: 0.32,
        checkpoint: { runGeneration: running.runGeneration, downloaded: { videoPath: 'video.mp4' } },
      });
      await recovered.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('saves the paired Viral templates in one rollback-safe commit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-viral-template-atomic-'));
    const file = join(dir, 'data.db');
    let rejectReplace = false;
    const db = await FileDatabase.open(file, {
      replaceFile: async (source, target) => {
        if (rejectReplace) throw new Error('injected viral template commit failure');
        await rename(source, target);
      },
    });
    const story = storyTemplate();
    const image = imageTemplate();
    try {
      const save = (db as unknown as { saveViralTemplatesAtomically?: (input: { storyTemplate: PromptTemplate; imageTemplate: CustomStyle }) => Promise<void> })
        .saveViralTemplatesAtomically;
      expect(typeof save).toBe('function');
      rejectReplace = true;
      await expect(save!.call(db, { storyTemplate: story, imageTemplate: image })).rejects.toThrow('injected viral template commit failure');
      rejectReplace = false;
      expect(await db.getPromptTemplateDetail(story.id)).toBeNull();
      expect((await db.getState()).customStyles.some((style) => style.id === image.id)).toBe(false);
      await save!.call(db, { storyTemplate: story, imageTemplate: image });
      expect(await db.getPromptTemplateDetail(story.id)).toMatchObject({ id: story.id });
      expect((await db.getState()).customStyles).toContainEqual(expect.objectContaining({ id: image.id }));
    } finally {
      rejectReplace = false;
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('strictly validates both sides of the atomic template IPC payload', () => {
    const valid = { storyTemplate: storyTemplate(), imageTemplate: imageTemplate() };
    expect(ipcInputSchemas['viral:save-templates'].parse(valid)).toEqual(valid);
    expect(() => ipcInputSchemas['viral:save-templates'].parse({ ...valid, extra: true })).toThrow();
    expect(() => ipcInputSchemas['viral:save-templates'].parse({ storyTemplate: valid.storyTemplate })).toThrow();
    expect(() => ipcInputSchemas['viral:save-templates'].parse({ ...valid, imageTemplate: { ...valid.imageTemplate, allowColor: 'yes' } })).toThrow();
  });

  it('keeps recovery checkpoints out of renderer-facing Viral detail responses', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('publicViralAnalysisDetail');
    expect(main).toMatch(/viral:get-detail[\s\S]*?publicViralAnalysisDetail/u);
    const reconcile = main.slice(main.indexOf('async function reconcileAppDeltas'), main.indexOf("trustedHandle('window:control'"));
    expect(reconcile).toContain('publicViralAnalysisDetail');
  });

  it('keeps errors bounded and exposes governed controls without cross-record setting leaks', async () => {
    const runtime = viralAnalysis as unknown as { boundViralDiagnosticText?: (value: unknown) => string };
    expect(typeof runtime.boundViralDiagnosticText).toBe('function');
    const bounded = runtime.boundViralDiagnosticText!(`provider failed: ${'x'.repeat(100_000)}`);
    expect(bounded.length).toBeLessThanOrEqual(4096);
    expect(bounded).toContain('provider failed');

    const [main, page] = await Promise.all([
      readFile(new URL('../src/app/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/viral/ViralAnalyzerPage.tsx', import.meta.url), 'utf8'),
    ]);
    const save = page.slice(page.indexOf('async function saveViralTemplates'), page.indexOf('async function retryAnalysis'));
    expect(main).toContain('collectViralEventPages');
    expect(save).toContain('api.saveViralTemplates');
    expect(save).not.toContain('api.saveCustomStyle');
    expect(save).not.toContain('api.savePromptTemplate');
    expect(page).toContain('selected.settings.track');
    expect(page).toContain("updateAnalysisStatus('paused')");
    expect(page).toContain("updateAnalysisStatus('cancelled')");
    expect(page).toContain("updateAnalysisStatus('running')");
    expect(page).toContain('selected?.archivedAt');
  });
});
