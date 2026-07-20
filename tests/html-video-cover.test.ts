import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HTML_VIDEO_COVER_MODES,
  HTML_VIDEO_COVER_RATIOS,
  buildHtmlVideoCoverPrompt,
  createHtmlVideoCoverAsset,
  htmlVideoCoverDimensions,
  normalizeHtmlVideoCoverMode,
  normalizeHtmlVideoCoverRatio,
  resolveHtmlVideoCoverTemplate,
  validateHtmlVideoCoverAsset,
  validateHtmlVideoCoverInspection,
} from '@shared/html-video-cover';
import { createHtmlVideoJobConfig, preserveHtmlVideoJobConfig } from '@shared/html-video-config';
import { resolveHtmlVideoCoverForRender } from '@shared/html-video-runner';
import { createHtmlVideoPipelineData, createHtmlVideoTaskInput } from '@shared/html-video-workflow';
import { adaptHtmlVideoCoverGenerator } from '@shared/task-runtime-providers';
import { FileDatabase } from '@shared/storage';
import type { CustomCoverTemplate, HtmlVideoCoverAsset, Task } from '@shared/types';

const template: CustomCoverTemplate = {
  id: 'cover-editorial',
  name: 'Editorial cover',
  description: 'A restrained editorial title card.',
  directions: 'Use one clear subject and a quiet background.',
  compositionRule: 'Subject on the lower third, title above.',
  titleLayout: 'Two lines, left aligned.',
  subtitleLayout: 'One compact line below the title.',
  plainHint: '',
  createdAt: '2026-07-18T00:00:00.000Z',
  updatedAt: '2026-07-18T01:00:00.000Z',
};

describe('HTML video cover catalog', () => {
  it('owns strict modes, ratios, exact dimensions, and explicit titled migration', () => {
    expect(HTML_VIDEO_COVER_MODES).toEqual(['off', 'auto', 'manual']);
    expect(HTML_VIDEO_COVER_RATIOS).toEqual(['3:4', '1:1', '16:9', '9:16']);
    expect(Object.fromEntries(HTML_VIDEO_COVER_RATIOS.map((ratio) => [
      ratio,
      htmlVideoCoverDimensions(ratio),
    ]))).toEqual({
      '3:4': { width: 768, height: 1024 },
      '1:1': { width: 1024, height: 1024 },
      '16:9': { width: 1280, height: 720 },
      '9:16': { width: 720, height: 1280 },
    });

    expect(normalizeHtmlVideoCoverMode('titled')).toBe('auto');
    expect(normalizeHtmlVideoCoverMode('off')).toBe('off');
    expect(normalizeHtmlVideoCoverRatio('3:4')).toBe('3:4');
    expect(() => normalizeHtmlVideoCoverMode('custom')).toThrow(/cover mode/i);
    expect(() => normalizeHtmlVideoCoverRatio('4:5')).toThrow(/cover ratio/i);

    expect(createHtmlVideoJobConfig()).toMatchObject({
      coverImageMode: 'off',
      coverTemplate: 'cinematic-poster',
      coverRatio: '3:4',
    });
    expect(preserveHtmlVideoJobConfig({ coverImageMode: 'titled' })).toEqual({ coverImageMode: 'auto' });
    expect(() => preserveHtmlVideoJobConfig({ coverImageMode: 'custom' })).toThrow(/coverImageMode/i);
    expect(() => preserveHtmlVideoJobConfig({ coverRatio: '4:5' })).toThrow(/coverRatio/i);
  });

  it('resolves the exact canonical ten-field template without fallback or mutation', () => {
    const resolved = resolveHtmlVideoCoverTemplate([template], template.id);
    expect(resolved).toEqual(template);
    expect(resolved).not.toBe(template);
    expect(Object.keys(resolved).sort()).toEqual([
      'compositionRule',
      'createdAt',
      'description',
      'directions',
      'id',
      'name',
      'plainHint',
      'subtitleLayout',
      'titleLayout',
      'updatedAt',
    ]);
    expect(() => resolveHtmlVideoCoverTemplate([template], 'missing-cover')).toThrow(/missing-cover/i);
    expect(template.plainHint).toBe('');
  });

  it('builds the provider prompt from every canonical template instruction', () => {
    const prompt = buildHtmlVideoCoverPrompt({
      taskTitle: 'A quiet story',
      summary: 'The first scene introduces the subject.',
      template,
      ratio: '3:4',
    });

    for (const value of [
      template.name,
      template.description,
      template.directions,
      template.compositionRule,
      template.titleLayout,
      template.subtitleLayout,
      template.plainHint,
      'A quiet story',
      'The first scene introduces the subject.',
      '768x1024',
    ]) {
      expect(prompt).toContain(value);
    }
  });
});

