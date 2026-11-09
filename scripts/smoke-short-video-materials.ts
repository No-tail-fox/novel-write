/** Actual media + Electron render; engineering fixtures, never AI quality acceptance. */
import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { bindShortVideoMaterials, allocateShortVideoMaterials } from '../src/shared/short-video-material-runtime';
import { loadPixelleCatalog, preparePixelleTaskOutputs } from '../src/shared/pixelle-render';
import { prepareShortVideoOutputs, renderShortVideo } from '../electron/short-video-renderer';
import { writeJianyingDraft, type WriteJianyingDraftInput } from '../src/shared/draft';
import { executeTaskOutputs, outputFingerprint } from '../src/shared/task-output-runner';
import { getTemplate } from '../src/shared/templates';
import { FileDatabase } from '../src/shared/storage';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
const root = resolve('.'), work = join(root, '.artifacts/short-video-materials-smoke');
const python = join(root, 'vendor/python/python.exe'), exec = promisify(execFile);
const results: unknown[] = [];
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
    const voice = join(work, 'voice.wav');
    await media(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.4:sample_rate=48000', voice]);
    const host = { appRoot: root, cacheDir: join(work, 'cache') }, catalog = await loadPixelleCatalog(host);
    for (const name of ['ordinary-cover', 'ordinary-contain', 'video_default.html', 'asset_default.html']) {
      const caseDir = join(work, name); await mkdir(caseDir, { recursive: true });
      const files = [join(caseDir, 'external-long.mp4'), join(caseDir, 'external-short.mp4')];
      for (let i = 0; i < files.length; i++) await media(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=1200:sample_rate=48000', '-t', i ? '0.5' : '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', files[i]]);
      let normalizations = 0;
      const normalize = async (source: string, output: string, signal?: AbortSignal) => {
        normalizations++;
        const probe = await runStoryboundMediaSidecar({ mode: 'normalize_scene_video', work_dir: caseDir, video_path: source, output_path: output, preserve_audio: false, require_nonblack: true }, { signal });
        assert(probe.has_video && probe.has_nonblack_video); assert(!probe.has_audio);
        return { width: Number(probe.width), height: Number(probe.height), durationMs: Math.round(Number(probe.duration) * 1000) };
      };
      const fit = name === 'ordinary-contain' ? 'contain' as const : 'cover' as const;
      const descriptor = catalog.templates.find(t => t.ref.path === '1080x1920/' + name);
      const task = await db.createTask({ inputText: '本地素材混剪工程实测', shortVideoMaterials: { files, fit }, outputTargets: ['mp4', 'jianying-draft'], ratio: '9:16', ...(descriptor ? { visualTemplateRef: descriptor.ref, pixelleOptions: { mediaKind: 'video' as const, subtitleMode: 'timed-overlay' as const, padStrategy: 'freeze' as const } } : {}) });
      const imported = await bindShortVideoMaterials(task.shortVideoMaterials!, caseDir, { normalize });
      assert.equal(imported.assets.length, 2); assert.equal(normalizations, 2);
      await db.updateTask(task.id, { shortVideoMaterials: imported.settings });
      // Only delete fixtures created by this script, never user assets.
      for (const path of files) await rm(path);
      await db.close(); db = await FileDatabase.open(join(work, 'fixture.sqlite'));
      const restoredTask = (await db.getState()).tasks.find(t => t.id === task.id)!;
      const mtimes = await Promise.all(imported.settings.files.map(async p => (await stat(p)).mtimeMs));
      const resumed = await bindShortVideoMaterials(restoredTask.shortVideoMaterials!, caseDir, { normalize });
      assert.equal(normalizations, 2); assert.deepEqual(resumed, imported);
      assert.deepEqual(await Promise.all(resumed.settings.files.map(async p => (await stat(p)).mtimeMs)), mtimes);
      const template = structuredClone(getTemplate('default-portrait-9-16'));
      Object.assign(template.image, { visible: true, left: 0, top: 0, width: 1, height: 1, motion: '', animation: '', mediaScale: 1 });
      template.title.visible = false; template.subtitle.visible = false; template.frame.enabled = false; template.disclaimer.visible = false;
      const base: WriteJianyingDraftInput = {
        workDir: caseDir, draftRootDir: join(work, 'drafts'), title: name,
        cover: { title: '素材混剪实测', subtitle: [], summary: '', tags: [], comments: [] }, ratio: '9:16', template,
        reviewedText: '第一镜头。第二镜头。第三镜头。', rewrittenCopy: '第一镜头。第二镜头。第三镜头。',
        scenes: [1, 2, 3].map(id => ({ id, cap: `镜头${id}，程序配音字幕。`, descPrompt: '', durationMs: 1200 })), imagePrompts: [], generatedImages: [],
        narrationAudio: [1, 2, 3].map(sceneId => ({ sceneId, path: voice, captionCues: [{ text: `镜头${sceneId}，程序配音字幕。`, startSec: 0, endSec: 1.4, source: 'tts' as const, confidence: 1 }] })), bgm: null,
      };
      let input = await prepareShortVideoOutputs(base);
      input.generatedVideos = allocateShortVideoMaterials(input.scenes, resumed.assets, fit);
      assert.deepEqual(input.generatedVideos.map(v => v.trimStartMs), [0, 0, 1400]);
      assert(input.scenes.every(s => s.durationMs === 1400));
      if (descriptor) input = await preparePixelleTaskOutputs(input, restoredTask, descriptor, host);
      const fingerprint = await outputFingerprint(input, [voice, ...input.generatedVideos!.map(v => v.path)]);
      let calls = 0;
      const produce = async (target: 'mp4' | 'jianying-draft') => { calls++; return target === 'mp4' ? renderShortVideo(input) : (await writeJianyingDraft(input)).draftDir; };
      const outputs = await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint, produce, onUpdate: async value => writeFile(join(caseDir, 'deliveries.json'), JSON.stringify(value, null, 2)) });
      await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint, produce, previous: outputs, onUpdate: async () => {} });
      assert.equal(calls, 2);
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: caseDir, media_path: outputs.mp4!.path!, require_nonblack: true });
      assert(probe.has_audio && probe.has_video); assert.equal(probe.width, 1080); assert.equal(probe.height, 1920); assert(Math.abs(probe.duration! * 1000 - 4200) <= 150);
      const content = JSON.parse(await readFile(join(outputs['jianying-draft']!.path!, 'draft_content.json'), 'utf8'));
      assert.equal(content.duration, 4200000);
      const videoIds = new Set(content.materials.videos.filter((m: {type: string}) => m.type === 'video').map((m: {id: string}) => m.id));
      const segments = content.tracks.flatMap((t: {segments: any[]}) => t.segments).filter((s: any) => videoIds.has(s.material_id));
      assert.equal(segments.length, 3); assert(segments.every((s: any) => s.volume === 0));
      assert.deepEqual(segments.map((s: any) => s.target_timerange), [0, 1, 2].map(i => ({ start: i * 1400000, duration: 1400000 })));
      if (!descriptor) {
        assert.equal(segments[2].source_timerange.start, 1400000);
        assert(Math.abs(segments[1].speed - .5 / 1.4) < .001, 'short material slowdown must match narration');
      }
      const captions = content.tracks.find((t: any) => t.name === 'subtitles');
      assert.deepEqual(captions.segments.map((s: any) => s.target_timerange), input.subtitles!.cues.map(c => ({ start: c.startMs * 1000, duration: (c.endMs - c.startMs) * 1000 })));
      const check = `import av,numpy as np,sys,json
with av.open(sys.argv[1]) as c:
 frames=list(c.decode(audio=0)); sr=frames[0].sample_rate; a=np.concatenate([f.to_ndarray().mean(axis=0) for f in frames]); a=a[int(sr*.2):int(sr*.9)]; spec=abs(np.fft.rfft(a*np.hanning(len(a)))); freq=np.fft.rfftfreq(len(a),1/sr); amplitude=lambda hz: float(spec[abs(freq-hz)<8].max()); voice=amplitude(440); original=amplitude(1200)
with av.open(sys.argv[1]) as c:
 v=[f.reformat(width=180,height=320).to_ndarray(format='rgb24').astype(float) for f in c.decode(video=0)]
 diffs=[float(np.mean(abs(v[int(t*24)]-v[int((t+.2)*24)]))) for t in [.2,1.5,3.0]]
print(json.dumps({'voice':voice,'sourceTone':original,'motionDiffs':diffs}))`;
      const checks = JSON.parse((await exec(python, ['-c', check, outputs.mp4!.path!], { windowsHide: true })).stdout);
      assert(checks.voice > 1 && checks.sourceTone < checks.voice * .03, 'original audio must not leak or double-mix');
      assert(checks.motionDiffs.every((d: number) => d > .1), 'each scene must contain moving footage');
      await media(['-ss', '0.25', '-i', outputs.mp4!.path!, '-frames:v', '1', join(caseDir, 'frame.png')]);
      results.push({ name, outputs, probe, checks, poolSurvivesRestartWithoutSources: true, normalizations, cachedDeliveries: true });
      await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'in-progress', results }, null, 2));
      console.log('PASS', name, JSON.stringify(checks));
    }
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'passed', results, paidRequests: 0, fixture: 'engineering tests only; not AI quality acceptance; Jianying application not opened' }, null, 2));
    await db.close(); keep.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'failed', error: error instanceof Error ? error.stack : String(error), results }, null, 2));
    console.error(error); await db?.close(); keep.destroy(); app.exit(1);
  }
});
