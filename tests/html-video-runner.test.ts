import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  runHtmlVideoPipeline,
  type HtmlVideoRewriteOutput,
  type HtmlVideoRunnerInput,
  type HtmlVideoRunnerOptions,
} from '@shared/html-video-runner';
import {
  MAX_HTML_VIDEO_PIPELINE_JSON_CHARS,
  MAX_HTML_VIDEO_PIPELINE_FILE_BYTES,
  MAX_HTML_VIDEO_SOURCE_CHARS,
  MAX_HTML_VIDEO_SCENES,
  createHtmlVideoPipelineData,
  htmlVideoVisibleSteps,
  parseHtmlVideoPipelineData,
} from '@shared/html-video-workflow';
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

  it('keeps every exact-cap NUL artifact and checkpoint below the pipeline JSON limit', async () => {
    await withTempRunner(async (workDir) => {
      const sourceText = '\0'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS);
      const runtime = createFakeRuntime(workDir);
      delete runtime.options.rewrite;
      delete runtime.options.plan;
      const generateAssets = runtime.options.generateAssets;
      runtime.options.generateAssets = async (assetInput) => {
        const assets = await generateAssets(assetInput);
        return assets.map((asset) => {
          const scene = assetInput.scenes.find((item) => item.index === asset.sceneIndex)!;
          const prompt = asset.kind === 'bg'
            ? scene.background.prompt
            : scene.elements.find((element) => element.slot === asset.slot)!.prompt;
          return { ...asset, prompt };
        });
      };

      const result = await runHtmlVideoPipeline(createRunnerInput('exact-cap-nul', sourceText), runtime.options);

      expect(result.current).toBe('done');
      for (const checkpoint of runtime.checkpoints) {
        expect(JSON.stringify(checkpoint).length).toBeLessThan(MAX_HTML_VIDEO_PIPELINE_JSON_CHARS);
      }
      for (const step of htmlVideoVisibleSteps) {
        expect((await readFile(join(workDir, 'steps', `${step}.json`), 'utf8')).length)
          .toBeLessThan(MAX_HTML_VIDEO_PIPELINE_JSON_CHARS);
      }
      expect((await readFile(join(workDir, 'html-video-pipeline.v2.json'), 'utf8')).length)
        .toBeLessThan(MAX_HTML_VIDEO_PIPELINE_JSON_CHARS);
      expect(result.assets.some((asset) => Boolean(asset.prompt))).toBe(true);
      expect(result.voices.some((voice) => Boolean(voice.text))).toBe(true);
      expect(result.compositions[0].captions[0].text).toBe(sourceText);
    });
  });

  it('rejects an oversized deterministic source before splitting or checkpointing it', async () => {
    await withTempRunner(async (workDir) => {
      const sourceText = 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1);
      const input = createRunnerInput('oversized-source');
      input.sourceText = sourceText;
      const runtime = createFakeRuntime(workDir);
      delete runtime.options.rewrite;
      delete runtime.options.plan;
      let sourceSplit = false;
      const nativeSplit = RegExp.prototype[Symbol.split];
      const splitSpy = vi.spyOn(RegExp.prototype, Symbol.split).mockImplementation(function (
        this: RegExp,
        value: string,
        limit?: number,
      ) {
        if (value === sourceText && limit === undefined) {
          sourceSplit = true;
          throw new Error('unbounded source split');
        }
        return nativeSplit.call(this, value, limit);
      });

      try {
        await expect(runHtmlVideoPipeline(input, runtime.options)).rejects.toThrow(/source|16|large|long/i);
      } finally {
        splitSpy.mockRestore();
      }

      expect(sourceSplit).toBe(false);
      expect(existsSync(join(workDir, 'html-video-pipeline.v2.json'))).toBe(false);
      expect(runtime.calls).toEqual([]);
    });
  });

  it('bounds delimiter-heavy deterministic rewrite segments and continues planning', async () => {
    await withTempRunner(async (workDir) => {
      const sourceText = 'a;'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS / 2);
      const input = createRunnerInput('bounded-source');
      input.sourceText = sourceText;
      input.state.config.maxScenes = MAX_HTML_VIDEO_SCENES;
      const runtime = createFakeRuntime(workDir);
      delete runtime.options.rewrite;
      let planningSegments: string[] | undefined;
      runtime.options.plan = async (planningInput) => {
        planningSegments = planningInput.segments;
        return { scenes: buildTestScenes(['合并后的场景。']) };
      };
      let sourceSplit = false;
      const nativeSplit = RegExp.prototype[Symbol.split];
      const splitSpy = vi.spyOn(RegExp.prototype, Symbol.split).mockImplementation(function (
        this: RegExp,
        value: string,
        limit?: number,
      ) {
        if (value === sourceText && limit === undefined) {
          sourceSplit = true;
          throw new Error('unbounded source split');
        }
        return nativeSplit.call(this, value, limit);
      });

      try {
        await expect(runHtmlVideoPipeline(input, runtime.options)).resolves.toMatchObject({ current: 'done' });
      } finally {
        splitSpy.mockRestore();
      }

      expect(sourceSplit).toBe(false);
      expect(planningSegments).toHaveLength(MAX_HTML_VIDEO_SCENES);
      expect(planningSegments?.join('')).toBe(sourceText);
      const rewriteArtifact = JSON.parse(await readFile(join(workDir, 'steps', 'rewrite.json'), 'utf8')) as HtmlVideoRewriteOutput;
      expect(rewriteArtifact.rewrittenText).toBe(sourceText);
      expect(rewriteArtifact.segments).toEqual(planningSegments);
    });
  });

  it.each([
    { label: 'the shared hard limit', maxScenes: undefined, segmentCount: 31 },
    { label: 'the configured scene limit', maxScenes: 8, segmentCount: 9 },
  ])('rejects LLM rewrite segments above $label before reading their items', async ({ maxScenes, segmentCount }) => {
    await withTempRunner(async (workDir) => {
      const input = createRunnerInput(`rewrite-segments-${segmentCount}`);
      if (maxScenes !== undefined) input.state.config.maxScenes = maxScenes;
      const runtime = createFakeRuntime(workDir);
      let segmentAccessed = false;
      let planningCalled = false;
      const segments = new Array<string>(segmentCount);
      Object.defineProperty(segments, 0, {
        get() {
          segmentAccessed = true;
          throw new Error('rewrite segment was accessed');
        },
      });
      runtime.options.rewrite = async () => ({ rewrittenText: '合法改写。', segments });
      runtime.options.plan = async () => {
        planningCalled = true;
        return { scenes: buildTestScenes(['不应规划。']) };
      };

      await expect(runHtmlVideoPipeline(input, runtime.options)).rejects.toThrow(/rewrite/i);

      expect(segmentAccessed).toBe(false);
      expect(planningCalled).toBe(false);
      expect(existsSync(join(workDir, 'steps', 'rewrite.json'))).toBe(false);
    });
  });

  it('rejects oversized LLM rewritten text before reading segments', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      let segmentAccessed = false;
      const segments = new Array<string>(1);
      Object.defineProperty(segments, 0, {
        get() {
          segmentAccessed = true;
          throw new Error('rewrite segment was accessed');
        },
      });
      runtime.options.rewrite = async () => ({ rewrittenText: 'x'.repeat(MAX_HTML_VIDEO_SOURCE_CHARS + 1), segments });

      await expect(runHtmlVideoPipeline(createRunnerInput('oversized-rewrite'), runtime.options)).rejects.toThrow(/rewrite/i);

      expect(segmentAccessed).toBe(false);
      expect(existsSync(join(workDir, 'steps', 'rewrite.json'))).toBe(false);
    });
  });

  it('rejects LLM rewrite segments whose combined text exceeds the source limit', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      let planningCalled = false;
      runtime.options.rewrite = async () => ({
        rewrittenText: '合法改写。',
        segments: ['a'.repeat(20_000), 'b'.repeat(12_769)],
      });
      runtime.options.plan = async () => {
        planningCalled = true;
        return { scenes: buildTestScenes(['不应规划。']) };
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('rewrite-total'), runtime.options)).rejects.toThrow(/rewrite/i);

      expect(planningCalled).toBe(false);
      expect(existsSync(join(workDir, 'steps', 'rewrite.json'))).toBe(false);
    });
  });

  it('keeps legal LLM rewrite segments and passes them to planning', async () => {
    await withTempRunner(async (workDir) => {
      const segments = Array.from({ length: MAX_HTML_VIDEO_SCENES }, (_, index) => `片段 ${index + 1}。`);
      const input = createRunnerInput('legal-rewrite');
      input.state.config.maxScenes = MAX_HTML_VIDEO_SCENES;
      const runtime = createFakeRuntime(workDir);
      let planningSegments: string[] | undefined;
      runtime.options.rewrite = async () => ({ rewrittenText: segments.join(''), segments });
      runtime.options.plan = async (planningInput) => {
        planningSegments = planningInput.segments;
        return { scenes: buildTestScenes(['合法规划。']) };
      };

      await expect(runHtmlVideoPipeline(input, runtime.options)).resolves.toMatchObject({ current: 'done' });

      expect(planningSegments).toEqual(segments);
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

  it('rejects more than 30 LLM-planned scenes before calling the asset provider', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      let assetProviderCalled = false;
      runtime.options.plan = async () => ({
        scenes: buildTestScenes(Array.from({ length: 31 }, (_, index) => `场景 ${index + 1}。`)),
      });
      runtime.options.generateAssets = async () => {
        assetProviderCalled = true;
        return [];
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('too-many-scenes'), runtime.options))
        .rejects.toThrow(/planning/i);

      expect(assetProviderCalled).toBe(false);
      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint.current).toBe('planning');
      expect(checkpoint.steps.planning.status).toBe('failed');
      expect(checkpoint.steps.assets.status).toBe('pending');
    });
  });

  it('rejects LLM-planned scenes above configured maxScenes before calling the asset provider', async () => {
    await withTempRunner(async (workDir) => {
      const input = createRunnerInput('configured-scene-limit');
      input.state.config.maxScenes = 8;
      const runtime = createFakeRuntime(workDir);
      let assetProviderCalled = false;
      runtime.options.plan = async () => ({
        scenes: buildTestScenes(Array.from({ length: 9 }, (_, index) => `场景 ${index + 1}。`)),
      });
      runtime.options.generateAssets = async () => {
        assetProviderCalled = true;
        return [];
      };

      await expect(runHtmlVideoPipeline(input, runtime.options)).rejects.toThrow(/planning/i);

      expect(assetProviderCalled).toBe(false);
      const checkpoint = await readCheckpoint(workDir);
      expect(checkpoint.current).toBe('planning');
      expect(checkpoint.steps.assets.status).toBe('pending');
    });
  });

  it('rejects oversized scene elements before reading them or calling the asset provider', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      const scene = buildTestScenes(['元素上限。'])[0];
      let elementAccessed = false;
      let assetProviderCalled = false;
      const elements = new Array<HtmlVideoScenePlan['elements'][number]>(5_000);
      Object.defineProperty(elements, 0, {
        get() {
          elementAccessed = true;
          throw new Error('scene element was accessed');
        },
      });
      scene.elements = elements;
      runtime.options.plan = async () => ({ scenes: [scene] });
      runtime.options.generateAssets = async () => {
        assetProviderCalled = true;
        return [];
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('too-many-elements'), runtime.options))
        .rejects.toThrow(/planning/i);

      expect(elementAccessed).toBe(false);
      expect(assetProviderCalled).toBe(false);
      expect(existsSync(join(workDir, 'steps', 'planning.json'))).toBe(false);
    });
  });

  it('rejects oversized scene captions before reading them or calling the asset provider', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      const scene = buildTestScenes(['字幕上限。'])[0];
      let captionAccessed = false;
      let assetProviderCalled = false;
      const captions = new Array<string>(80_000);
      Object.defineProperty(captions, 0, {
        get() {
          captionAccessed = true;
          throw new Error('scene caption was accessed');
        },
      });
      scene.captions = captions;
      runtime.options.plan = async () => ({ scenes: [scene] });
      runtime.options.generateAssets = async () => {
        assetProviderCalled = true;
        return [];
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('too-many-captions'), runtime.options))
        .rejects.toThrow(/planning/i);

      expect(captionAccessed).toBe(false);
      expect(assetProviderCalled).toBe(false);
      expect(existsSync(join(workDir, 'steps', 'planning.json'))).toBe(false);
    });
  });

  it('rejects aggregate planning text before calling the asset provider', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      const text = 'x'.repeat(15_000);
      const scene = buildTestScenes(['聚合上限。'])[0];
      scene.narration = text;
      scene.title = text;
      scene.captions = [text];
      scene.background.prompt = text;
      scene.elements[0].prompt = text;
      let assetProviderCalled = false;
      runtime.options.plan = async () => ({ scenes: [scene] });
      runtime.options.generateAssets = async () => {
        assetProviderCalled = true;
        return [];
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('planning-text-budget'), runtime.options))
        .rejects.toThrow(/planning/i);

      expect(assetProviderCalled).toBe(false);
      expect(existsSync(join(workDir, 'steps', 'planning.json'))).toBe(false);
    });
  });

  it('rejects oversized raw assets before item access or voice provider calls', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      let itemAccessed = false;
      let voiceCalls = 0;
      const assets = new Array<HtmlVideoAsset>(3);
      Object.defineProperty(assets, 0, {
        get() {
          itemAccessed = true;
          throw new Error('asset item accessed');
        },
      });
      runtime.options.generateAssets = async () => assets;
      runtime.options.synthesizeVoices = async () => {
        voiceCalls += 1;
        return [];
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('raw-assets-limit'), runtime.options)).rejects.toThrow(/assets/i);
      expect(itemAccessed).toBe(false);
      expect(voiceCalls).toBe(0);
    });
  });

  it('rejects oversized raw voices before item access or preview calls', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      let itemAccessed = false;
      let previewCalls = 0;
      const voices = new Array<HtmlVideoVoiceClip>(3);
      Object.defineProperty(voices, 0, {
        get() {
          itemAccessed = true;
          throw new Error('voice item accessed');
        },
      });
      runtime.options.synthesizeVoices = async () => voices;
      runtime.options.createPreviews = async () => {
        previewCalls += 1;
        return { compositions: [] };
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('raw-voices-limit'), runtime.options)).rejects.toThrow(/voice/i);
      expect(itemAccessed).toBe(false);
      expect(previewCalls).toBe(0);
    });
  });

  it('rejects oversized raw compositions before item access or render calls', async () => {
    await withTempRunner(async (workDir) => {
      const runtime = createFakeRuntime(workDir);
      let itemAccessed = false;
      let renderCalls = 0;
      const compositions = new Array<HtmlVideoCompositionSnapshot>(3);
      Object.defineProperty(compositions, 0, {
        get() {
          itemAccessed = true;
          throw new Error('composition item accessed');
        },
      });
      runtime.options.createPreviews = async () => ({ compositions });
      runtime.options.render = async () => {
        renderCalls += 1;
        throw new Error('render called');
      };

      await expect(runHtmlVideoPipeline(createRunnerInput('raw-compositions-limit'), runtime.options)).rejects.toThrow(/preview/i);
      expect(itemAccessed).toBe(false);
      expect(renderCalls).toBe(0);
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

  it('falls back to the supplied state when the disk checkpoint is invalid', async () => {
    const invalidCheckpoints = [
      '{',
      JSON.stringify({ version: 99 }),
      JSON.stringify({ padding: 'x'.repeat(1_000_001) }),
    ];
    for (const [index, checkpoint] of invalidCheckpoints.entries()) {
      await withTempRunner(async (workDir) => {
        await writeFile(join(workDir, 'html-video-pipeline.v2.json'), checkpoint, 'utf8');
        const runtime = createFakeRuntime(workDir);
        const input = createRunnerInput(`invalid-checkpoint-${index}`);
        input.state.config = { ...input.state.config, foreground: false, style: 'recovered-style' };

        await expect(runHtmlVideoPipeline(input, runtime.options)).resolves.toMatchObject({
          current: 'done',
          config: { foreground: false, style: 'recovered-style' },
        });
      });
    }
  });

  it('falls back without parsing a checkpoint above the shared file-byte limit', async () => {
    await withTempRunner(async (workDir) => {
      await writeFile(
        join(workDir, 'html-video-pipeline.v2.json'),
        Buffer.alloc(MAX_HTML_VIDEO_PIPELINE_FILE_BYTES + 1, 0x20),
      );
      const runtime = createFakeRuntime(workDir);

      const result = await runHtmlVideoPipeline(createRunnerInput('oversized-checkpoint'), runtime.options);

      expect(result.current).toBe('done');
      expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/checkpoint.*损坏|数据库快照/u)]));
    });
  });

  it('rejects a replaced oversized step artifact before parsing and reruns from that step', async () => {
    await withTempRunner(async (workDir) => {
      const initial = createFakeRuntime(workDir);
      const completed = await runHtmlVideoPipeline(createRunnerInput('replaced-step-artifact'), initial.options);
      const rewritePath = completed.steps.rewrite.artifactPath;
      expect(rewritePath).toBeTruthy();
      await writeFile(
        join(workDir, rewritePath!),
        Buffer.alloc(MAX_HTML_VIDEO_PIPELINE_FILE_BYTES + 1, 0x20),
      );

      const resumed = createFakeRuntime(workDir);
      const result = await runHtmlVideoPipeline(createRunnerInput('replaced-step-artifact'), resumed.options);

      expect(result.current).toBe('done');
      expect(resumed.calls).toEqual([...htmlVideoVisibleSteps]);
    });
  });

  it('ignores an old valid disk checkpoint when retry recovery selected a new authoritative state', async () => {
    await withTempRunner(async (workDir) => {
      const oldCheckpoint = createHtmlVideoPipelineData('旧快照。', {
        foreground: true,
        style: 'old-style',
      });
      await writeFile(join(workDir, 'html-video-pipeline.v2.json'), JSON.stringify(oldCheckpoint), 'utf8');
      const runtime = createFakeRuntime(workDir);
      const input = createRunnerInput('recovered-authority');
      input.state.config = { ...input.state.config, foreground: false, style: 'recovered-style' };
      const recoveredInput = { ...input, ignoreCheckpoint: true } as HtmlVideoRunnerInput & { ignoreCheckpoint: boolean };

      const result = await runHtmlVideoPipeline(recoveredInput, runtime.options);

      expect(result.config).toMatchObject({ foreground: false, style: 'recovered-style' });
      expect(result.scenes.some((scene) => scene.narration === '旧快照。')).toBe(false);
      expect(result.assets.some((asset) => asset.kind === 'fg')).toBe(false);
    });
  });

  it('atomically publishes a recovered checkpoint before later preflight work can fail', async () => {
    await withTempRunner(async (workDir) => {
      const runnerModule = await import('@shared/html-video-runner') as Record<string, unknown>;
      const synchronize = runnerModule.synchronizeHtmlVideoPipelineCheckpoint;
      expect(synchronize).toBeTypeOf('function');
      if (typeof synchronize !== 'function') return;
      const oldCheckpoint = createHtmlVideoPipelineData('旧快照。', { style: 'old-style' });
      await writeFile(join(workDir, 'html-video-pipeline.v2.json'), JSON.stringify(oldCheckpoint), 'utf8');
      const input = createRunnerInput('published-recovery');
      input.state.config = { ...input.state.config, style: 'recovered-style', foreground: false };

      await (synchronize as (path: string, state: HtmlVideoPipelineDataV2) => Promise<void>)(workDir, input.state);
      const runtime = createFakeRuntime(workDir);
      const result = await runHtmlVideoPipeline(input, runtime.options);

      expect(result.config).toMatchObject({ style: 'recovered-style', foreground: false });
      expect(result.scenes.some((scene) => scene.narration === '旧快照。')).toBe(false);
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
