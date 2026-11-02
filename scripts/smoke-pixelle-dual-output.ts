import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { loadPixelleCatalog, preparePixelleTaskOutputs } from '../src/shared/pixelle-render';
import { prepareShortVideoOutputs, renderShortVideo } from '../electron/short-video-renderer';
import { writeJianyingDraft, type WriteJianyingDraftInput } from '../src/shared/draft';
import { executeTaskOutputs, outputFingerprint } from '../src/shared/task-output-runner';
import { getTemplate } from '../src/shared/templates';
import { FileDatabase } from '../src/shared/storage';
import type { PixelleTaskOptions, PixelleTemplateDescriptor, PixelleTemplateValue } from '../src/shared/pixelle';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
const allTemplates = process.env.STORYDREAM_PIXELLE_ALL_TEMPLATES === '1';
const extendedCoverage = process.env.STORYDREAM_PIXELLE_EXTENDED === '1';
interface SmokeCase { descriptor: PixelleTemplateDescriptor; subtitleMode: PixelleTaskOptions['subtitleMode']; name?: string; mediaKind?: 'image' | 'video'; text?: string; parameters?: Record<string, PixelleTemplateValue> }
const root = resolve('.');
const work = process.env.STORYDREAM_PIXELLE_VALIDATION_ROOT
  ? resolve(process.env.STORYDREAM_PIXELLE_VALIDATION_ROOT, allTemplates ? 'matrix' : 'dual-output')
  : join(root, allTemplates ? '.artifacts/pixelle-all-templates-dual-output' : '.artifacts/pixelle-dual-output-smoke');
