import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runHtmlVideoPipeline,
  type HtmlVideoRewriteOutput,
  type HtmlVideoRunnerInput,
  type HtmlVideoRunnerOptions,
} from '@shared/html-video-runner';
import { createHtmlVideoPipelineData, htmlVideoVisibleSteps, parseHtmlVideoPipelineData } from '@shared/html-video-workflow';
import type {
  HtmlVideoAsset,
  HtmlVideoCompositionSnapshot,
  HtmlVideoPipelineDataV2,
  HtmlVideoScenePlan,
  HtmlVideoVisibleStep,
  HtmlVideoVoiceClip,
} from '@shared/types';

describe('HTML video runner module', () => {
  it('provides a dedicated shared runner module', () => {
    expect(existsSync(new URL('../src/shared/html-video-runner.ts', import.meta.url))).toBe(true);
  });

  it('runs all six steps in order and atomically checkpoints their artifacts', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      const result = await runHtmlVideoPipeline(createRunnerInput('six-steps'), runtime.options);

      expect(runtime.calls).toEqual([...htmlVideoVisibleSteps]);
      expect(result.current).toBe('done');
      expect(await realpath(result.output!.path)).toBe(await realpath(join(workDir, 'final.mp4')));
      for (const step of htmlVideoVisibleSteps) {
        expect(result.steps[step]).toMatchObject({ status: 'completed' });
        expect(result.steps[step].inputHash).toMatch(/^[a-f0-9]{64}$/);
        expect(result.steps[step].artifactPath).toMatch(new RegExp(`^steps[\\\\/]${step}\\.json$`));
        expect(result.steps[step].artifactSize).toBeGreaterThan(0);
      }

      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint).toMatchObject({ version: 2, current: 'done' });
      expect(await realpath(checkpoint.output!.path)).toBe(await realpath(join(workDir, 'final.mp4')));
      expect(runtime.checkpoints.at(-1)).toMatchObject({ current: 'done', revision: checkpoint.revision });
      expect(existsSync(join(workDir, 'html-video-pipeline.v2.json'))).toBe(true);
    });
  });

  it('uses deterministic rewrite and planning fallbacks with a visible warning when LLM is absent', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      delete runtime.options.rewrite;
      delete runtime.options.plan;

      const result = await runHtmlVideoPipeline(createRunnerInput('fallback', '第一句。\n\n第二句。'), runtime.options);

      expect(result.current).toBe('done');
      expect(result.scenes.map((scene) => scene.narration)).toEqual(['第一句。', '第二句。']);
      expect(result.warnings.join('\n')).toMatch(/LLM|分句/);
      expect(runtime.calls).toEqual(['assets', 'voice', 'preview', 'render']);
    });
  });

  it('rejects malformed planning output and checkpoints the exact failed step', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      runtime.options.plan = async () => ({ scenes: [{ index: 1, narration: 42 }] as unknown as HtmlVideoScenePlan[] });

      await expect(runHtmlVideoPipeline(createRunnerInput('bad-plan'), runtime.options)).rejects.toThrow(/planning|scene|pipeline/i);

      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint.current).toBe('planning');
      expect(checkpoint.steps.rewrite.status).toBe('completed');
      expect(checkpoint.steps.planning).toMatchObject({ status: 'failed' });
      expect(checkpoint.steps.assets.status).toBe('pending');
      expect(runtime.calls).toEqual(['rewrite']);
    });
  });

  it('rejects planning output whose scene indexes are not contiguous from one', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      runtime.options.plan = async (input) => {
        const scenes = buildTestScenes(input.segments);
        scenes[1].index = 3;
        return { scenes };
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('bad-scene-index'), runtime.options)).rejects.toThrow(/index|scene|planning/i);

      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint.current).toBe('planning');
      expect(checkpoint.steps.planning.status).toBe('failed');
      expect(checkpoint.steps.assets.status).toBe('pending');
    });
  });

  it('stops at the exact assets provider failure without producing fake artifacts', async () => {
    await withTempRunner((workDir) => assertProviderFailure(workDir, 'assets', 'IMAGE_PROVIDER_NOT_CONFIGURED: 请先配置图片服务。'));
  });

  it('stops at the exact voice provider failure without producing fake artifacts', async () => {
    await withTempRunner((workDir) => assertProviderFailure(workDir, 'voice', 'TTS_PROVIDER_NOT_CONFIGURED: 请先配置配音服务。'));
  });

  it('resumes from the first invalid artifact while skipping validated upstream steps', async () => {
    await withTempRunner(async (workDir) => {
      const first = createFakeRuntime(workDir, { failStep: 'preview', failureMessage: 'PREVIEW_FAILED: preview unavailable' });
      await expect(runHtmlVideoPipeline(createRunnerInput('resume-invalid'), first.options)).rejects.toThrow(/preview unavailable/);
      const failed = await readCheckpoint(workDir);
      const firstAsset = failed.assets[0]?.src;
      expect(firstAsset).toBeTruthy();
      await unlink(firstAsset!);

      const resumed = createFakeRuntime(workDir);
      const result = await runHtmlVideoPipeline(createRunnerInput('resume-invalid'), resumed.options);

      expect(result.current).toBe('done');
      expect(resumed.calls).toEqual(['assets', 'voice', 'preview', 'render']);
      expect(resumed.calls).not.toContain('rewrite');
      expect(resumed.calls).not.toContain('planning');
    });
  });

  it('reruns only the selected step and its downstream steps', async () => {
    await withTempRunner(async (workDir) => {
      const initial = createFakeRuntime(workDir);
      const completed = await runHtmlVideoPipeline(createRunnerInput('rerun'), initial.options);
      const previousRevision = completed.revision;

      const rerun = createFakeRuntime(workDir);
      const result = await runHtmlVideoPipeline({ ...createRunnerInput('rerun'), rerunFrom: 'voice' }, rerun.options);

      expect(rerun.calls).toEqual(['voice', 'preview', 'render']);
      expect(result.current).toBe('done');
      expect(result.revision).toBeGreaterThan(previousRevision);
      expect(result.steps.assets.status).toBe('completed');
    });
  });

  it('checkpoints cancellation at the active step and releases the task lock', async () => {
    await withTempRunner(async (workDir) => {
      const controller = new AbortController();
      let startRewrite!: () => void;
      const rewriteStarted = new Promise<void>((resolve) => {
        startRewrite = resolve;
      });
      const runtime = createFakeRuntime(workDir);
      runtime.options.signal = controller.signal;
      runtime.options.rewrite = ({ signal }) => new Promise<HtmlVideoRewriteOutput>((_resolve, reject) => {
        startRewrite();
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });

      const running = runHtmlVideoPipeline(createRunnerInput('cancelled'), runtime.options);
      const settled = running.then(() => 'settled' as const, () => 'settled' as const);
      expect(await Promise.race([rewriteStarted.then(() => 'started' as const), settled])).toBe('started');
      controller.abort(new DOMException('cancelled', 'AbortError'));
      await expect(running).rejects.toMatchObject({ name: 'AbortError' });

      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint.current).toBe('rewrite');
      expect(checkpoint.steps.rewrite.status).toBe('cancelled');

      const retry = createFakeRuntime(workDir);
      await expect(runHtmlVideoPipeline(createRunnerInput('cancelled'), retry.options)).resolves.toMatchObject({ current: 'done' });
    });
  });

  it('checkpoints a pre-aborted run at its first pending step', async () => {
    await withTempRunner(async (workDir) => {
      const controller = new AbortController();
      controller.abort(new DOMException('cancelled before start', 'AbortError'));
      const runtime = createFakeRuntime(workDir);
      runtime.options.signal = controller.signal;

      await expect(runHtmlVideoPipeline(createRunnerInput('pre-cancelled'), runtime.options)).rejects.toMatchObject({ name: 'AbortError' });

      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint.current).toBe('rewrite');
      expect(checkpoint.steps.rewrite.status).toBe('cancelled');
      expect(runtime.calls).toEqual([]);
    });
  });

  it('rejects a duplicate runner for the same task while the first run owns it', async () => {
    await withTempRunner(async (workDir) => {
      let releaseRewrite!: (value: HtmlVideoRewriteOutput) => void;
      let markStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const runtime = createFakeRuntime(workDir);
      runtime.options.rewrite = () => new Promise<HtmlVideoRewriteOutput>((resolve) => {
        releaseRewrite = resolve;
        markStarted();
      });
      const first = runHtmlVideoPipeline(createRunnerInput('duplicate'), runtime.options);
      const settled = first.then(() => 'settled' as const, () => 'settled' as const);
      expect(await Promise.race([started.then(() => 'started' as const), settled])).toBe('started');

      const second = createFakeRuntime(workDir);
      await expect(runHtmlVideoPipeline(createRunnerInput('duplicate'), second.options)).rejects.toThrow(/already running|正在运行/i);

      releaseRewrite({ rewrittenText: '改写结果。', segments: ['改写结果。'] });
      await expect(first).resolves.toMatchObject({ current: 'done' });
    });
  });
});