describe('HTML video cover artifact', () => {
  it('accepts only bounded exact-ratio image inspections', () => {
    expect(validateHtmlVideoCoverInspection({
      sourcePath: 'C:/outside/selected.png',
      exists: true,
      isFile: true,
      sizeBytes: 1024,
      width: 768,
      height: 1024,
      mimeType: 'image/png',
    }, '3:4')).toMatchObject({ width: 768, height: 1024, mimeType: 'image/png' });

    for (const invalid of [
      { exists: false },
      { isFile: false },
      { sizeBytes: 0 },
      { sizeBytes: 32 * 1024 * 1024 + 1 },
      { width: 769 },
      { height: 1023 },
      { mimeType: 'image/svg+xml' },
    ]) {
      expect(() => validateHtmlVideoCoverInspection({
        sourcePath: 'C:/outside/selected.png',
        exists: true,
        isFile: true,
        sizeBytes: 1024,
        width: 768,
        height: 1024,
        mimeType: 'image/png',
        ...invalid,
      }, '3:4')).toThrow();
    }
  });

  it('creates and validates a versioned task-managed artifact without external path ownership', () => {
    const asset = createHtmlVideoCoverAsset({
      revision: 3,
      mode: 'manual',
      path: 'covers/cover-manual-r3.png',
      sizeBytes: 2048,
      width: 768,
      height: 1024,
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      ratio: '3:4',
      createdAt: '2026-07-18T02:00:00.000Z',
    });

    expect(asset).toEqual({
      version: 1,
      revision: 3,
      mode: 'manual',
      path: 'covers/cover-manual-r3.png',
      sizeBytes: 2048,
      width: 768,
      height: 1024,
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      ratio: '3:4',
      createdAt: '2026-07-18T02:00:00.000Z',
    } satisfies HtmlVideoCoverAsset);
    expect(asset).not.toHaveProperty('sourcePath');
    expect(validateHtmlVideoCoverAsset(asset)).toEqual(asset);
    expect(() => validateHtmlVideoCoverAsset({ ...asset, path: 'C:/outside/selected.png' })).toThrow(/managed|path/i);
    expect(() => validateHtmlVideoCoverAsset({ ...asset, sha256: 'bad' })).toThrow(/sha|digest/i);
    expect(() => validateHtmlVideoCoverAsset({ ...asset, width: 1024 })).toThrow(/dimension|size|ratio/i);
  });
});

