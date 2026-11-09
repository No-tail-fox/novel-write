import { app, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { prepareShortVideoOutputs, renderShortVideo } from '../electron/short-video-renderer';
import { writeJianyingDraft, type WriteJianyingDraftInput } from '../src/shared/draft';
import { executeTaskOutputs, outputFingerprint } from '../src/shared/task-output-runner';
import { getTemplate } from '../src/shared/templates';
import type { TaskOutputTarget } from '../src/shared/types';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { prepareQaNarration } from './qa-animation-media';

const root = resolve(process.cwd());
const work = resolve(process.env.SHORT_VIDEO_QA_WORK || join(root, '.artifacts/short-video-dual-output-smoke'));
const exec = promisify(execFile);
const results: unknown[] = [];
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('did-finish-load', () => { console.log('loaded', window.webContents.getURL()); });
  window.webContents.on('console-message', (_event, details) => console.log('renderer', details));
});
app.disableHardwareAcceleration(); app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const keep = new BrowserWindow({ show: false });
  try {
    await mkdir(work, { recursive: true });
    const ffmpeg = (await exec(join(root, 'vendor/python/python.exe'), ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
    async function media(args: string[]) { await exec(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { windowsHide: true, timeout: 120000 }); }
    const image = join(work, 'still.png'), clip = join(work, 'source.mp4'), music = join(work, 'music.wav');
    await media(['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-frames:v', '1', image]);
    await media(['-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30', '-t', '2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip]);
    await media(['-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=2', music]);
    const lines = [['第一镜，图片与字幕。'], ['第二镜，视频与配音。']];
    const voices = await prepareQaNarration(join(work, 'voices'), lines);
    const template = structuredClone(getTemplate('default-portrait-9-16'));
    // A fixed local engineering fixture; no user project or generated sample is altered.
    template.audio.transitionType = 'none';
    const base: WriteJianyingDraftInput = {
      workDir: work, draftRootDir: join(work, 'drafts'), title: '短片双输出实测',
      cover: { title: '短片双输出实测', subtitle: ['同一素材 · 同一时间轴'], summary: '本地工程验收', tags: [], comments: [] },
      ratio: '9:16', template, reviewedText: lines.flat().join(''), rewrittenCopy: lines.flat().join(''),
      scenes: lines.map((line, index) => ({ id: index + 1, cap: line.join(''), descPrompt: 'local verification', durationMs: 500 })),
      imagePrompts: [], generatedImages: [{ sceneId: 1, path: image }],
      generatedVideos: [{ sceneId: 2, path: clip, source: 'local-upload', originalName: 'source.mp4', durationMs: 2000, width: 720, height: 1280, trimStartMs: 500, fit: 'cover', muted: true }],
      narrationAudio: voices.map((voice, index) => ({ sceneId: index + 1, path: voice.path, captionCues: voice.captionCues })),
      coverImagePath: image, coverPage: { imagePath: image, text: '工程测试', durationMs: 500 },
      bgm: { id: 'qa', title: 'local tone', path: music, durationMs: 2000, volume: .1 },
    };
    for (const targets of [['mp4'], ['jianying-draft'], ['mp4', 'jianying-draft']] as TaskOutputTarget[][]) {
      const input = await prepareShortVideoOutputs({ ...base, workDir: join(work, targets.join('-')), title: `短片测试-${targets.join('-')}` });
      const fingerprint = await outputFingerprint(input, [image, clip, music, ...voices.map(v => v.path)]);
      let calls = 0;
      const produce = async (target: TaskOutputTarget) => { calls++; return target === 'mp4' ? renderShortVideo(input) : (await writeJianyingDraft(input)).draftDir; };
      const outputs = await executeTaskOutputs({ targets, fingerprint, produce, onUpdate: async value => { await mkdir(input.workDir, { recursive: true }); await writeFile(join(input.workDir, 'deliveries.json'), JSON.stringify(value, null, 2), 'utf8'); } });
      assert.equal(calls, targets.length);
      await executeTaskOutputs({ targets, fingerprint, previous: outputs, produce, onUpdate: async () => {} });
      assert.equal(calls, targets.length, 'unchanged outputs must not be regenerated');
      const expectedMs = 500 + input.scenes.reduce((s, scene) => s + scene.durationMs, 0);
      assert(input.scenes.every(scene => scene.durationMs > 500), 'measured narration must extend estimated scenes');
      let probe;
      if (outputs.mp4?.path) {
        probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: input.workDir, media_path: outputs.mp4.path, require_nonblack: true });
        assert(probe.has_audio && probe.has_video);
        assert(Math.abs(probe.duration! * 1000 - expectedMs) <= 150);
        await media(['-i', outputs.mp4.path, '-vf', 'select=eq(n\\,40)', '-frames:v', '1', join(input.workDir, 'frame.png')]);
      }
      let tracks;
      if (outputs['jianying-draft']?.path) {
        const content = JSON.parse(await readFile(join(outputs['jianying-draft'].path, 'draft_content.json'), 'utf8'));
        tracks = content.tracks.map((track: { type: string; segments: unknown[] }) => ({ type: track.type, segments: track.segments.length }));
        assert(tracks.some((track: { type: string }) => track.type === 'text'), 'draft needs editable text');
        const captionTrack = content.tracks.find((track: { name: string }) => track.name === 'subtitles');
        assert.deepEqual(captionTrack.segments.map((segment: { target_timerange: { start: number; duration: number } }) => segment.target_timerange),
          input.subtitles!.cues.map(cue => ({ start: (500 + cue.startMs) * 1000, duration: (cue.endMs - cue.startMs) * 1000 })),
          'editable draft captions must exactly match the shared MP4 subtitle clock, including the cover offset');
        assert(tracks.some((track: { type: string }) => track.type === 'audio'), 'draft needs independent audio');
        const musicTrack = content.tracks.find((track: { name: string }) => track.name === 'bgm');
        assert(musicTrack.segments.length > 1, 'short BGM must loop');
        const musicEnd = musicTrack.segments.at(-1).target_timerange;
        assert.equal(musicEnd.start + musicEnd.duration, content.duration, 'BGM covers full timeline');
        assert(Math.abs(content.duration / 1000 - expectedMs) <= 100, 'draft and MP4 must share total duration');
      }
      results.push({ targets, expectedMs, outputs, probe, tracks, cachedRetry: true });
      console.log(JSON.stringify({ done: targets, expectedMs, tracks }));
      await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'in-progress', results }, null, 2), 'utf8');
    }
    const input = await prepareShortVideoOutputs({ ...base, workDir: join(work, 'cancelled') });
    const controller = new AbortController();
    const cancelTimer = setTimeout(() => controller.abort(new Error('Cancelled by smoke test')), 250);
    try { await assert.rejects(() => renderShortVideo(input, controller.signal)); } finally { clearTimeout(cancelTimer); }
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'passed', results, cancellation: 'passed', paidRequests: 0 }, null, 2), 'utf8');
    console.log('PASS: actual MP4 + editable draft, selection, measured timing, cache reuse and cancellation.');
    keep.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'failed', error: error instanceof Error ? error.stack : String(error), results }, null, 2), 'utf8');
    console.error(error); keep.destroy(); app.exit(1);
  }
});