function createRunnerInput(taskId: string, sourceText = '第一句。\n\n第二句。'): HtmlVideoRunnerInput {
  return {
    taskId,
    sourceText,
    state: createHtmlVideoPipelineData(sourceText, { ratio: '9:16', style: 'modern-film', foreground: true }),
  };
}

async function assertProviderFailure(workDir: string, failedStep: 'assets' | 'voice', message: string): Promise<void> {
  const runtime = createFakeRuntime(workDir, { failStep: failedStep, failureMessage: message });
  await expect(runHtmlVideoPipeline(createRunnerInput(`fail-${failedStep}`), runtime.options)).rejects.toMatchObject({ code: message.split(':')[0] });

  const checkpoint = await readCheckpoint(workDir);
  expect(checkpoint.current).toBe(failedStep);
  expect(checkpoint.steps[failedStep]).toMatchObject({ status: 'failed' });
  expect(checkpoint.steps[failedStep].error).toMatch(/请先配置/);
  const failedIndex = htmlVideoVisibleSteps.indexOf(failedStep);
  for (const step of htmlVideoVisibleSteps.slice(failedIndex + 1)) {
    expect(checkpoint.steps[step].status).toBe('pending');
  }
}

function createFakeRuntime(
  workDir: string,
  failure?: { failStep: HtmlVideoVisibleStep; failureMessage: string },
): { calls: string[]; checkpoints: HtmlVideoPipelineDataV2[]; options: HtmlVideoRunnerOptions } {
  const calls: string[] = [];
  const checkpoints: HtmlVideoPipelineDataV2[] = [];
  const fail = (step: HtmlVideoVisibleStep) => {
    if (failure?.failStep === step) throw new Error(failure.failureMessage);
  };
  const options: HtmlVideoRunnerOptions = {
    workDir,
    async rewrite(input) {
      calls.push('rewrite');
      fail('rewrite');
      return { rewrittenText: input.sourceText.trim(), segments: splitTestText(input.sourceText) };
    },
    async plan(input) {
      calls.push('planning');
      fail('planning');
      return { scenes: buildTestScenes(input.segments) };
    },
    async generateAssets(input) {
      calls.push('assets');
      fail('assets');
      const assets: HtmlVideoAsset[] = [];
      for (const scene of input.scenes) {
        const background = join(workDir, `scene-${scene.index}-bg.png`);
        await writeFile(background, Buffer.from(`background-${scene.index}`));
        assets.push({ sceneIndex: scene.index, kind: 'bg', slot: 0, src: background });
        if (input.config.foreground !== false) {
          const foreground = join(workDir, `scene-${scene.index}-fg.png`);
          await writeFile(foreground, Buffer.from(`foreground-${scene.index}`));
          assets.push({ sceneIndex: scene.index, kind: 'fg', slot: 0, src: foreground });
        }
      }
      return assets;
    },
    async synthesizeVoices(input) {
      calls.push('voice');
      fail('voice');
      const voices: HtmlVideoVoiceClip[] = [];
      for (const scene of input.scenes) {
        const path = join(workDir, `scene-${scene.index}.wav`);
        await writeFile(path, Buffer.from(`voice-${scene.index}`));
        voices.push({ sceneIndex: scene.index, src: path, durationSec: 1.25, text: scene.narration });
      }
      return voices;
    },
    async createPreviews(input) {
      calls.push('preview');
      fail('preview');
      const compositions: HtmlVideoCompositionSnapshot[] = [];
      for (const scene of input.scenes) {
        const htmlPath = join(workDir, `scene-${scene.index}.html`);
        await writeFile(htmlPath, `<html>${scene.title}</html>`, 'utf8');
        const voice = input.voices.find((item) => item.sceneIndex === scene.index)!;
        const background = input.assets.find((item) => item.sceneIndex === scene.index && item.kind === 'bg')!;
        compositions.push({
          index: scene.index,
          durationSec: voice.durationSec,
          canvas: { w: 320, h: 568 },
          audio: { src: voice.src, durationSec: voice.durationSec },
          background: { src: background.src },
          captions: scene.captions.map((text, index) => ({
            id: `${scene.index}-${index}`,
            text,
            startSec: 0,
            durationSec: voice.durationSec,
          })),
          htmlPath,
          rev: 1,
        });
      }
      return { compositions };
    },
    async render(input) {
      calls.push('render');
      fail('render');
      expect(input.compositions).toHaveLength(input.scenes.length);
      const path = join(workDir, 'final.mp4');
      await writeFile(path, Buffer.from('fake-mp4-output'));
      return { path, sizeBytes: 0, durationSec: input.voices.reduce((total, voice) => total + voice.durationSec, 0) };
    },
    async onCheckpoint(state) {
      checkpoints.push(structuredClone(state));
    },
  };
  return { calls, checkpoints, options };
}

function buildTestScenes(segments: string[]): HtmlVideoScenePlan[] {
  return segments.map((narration, index) => ({
    index: index + 1,
    narration,
    title: `场景 ${index + 1}`,
    captions: [narration],
    sceneTemplate: 'cinematic-title',
    background: { prompt: `${narration} 背景` },
    elements: [{ slot: 0, prompt: `${narration} 前景` }],
  }));
}

function splitTestText(text: string): string[] {
  return text.split(/\n{2,}|(?<=[。！？!?])\s*/u).map((item) => item.trim()).filter(Boolean);
}

async function readCheckpoint(workDir: string): Promise<HtmlVideoPipelineDataV2> {
  return parseHtmlVideoPipelineData(await readFile(join(workDir, 'html-video-pipeline.v2.json'), 'utf8'));
}

async function withTempRunner(run: (workDir: string) => Promise<void>): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'storydream-html-video-runner-'));
  try {
    await mkdir(workDir, { recursive: true });
    await run(workDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