describe('HTML video cover render ownership', () => {
  const manualAsset = createHtmlVideoCoverAsset({
    revision: 2,
    mode: 'manual',
    path: 'covers/cover-manual-r2.png',
    sizeBytes: 2048,
    width: 768,
    height: 1024,
    mimeType: 'image/png',
    sha256: 'b'.repeat(64),
    ratio: '3:4',
    createdAt: '2026-07-18T02:00:00.000Z',
  });

  it('does no template or provider work in off mode', async () => {
    const state = createHtmlVideoPipelineData('Cover disabled.', { coverImageMode: 'off' });
    let templateCalls = 0;
    let providerCalls = 0;

    await expect(resolveHtmlVideoCoverForRender({
      state,
      taskTitle: 'Cover disabled',
      resolveTemplate: async () => {
        templateCalls += 1;
        return template;
      },
      generateCover: async () => {
        providerCalls += 1;
        return manualAsset;
      },
    })).resolves.toBeUndefined();
    expect(templateCalls).toBe(0);
    expect(providerCalls).toBe(0);
  });

  it('requires a validated matching managed artifact in manual mode and never falls back to auto', async () => {
    const state = createHtmlVideoPipelineData('Manual cover.', {
      coverImageMode: 'manual',
      coverRatio: '3:4',
    });
    let providerCalls = 0;
    const options = {
      state,
      taskTitle: 'Manual cover',
      resolveTemplate: async () => template,
      generateCover: async () => {
        providerCalls += 1;
        return manualAsset;
      },
    };

    await expect(resolveHtmlVideoCoverForRender(options)).rejects.toThrow(/manual.*cover|cover.*manual/i);
    expect(providerCalls).toBe(0);

    state.coverAsset = manualAsset;
    const resolved = await resolveHtmlVideoCoverForRender(options);
    expect(resolved).toEqual(manualAsset);
    expect(resolved).not.toBe(manualAsset);
    expect(providerCalls).toBe(0);

    state.config.coverRatio = '1:1';
    await expect(resolveHtmlVideoCoverForRender(options)).rejects.toThrow(/ratio|dimension/i);
    expect(providerCalls).toBe(0);
  });

  it('loads the canonical template before auto generation and rejects missing references without provider calls', async () => {
    const state = createHtmlVideoPipelineData('Automatic cover.', {
      coverImageMode: 'auto',
      coverTemplate: template.id,
      coverRatio: '3:4',
    });
    let providerCalls = 0;

    await expect(resolveHtmlVideoCoverForRender({
      state,
      taskTitle: 'Automatic cover',
      resolveTemplate: async () => null,
      generateCover: async () => {
        providerCalls += 1;
        return manualAsset;
      },
    })).rejects.toThrow(/template.*missing|missing.*template/i);
    expect(providerCalls).toBe(0);

    const requests: Array<Parameters<NonNullable<Parameters<typeof resolveHtmlVideoCoverForRender>[0]['generateCover']>>[0]> = [];
    const autoAsset = createHtmlVideoCoverAsset({
      ...manualAsset,
      mode: 'auto',
      templateId: template.id,
      path: 'covers/cover-auto-r2.png',
      sha256: 'c'.repeat(64),
    });
    const generated = await resolveHtmlVideoCoverForRender({
      state,
      taskTitle: 'Automatic cover',
      resolveTemplate: async (id) => id === template.id ? structuredClone(template) : null,
      generateCover: async (input) => {
        providerCalls += 1;
        requests.push(input);
        return autoAsset;
      },
    });

    expect(generated).toEqual(autoAsset);
    expect(requests[0]).toMatchObject({
      taskTitle: 'Automatic cover',
      ratio: '3:4',
      dimensions: { width: 768, height: 1024 },
      template,
    });
    expect(requests[0]?.prompt).toContain(template.compositionRule);
    expect(Object.keys(requests[0]?.template ?? {}).sort()).toEqual(Object.keys(template).sort());
    expect(providerCalls).toBe(1);
  });

  it('adapts one canonical auto-cover request into a versioned managed PNG', async () => {
    const providerCalls: Array<{ prompt: string; ratio: string; taskRatio: string }> = [];
    const prepareCalls: Array<{ sourcePath: string; destinationPath: string; width: number; height: number }> = [];
    const generate = adaptHtmlVideoCoverGenerator(
      async (scenes, prompts, task) => {
        providerCalls.push({
          prompt: prompts[0].prompt,
          ratio: prompts[0].ratio,
          taskRatio: task.ratio,
        });
        return [{ sceneId: scenes[0].id, path: 'I:/managed/provider-images/000.png' }];
      },
      { id: 'task-cover-adapter', title: 'Adapter task', style: 'modern-film', ratio: '9:16' } as Task,
      'I:/managed',
      async (input) => {
        prepareCalls.push({
          sourcePath: input.sourcePath,
          destinationPath: input.destinationPath,
          width: input.dimensions.width,
          height: input.dimensions.height,
        });
        return {
          sizeBytes: 4096,
          width: input.dimensions.width,
          height: input.dimensions.height,
          mimeType: 'image/png',
          sha256: 'e'.repeat(64),
        };
      },
    );
    const config = createHtmlVideoJobConfig({
      style: 'modern-film',
      coverImageMode: 'auto',
      coverTemplate: template.id,
      coverRatio: '3:4',
    });
    const asset = await generate({
      taskTitle: 'Adapter task',
      summary: 'Adapter summary',
      ratio: '3:4',
      revision: 4,
      dimensions: { width: 768, height: 1024 },
      template,
      prompt: buildHtmlVideoCoverPrompt({
        taskTitle: 'Adapter task',
        summary: 'Adapter summary',
        ratio: '3:4',
        template,
      }),
      config,
    });

    expect(providerCalls).toEqual([{
      prompt: expect.stringContaining(template.compositionRule),
      ratio: '3:4',
      taskRatio: '3:4',
    }]);
    expect(prepareCalls).toEqual([{
      sourcePath: 'I:/managed/provider-images/000.png',
      destinationPath: 'I:\\managed\\covers\\cover-auto-r4.png',
      width: 768,
      height: 1024,
    }]);
    expect(asset).toMatchObject({
      version: 1,
      revision: 4,
      mode: 'auto',
      path: 'covers/cover-auto-r4.png',
      ratio: '3:4',
      templateId: template.id,
      width: 768,
      height: 1024,
      sizeBytes: 4096,
    });
  });
});

