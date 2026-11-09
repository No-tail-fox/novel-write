/** Exercise the five compatible fallback families with saved real assets, without providers. */
import { app, BrowserWindow } from 'electron';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { buildVoxProductionNodes, voxProductionSettings } from '../src/shared/vox-production';
import { createVoxProductionRuntime, type VoxProductionOperations } from '../electron/vox-production-runtime';
import { buildDirectorRenderScenes, type DirectorRenderScene } from '../src/shared/director-render';
import { renderDirectorVideo } from '../electron/director-renderer';
import { compileVoxCode } from '../electron/vox-animation-runtime';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { creativeStyle, CREATIVE_ADAPTER_REVISION } from '../src/shared/creative-animation/styles';

const root = resolve('.'), work = join(root, '.artifacts/creative-style-fallbacks');
await mkdir(work, { recursive: true });
app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
await app.whenReady();
app.on('window-all-closed', () => {});
const keep = new BrowserWindow({ show: false });
const persist = (name: string, value: unknown) => writeFile(join(work, name), JSON.stringify(value, null, 2), 'utf8');
try {
  const sourcePath = join(root, '.artifacts/vox-production-paper/saved-sample/document.json');
  const sourceBytes = await readFile(sourcePath, 'utf8');
  const source = parseEditorialCollagePipelineData(JSON.parse(sourceBytes));
  const sourceBeat = source.beats[0], sourceShot = sourceBeat.shots[0];
  const sourceCue = sourceBeat.subtitleCues.find(cue => sourceShot.subtitleCueIds.includes(cue.id))!;
  const durationMs = 3333;
  const never = async (): Promise<never> => { throw new Error('This regression must not call a generation provider.'); };
  const ops: VoxProductionOperations = {
    identity: 'offline-real-assets', imageModel: 'not-called', voiceModel: 'not-called',
    voice: { provider: 'volcengine', voiceId: 'not-called', voiceLabel: 'not-called', speed: 1 },
    preflight() {}, plan: never, image: never, speech: never, cutout: never,
    generateCode: never, previewCode: never, render: never, compileCode: compileVoxCode, verifyVideo: never,
  };
  const runtime = createVoxProductionRuntime(ops), scenes: DirectorRenderScene[] = [];
  const cases = ['watercolor', 'microscope', 'swiss-motion', 'glass-product', 'paper-popup'];
  for (const slug of cases) {
    const settings = { ...voxProductionSettings(), authoring: { mode: 'template' as const, styleId: slug } };
    let document = rebuildEditorialTimeline({ ...source, productionRun: undefined, productionSettings: settings, timeline: undefined,
      beats: [{ ...sourceBeat, startMs: 0, durationMs, narration: sourceCue.text,
        shots: [{ ...sourceShot, durationMs, subtitleCueIds: [sourceCue.id], cuePlan: undefined,
          layers: sourceShot.layers.map(layer => ({ ...layer, motion: layer.motion.map(key => ({ ...key, atMs: Math.round(key.atMs * durationMs / sourceShot.durationMs) })) })) }],
        subtitleCues: [{ ...sourceCue, startMs: 0, endMs: Math.min(sourceCue.endMs - sourceCue.startMs, durationMs), tokens: undefined }],
      }],
    });
    const nodes = buildVoxProductionNodes(document, settings);
    document.productionRun = { version: 1, id: `qa-${slug}`, settings, status: 'running', sourceHash: '', runtimeIdentity: ops.identity, nodes,
      createdAt: source.createdAt, updatedAt: source.updatedAt };
    const animationNode = nodes.find(node => node.kind === 'animation' && node.shotId === sourceShot.id)!;
    document = await runtime.execute(document, animationNode);
    await persist(`${slug}.json`, document);
    const scene = buildDirectorRenderScenes(document)[0];
    scenes.push({ ...scene, id: `qa-${slug}`, index: scenes.length + 1 });
  }
  console.log('Rendering five fallback families with saved real cutouts and narration; no model calls.');
  const result = await renderDirectorVideo({ workDir: work, projectTitle: '创意动画 · 五类模板实素材技术回归', modeLabel: '创意动画',
    ratio: source.ratio, scenes, animationRuntimePath: join(root, 'dist-electron/electron/vox-animation-runtime.js') });
  const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: result.outputPath, require_nonblack: true, analyze_quality: true });
  await persist('probe.json', probe);
  if (!probe.has_video || !probe.has_nonblack_video || !probe.has_audio || probe.audio_is_silent
    || Math.abs(Number(probe.duration) * 1000 - cases.length * durationMs) > 750) throw new Error(`Media gate failed: ${JSON.stringify(probe)}`);
  if (await readFile(sourcePath, 'utf8') !== sourceBytes) throw new Error('Source document changed.');
  const outputPath = join(work, 'five-fallback-families.mp4');
  await copyFile(result.outputPath, outputPath);
  await persist('report.json', { status: 'passed', adapterRevision: CREATIVE_ADAPTER_REVISION, newPaidCalls: 0,
    surface: 'production runtime animation nodes + saved real images/cutouts/narration + real browser/FFmpeg; no product IPC',
    aestheticReview: false, sourcePath, sourceUnchanged: true, result, outputPath,
    cases: scenes.map((scene, index) => ({ style: cases[index], family: creativeStyle(cases[index])!.adapter!.fallback,
      template: scene.animation!.template.id, semanticLayers: !!scene.semanticBeats, startMs: index * durationMs, durationMs })),
    limitations: ['Original paper images are reused; this does not validate new style materials or 59 aesthetic outputs.',
      'The same opening narration excerpt repeats in each technical segment.', 'No new AI-code, image, VLM or product-IPC validation.'] });
  console.log(JSON.stringify({ status: 'passed', outputPath, duration: probe.duration }));
  keep.destroy(); app.exit(0);
} catch (error) {
  await writeFile(join(work, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
  console.error(error); keep.destroy(); app.exit(1);
}