const python = join(root, 'vendor/python/python.exe'), exec = promisify(execFile);
const results: any[] = [];
app.disableHardwareAcceleration(); app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const keep = new BrowserWindow({ show: false });
  let db: FileDatabase | undefined;
  try {
    await mkdir(work, { recursive: true });
    db = await FileDatabase.open(join(work, 'fixture.sqlite'));
    const ffmpeg = (await exec(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
    async function media(args: string[]) { await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true, timeout: 120000 }); }
    const image = join(work, 'source.png'), clip = join(work, 'source.mp4'), voice = join(work, 'voice.wav');
    await media(['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24', '-t', '0.5', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip]);
    await media(['-i', clip, '-frames:v', '1', image]);
    await media(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000', voice]);
    const host = { appRoot: root, cacheDir: join(work, 'cache') };
    const catalog = await loadPixelleCatalog(host);
    const cases: SmokeCase[] = allTemplates
      ? catalog.templates.map(descriptor => ({ descriptor, subtitleMode: descriptor.type === 'video' ? 'timed-overlay' as const : descriptor.type === 'asset' ? 'off' as const : 'template' as const }))
      : ([['image_default.html', 'template'], ['video_default.html', 'timed-overlay'], ['asset_default.html', 'off']] as const).map(([file, subtitleMode]) => ({ descriptor: catalog.templates.find(t => t.ref.path === '1080x1920/' + file)!, subtitleMode }));
    if (allTemplates) assert.equal(cases.length, 31, 'every pinned original template must be exercised');
    if (extendedCoverage) {
      const descriptor = (file: string) => catalog.templates.find(t => t.ref.path === '1080x1920/' + file)!;
      cases.push(
        { name: 'asset-image-off', descriptor: descriptor('asset_default.html'), subtitleMode: 'off', mediaKind: 'image' },
        { name: 'asset-image-template', descriptor: descriptor('asset_default.html'), subtitleMode: 'template', mediaKind: 'image', text: '通用素材图片分支：保留标题、图片与模板内文字。' },
        { name: 'asset-image-timed', descriptor: descriptor('asset_default.html'), subtitleMode: 'timed-overlay', mediaKind: 'image', text: '图片分支时间轴字幕保持与配音对齐。' },
        { name: 'video-long-caption', descriptor: descriptor('video_default.html'), subtitleMode: 'timed-overlay', text: '解释每一个细节，让信息层次清楚，让观众能够理解画面中的变化。'.repeat(4), parameters: { author: '@StoryDream', describe: '参数化创作验收', brand: '字幕避让测试' } },
        { name: 'video-multiline', descriptor: descriptor('video_default.html'), subtitleMode: 'timed-overlay', text: '第一行中文信息\nSecond line with English words\n第三行节奏与转场\nFourth line readable captions', parameters: { author: '@StoryDream', describe: '四行中英字幕', brand: '组合测试' } },
        { name: 'image-long-template', descriptor: descriptor('image_default.html'), subtitleMode: 'template', text: '这是图文模板的较长说明。画面提供信息，旁白说明原因，标题突出核心观点。'.repeat(3), parameters: { author: '@StoryDream', describe: '长文参数组合', brand: '原版图文' } },
      );
    }
    for (const { descriptor, subtitleMode, name, mediaKind, text, parameters } of cases) {
      const file = descriptor.ref.path;
      const caseName = name ?? (allTemplates ? file.replaceAll('/', '-').replace('.html', '') : subtitleMode);
      const ratio = descriptor.orientation === 'landscape' ? '16:9' as const : descriptor.orientation === 'square' ? '1:1' as const : '9:16' as const;
      const video = mediaKind ? mediaKind === 'video' : descriptor.type === 'video' || descriptor.type === 'asset';
      const settings: PixelleTaskOptions = { subtitleMode, mediaKind: video ? 'video' : 'image', ...(video ? { videoPath: clip } : {}), ...(parameters ? { parameters } : {}), padStrategy: 'freeze' };
      const task = await db.createTask({ inputText: '双输出工程实测', visualTemplateRef: descriptor.ref, pixelleOptions: settings, outputTargets: ['mp4', 'jianying-draft'], ratio });
      const template = structuredClone(getTemplate('default-portrait-9-16'));
      const base: WriteJianyingDraftInput = {
        workDir: join(work, caseName), draftRootDir: join(work, 'drafts'), title: 'Pixelle-' + caseName,
        cover: { title: 'Pixelle 原版双输出', subtitle: [], summary: '', tags: [], comments: [] },
        ratio, template, reviewedText: text ?? '第一段配音。第二段配音。', rewrittenCopy: text ?? '第一段配音。第二段配音。',
        scenes: [{ id: 1, cap: text ?? '第一段配音。第二段配音。', descPrompt: '', durationMs: 2200 }], imagePrompts: [],
        generatedImages: !video && descriptor.type !== 'static' ? [{ sceneId: 1, path: image }] : [],
        narrationAudio: [0, 1].map(turnIndex => ({ sceneId: 1, turnIndex, path: voice, captionCues: [{ text: text ?? (turnIndex ? '第二段配音。' : '第一段配音。'), startSec: 0, endSec: 1, source: 'tts' as const, confidence: 1 }] })), bgm: null,
      };
      const aligned = await prepareShortVideoOutputs(base);
      const input = await preparePixelleTaskOutputs(aligned, task, descriptor, host);
      const assets = [...input.generatedImages, ...(input.generatedVideos ?? [])];
      const mtimes = await Promise.all(assets.map(async asset => (await stat(asset.path)).mtimeMs));
      const again = await preparePixelleTaskOutputs(aligned, task, descriptor, host);
      assert.deepEqual([...again.generatedImages, ...(again.generatedVideos ?? [])], assets);
      assert.deepEqual(await Promise.all(assets.map(async asset => (await stat(asset.path)).mtimeMs)), mtimes);
      if (video) assert(input.generatedVideos!.every(v => v.muted));
      const fingerprint = await outputFingerprint(input, [voice, ...assets.map(a => a.path)]);
      let calls = 0;
      const produce = async (target: 'mp4' | 'jianying-draft') => { calls++; return target === 'mp4' ? renderShortVideo(input) : (await writeJianyingDraft(input)).draftDir; };
      const outputs = await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint, produce, onUpdate: async value => writeFile(join(input.workDir, 'deliveries.json'), JSON.stringify(value, null, 2)) });
      await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint, produce, previous: outputs, onUpdate: async () => {} });
      assert.equal(calls, 2, 'retry must reuse both validated deliverables');
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: input.workDir, media_path: outputs.mp4!.path!, require_nonblack: true });
      assert(probe.has_audio && probe.has_video); assert.equal(probe.width, descriptor.width); assert.equal(probe.height, descriptor.height);
      const content = JSON.parse(await readFile(join(outputs['jianying-draft']!.path!, 'draft_content.json'), 'utf8'));
      assert(Math.abs(content.duration / 1000 - 2200) <= 100); assert(Math.abs(probe.duration! * 1000 - 2200) <= 150);
      const captions = content.tracks.find((t: any) => t.name === 'subtitles');
      if (subtitleMode === 'timed-overlay') assert.deepEqual(captions.segments.map((s: any) => s.target_timerange), input.subtitles!.cues.map(c => ({ start: c.startMs * 1000, duration: (c.endMs - c.startMs) * 1000 })));
      else assert(!content.tracks.some((t: any) => t.type === 'text' && t.segments.length), 'template/off must not get duplicated program text');
      if (video) {
        const videoIds = new Set(content.materials.videos.filter((m: any) => m.type === 'video').map((m: any) => m.id));
        const videoSegments = content.tracks.flatMap((t: any) => t.segments).filter((s: any) => videoIds.has(s.material_id));
        assert(videoSegments.length > 0 && videoSegments.every((s: any) => s.volume === 0), 'actual video materials must be muted; background photos have no audio');
      }
      await media(['-i', outputs.mp4!.path!, '-frames:v', '1', join(input.workDir, 'frame.png')]);
      const audioCheck = `import av,numpy as np,sys,json
with av.open(sys.argv[1]) as c:
 a=np.concatenate([f.to_ndarray().reshape(-1) for f in c.decode(audio=0)])
 print(json.dumps({'rms':float(np.sqrt(np.mean(a[10000:40000].astype(float)**2)))}))`;
      const audio = JSON.parse((await exec(python, ['-c', audioCheck, outputs.mp4!.path!], { windowsHide: true })).stdout);
      assert(audio.rms > 0.001, 'output narration must be audible');
      if (file === '1080x1920/video_default.html' && subtitleMode === 'timed-overlay') {
        assert.equal(input.template!.caption.y, .72, 'host subtitle stays below original branding');
        assert(input.template!.caption.fontSize >= 6, 'minimum readable size remains enforced');
      }
      results.push({ file, caseName, subtitleMode, mediaKind: settings.mediaKind, parameters, captionLayout: input.template!.caption, outputs, probe, audio, cachedRetry: true, templateCacheReused: true });
      console.log('PASS', file, subtitleMode, JSON.stringify(audio));
      await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'in-progress', results }, null, 2));
    }
    for (const result of results.slice(1)) assert(Math.abs(result.audio.rms / results[0].audio.rms - 1) < 0.08, 'video must not double-mix the embedded narration');
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'passed', results, expectedTemplates: allTemplates ? 31 : 3, extendedCases: extendedCoverage ? 6 : 0, paidRequests: 0, fixture: 'engineering test, not AI quality acceptance; Jianying application not opened' }, null, 2));
    await db.close(); keep.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'failed', error: error instanceof Error ? error.stack : String(error), results }, null, 2));
    console.error(error); await db?.close(); keep.destroy(); app.exit(1);
  }
});