describe('HTML video manual cover import transaction', () => {
  it('promotes one validated task-managed artifact and atomically invalidates only render', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-html-cover-import-'));
    const database = await FileDatabase.open(join(directory, 'app.db'));
    const sourcePath = join(directory, 'selected-external.png');
    await writeFile(sourcePath, Buffer.from('external-source'));
    try {
      const task = await createCompletedCoverTask(database, 'manual import success');
      const workDir = join(directory, 'tasks', task.managedStorageKey!);
      const calls: string[] = [];
      const result = await database.importHtmlVideoCover(
        task.id,
        coverInspection(sourcePath),
        coverImportOperations(calls),
      );

      expect(calls).toEqual(['prepare', 'promote']);
      expect(result.task).toMatchObject({ status: 'paused', currentStep: 5 });
      expect(result.event).toMatchObject({
        type: 'cover_import',
        step: 5,
        runGeneration: result.task.runGeneration,
      });
      const stored = await database.getTaskDetail(task.id);
      const pipeline = createHtmlVideoPipelineData('unused');
      Object.assign(pipeline, JSON.parse(stored?.pipelineData ?? '{}'));
      expect(stored).toMatchObject({
        status: 'paused',
        currentStep: 5,
        pipelineStep: 'render',
        completedAt: null,
        failedStep: null,
        retryFromStep: null,
      });
      expect(pipeline.steps.preview.status).toBe('completed');
      expect(pipeline.steps.render).toEqual({ status: 'pending' });
      expect(pipeline).not.toHaveProperty('output');
      expect(pipeline.coverAsset).toMatchObject({
        version: 1,
        revision: 1,
        mode: 'manual',
        path: 'covers/cover-manual-r1.png',
        ratio: '3:4',
        width: 768,
        height: 1024,
      });
      expect(await readFile(sourcePath, 'utf8')).toBe('external-source');
      expect(await readdir(join(workDir, 'covers'))).toEqual(['cover-manual-r1.png']);
      expect((await database.listTaskEvents(task.id, { limit: 100 })).items)
        .toEqual([expect.objectContaining({ type: 'cover_import', step: 5 })]);
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects active, archived, tombstoned, and invalid sources before staging with no side effects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-html-cover-reject-'));
    const database = await FileDatabase.open(join(directory, 'app.db'));
    const sourcePath = join(directory, 'selected-external.png');
    await writeFile(sourcePath, Buffer.from('external-source'));
    let prepareCalls = 0;
    const operations = coverImportOperations([], () => { prepareCalls += 1; });
    try {
      const pending = await database.createTask(createHtmlVideoTaskInput({
        copy: 'pending cover import',
        coverImageMode: 'manual',
      }));
      const pendingBefore = await database.getTaskDetail(pending.id);
      await expect(database.importHtmlVideoCover(pending.id, coverInspection(sourcePath), operations))
        .rejects.toThrow(/pending|active|running/i);
      expect(await database.getTaskDetail(pending.id)).toEqual(pendingBefore);

      const running = await createCompletedCoverTask(database, 'running cover import');
      await database.updateTask(running.id, { status: 'running' });
      await expect(database.importHtmlVideoCover(running.id, coverInspection(sourcePath), operations))
        .rejects.toThrow(/running|active/i);

      const archived = await createCompletedCoverTask(database, 'archived cover import');
      await database.archiveTask(archived.id);
      await expect(database.importHtmlVideoCover(archived.id, coverInspection(sourcePath), operations))
        .rejects.toThrow(/HISTORY_ARCHIVED/);

      const deleted = await createCompletedCoverTask(database, 'deleted cover import');
      await database.archiveTask(deleted.id);
      await database.deleteTaskPermanently(deleted.id, {
        cleanupState: 'missing',
        quarantineName: null,
        quarantineIdentityJson: '{}',
        diagnostic: 'No managed test directory.',
      });
      await expect(database.importHtmlVideoCover(deleted.id, coverInspection(sourcePath), operations))
        .rejects.toThrow(/HISTORY_DELETED/);

      const valid = await createCompletedCoverTask(database, 'invalid source cover import');
      const before = await database.getTaskDetail(valid.id);
      for (const invalid of [
        { exists: false },
        { isFile: false },
        { sizeBytes: 0 },
        { sizeBytes: 32 * 1024 * 1024 + 1 },
        { width: 1 },
        { height: 1 },
        { mimeType: 'image/svg+xml' },
      ]) {
        await expect(database.importHtmlVideoCover(
          valid.id,
          { ...coverInspection(sourcePath), ...invalid },
          operations,
        )).rejects.toThrow();
        expect(await database.getTaskDetail(valid.id)).toEqual(before);
      }
      expect(prepareCalls).toBe(0);
      expect((await database.listTaskEvents(valid.id, { limit: 100 })).items).toEqual([]);
      expect(existsSync(join(directory, 'tasks', valid.managedStorageKey!, 'covers'))).toBe(false);
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('cleans staged or promoted replacements and preserves the prior artifact on failures', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storydream-html-cover-rollback-'));
    const databasePath = join(directory, 'app.db');
    let failPersistence = false;
    const database = await FileDatabase.open(databasePath, {
      replaceFile: async (source, target) => {
        if (failPersistence && target === databasePath) throw new Error('injected database persistence failure');
        await rename(source, target);
      },
    });
    const firstSource = join(directory, 'first.png');
    const secondSource = join(directory, 'second.png');
    await Promise.all([
      writeFile(firstSource, Buffer.from('first-external')),
      writeFile(secondSource, Buffer.from('second-external')),
    ]);
    try {
      const task = await createCompletedCoverTask(database, 'manual import rollback');
      await database.importHtmlVideoCover(task.id, coverInspection(firstSource), coverImportOperations([]));
      const firstTask = await database.getTaskDetail(task.id);
      const firstPipeline = JSON.parse(firstTask?.pipelineData ?? '{}') as { coverAsset: HtmlVideoCoverAsset };
      const workDir = join(directory, 'tasks', task.managedStorageKey!);
      const firstCover = join(workDir, firstPipeline.coverAsset.path);
      expect(existsSync(firstCover)).toBe(true);

      const promotionCalls: string[] = [];
      const promotionFailure = coverImportOperations(promotionCalls);
      promotionFailure.promoteFile = async () => {
        promotionCalls.push('promote-failed');
        throw new Error('injected promotion failure');
      };
      await expect(database.importHtmlVideoCover(task.id, coverInspection(secondSource), promotionFailure))
        .rejects.toThrow(/promotion failure/);
      expect(await database.getTaskDetail(task.id)).toEqual(firstTask);
      expect(existsSync(firstCover)).toBe(true);
      expect((await readdir(join(workDir, 'covers'))).sort()).toEqual(['cover-manual-r1.png']);

      failPersistence = true;
      await expect(database.importHtmlVideoCover(task.id, coverInspection(secondSource), coverImportOperations([])))
        .rejects.toThrow(/persistence failure/);
      expect(await database.getTaskDetail(task.id)).toEqual(firstTask);
      expect(existsSync(firstCover)).toBe(true);
      expect((await readdir(join(workDir, 'covers'))).sort()).toEqual(['cover-manual-r1.png']);
      expect(await readFile(secondSource, 'utf8')).toBe('second-external');
    } finally {
      failPersistence = false;
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function createCompletedCoverTask(database: FileDatabase, copy: string) {
  const input = createHtmlVideoTaskInput({
    copy,
    coverImageMode: 'manual',
    coverRatio: '3:4',
  });
  const task = await database.createTask(input);
  const pipeline = createHtmlVideoPipelineData(input.inputText, JSON.parse(input.pipelineData ?? '{}').config);
  pipeline.current = 'done';
  for (const step of Object.keys(pipeline.steps) as Array<keyof typeof pipeline.steps>) {
    pipeline.steps[step] = { status: 'completed', inputHash: `${step}-hash`, artifactPath: `steps/${step}.json`, artifactSize: 10 };
  }
  pipeline.output = { path: 'final.mp4', sizeBytes: 100 };
  await database.updateTask(task.id, {
    status: 'completed',
    currentStep: 6,
    pipelineStep: 'done',
    pipelineData: JSON.stringify(pipeline),
    completedAt: '2026-07-18T00:00:00.000Z',
  });
  return task;
}

function coverInspection(sourcePath: string) {
  return {
    sourcePath,
    exists: true,
    isFile: true,
    sizeBytes: 1024,
    width: 768,
    height: 1024,
    mimeType: 'image/png',
  };
}

function coverImportOperations(calls: string[], onPrepare?: () => void) {
  return {
    async prepareImage(input: { sourcePath: string; destinationPath: string; dimensions: { width: number; height: number } }) {
      calls.push('prepare');
      onPrepare?.();
      const bytes = Buffer.from(`prepared:${input.sourcePath}`);
      await mkdir(join(input.destinationPath, '..'), { recursive: true });
      await writeFile(input.destinationPath, bytes);
      return {
        sizeBytes: bytes.length,
        width: input.dimensions.width,
        height: input.dimensions.height,
        mimeType: 'image/png' as const,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    },
    async promoteFile(source: string, target: string) {
      calls.push('promote');
      await rename(source, target);
    },
    async removeFile(path: string) {
      await rm(path, { force: true });
    },
    async ensureDirectory(path: string) {
      await mkdir(path, { recursive: true });
    },
    now: () => '2026-07-18T03:00:00.000Z',
  };
}
