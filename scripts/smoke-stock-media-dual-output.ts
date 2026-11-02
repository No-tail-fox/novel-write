import { app, BrowserWindow } from 'electron';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { StockMediaService } from '../electron/stock-media-service';
import { bindShortVideoMaterials, allocateShortVideoMaterials } from '../src/shared/short-video-material-runtime';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { loadPixelleCatalog, preparePixelleTaskOutputs } from '../src/shared/pixelle-render';
import { prepareShortVideoOutputs, renderShortVideo } from '../electron/short-video-renderer';
import { writeJianyingDraft, type WriteJianyingDraftInput } from '../src/shared/draft';
import { executeTaskOutputs, outputFingerprint } from '../src/shared/task-output-runner';
import { getTemplate } from '../src/shared/templates';
import { FileDatabase } from '../src/shared/storage';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import type { Task } from '../src/shared/types';

const root = resolve('.'), work = resolve('.artifacts/stock-media-dual-output-20261102');
const exec = promisify(execFile);
const results: unknown[] = [];
let apiRequests = 0, mediaRequests = 0;
app.disableHardwareAcceleration(); app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root); app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const keep = new BrowserWindow({ show: false }); let db: FileDatabase | undefined;
  const server = createServer();
  try {
    await mkdir(work, { recursive: true });
    const python = join(root, 'vendor/python/python.exe');
    const ffmpeg = (await exec(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
    const clip = join(work, 'fixture-source.mp4'), voice = join(work, 'fixture-voice.wav');
    await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', clip], { windowsHide: true, timeout: 30000 });
    await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2:sample_rate=48000', voice], { windowsHide: true, timeout: 30000 });
    const bytes = await readFile(clip);
    const source = { id: 42, width: 320, height: 180, duration: 2, url: 'https://www.pexels.com/video/42/', image: 'https://images.pexels.com/videos/42/preview.jpeg', user: { name: 'Offline engineering fixture', url: 'https://www.pexels.com/@fixture/' }, video_files: [{ id: 88, width: 320, height: 180, file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/42/test.mp4' }] };
    server.on('request', (request, response) => {
      if (request.url?.startsWith('/videos/')) {
        apiRequests++; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(request.url.startsWith('/videos/search') ? { videos: [source], total_results: 1 } : source));
      } else {
        mediaRequests++; assert(!request.headers.authorization, 'API credential must not reach the media endpoint'); response.setHeader('content-type', 'video/mp4'); response.setHeader('content-length', bytes.length); response.end(bytes);
      }
    });
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const address = server.address(); assert(address && typeof address !== 'string');
    const transport: typeof fetch = (url, init) => { const parsed = new URL(String(url)); return fetch('http://127.0.0.1:' + address.port + parsed.pathname + parsed.search, init); };
    const stock = new StockMediaService({ directory: join(work, 'stock-media', crypto.randomUUID()), getApiKey: async () => 'offline-fixture-key', fetch: transport, probe: async (path, signal) => {
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: path }, { signal }); assert(probe.has_video);
      return { width: probe.width!, height: probe.height!, durationMs: probe.duration! * 1000 };
    } });
    const found = await stock.search({ operationId: crypto.randomUUID(), provider: 'pexels', type: 'video', query: 'offline motion fixture' }); assert.equal(found.items.length, 1);
    const imported = await stock.import({ operationId: crypto.randomUUID(), provider: 'pexels', mediaId: '42', variantId: '88' });
    const again = await stock.import({ operationId: crypto.randomUUID(), provider: 'pexels', mediaId: '42', variantId: '88' }); assert(again.reused); assert.equal(mediaRequests, 1);
    db = await FileDatabase.open(join(work, 'fixture.sqlite'));
    const host = { appRoot: root, cacheDir: join(work, 'pixelle-cache') };
    const catalog = await loadPixelleCatalog(host);
    const descriptor = catalog.templates.find(item => item.ref.path === '1080x1920/video_default.html'); assert(descriptor);
    for (const route of ['ordinary', 'pixelle'] as const) {
      const caseDir = join(work, route);
      const pool = await bindShortVideoMaterials({ files: [imported.path], fit: 'cover' }, caseDir, { normalize: async (path, target, signal) => {
        const probe = await runStoryboundMediaSidecar({ mode: 'normalize_scene_video', work_dir: caseDir, video_path: path, output_path: target, preserve_audio: false, require_nonblack: true }, { signal });
        assert(probe.has_video); return { width: probe.width!, height: probe.height!, durationMs: probe.duration! * 1000 };
      } });
      const task: Task = await db.createTask({ inputText: '网络素材双输出工程测试', shortVideoMaterials: pool.settings, outputTargets: ['mp4', 'jianying-draft'], ratio: '9:16', ...(route === 'pixelle' ? { visualTemplateRef: descriptor.ref, pixelleOptions: { subtitleMode: 'timed-overlay', mediaKind: 'video', padStrategy: 'freeze' } } : {}) });
      const scenes = [{ id: 1, cap: '网络素材工程验证', descPrompt: '', durationMs: 2000 }];
      const base: WriteJianyingDraftInput = { workDir: caseDir, draftRootDir: join(work, 'drafts'), title: 'Stock-media-' + route, ratio: '9:16', template: structuredClone(getTemplate('default-portrait-9-16')), cover: { title: '网络素材工程验证', subtitle: [], summary: '', tags: [], comments: [] }, reviewedText: '网络素材工程验证', rewrittenCopy: '网络素材工程验证', scenes, imagePrompts: [], generatedImages: [], generatedVideos: allocateShortVideoMaterials(scenes, pool.assets, 'cover'), narrationAudio: [{ sceneId: 1, path: voice, captionCues: [{ text: '网络素材工程验证', startSec: 0, endSec: 2, source: 'tts', confidence: 1 }] }], bgm: null };
      const aligned = await prepareShortVideoOutputs(base);
      const input: WriteJianyingDraftInput = route === 'pixelle' ? await preparePixelleTaskOutputs(aligned, task, descriptor, host) : aligned;
      assert.equal(input.generatedVideos?.[0].stockMedia?.[0].mediaId, '42');
      const fingerprint = await outputFingerprint(input, [voice, ...input.generatedVideos!.map(item => item.path)]);
      let outputCalls = 0;
      const produce = async (target: 'mp4' | 'jianying-draft') => { outputCalls++; return target === 'mp4' ? renderShortVideo(input) : (await writeJianyingDraft(input)).draftDir; };
      const outputs = await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint, produce, onUpdate: async value => { await db!.updateTask(task.id, { deliverables: value }); } });
      await executeTaskOutputs({ targets: ['mp4', 'jianying-draft'], fingerprint, produce, previous: outputs, onUpdate: async () => {} });
      assert.equal(outputCalls, 2, 'cached retry reuses both outputs'); assert.equal(mediaRequests, 1, 'ordinary and Pixelle share one managed download');
      const mp4 = outputs.mp4!.path!, draftDir = outputs['jianying-draft']!.path!;
      const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: caseDir, media_path: mp4, require_nonblack: true });
      assert(probe.has_video && probe.has_audio); assert(Math.abs(probe.duration! * 1000 - 2000) <= 150); assert.equal(probe.width, 1080); assert.equal(probe.height, 1920);
      const draft = JSON.parse(await readFile(join(draftDir, 'draft_content.json'), 'utf8')); assert(Math.abs(draft.duration / 1000 - 2000) <= 150);
      const mp4Sources = JSON.parse(await readFile(mp4 + '.sources.json', 'utf8')); const draftSources = JSON.parse(await readFile(join(draftDir, 'stock-media-sources.json'), 'utf8'));
      assert.deepEqual(mp4Sources.scenes, draftSources.scenes); assert.equal(mp4Sources.scenes[0].sources[0].contentHash, imported.provenance.contentHash);
      await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', mp4, '-frames:v', '1', join(caseDir, 'frame.png')], { windowsHide: true, timeout: 30000 });
      results.push({ route, outputs, probe, mp4Bytes: (await stat(mp4)).size, provenancePreserved: true, cachedRetry: true });
      await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'in-progress', results, apiRequests, mediaRequests }, null, 2), 'utf8');
    }
    await db.close(); db = undefined;
    const reopened = await FileDatabase.open(join(work, 'fixture.sqlite')); const state = await reopened.getState();
    assert(state.tasks.filter(task => task.inputText === '网络素材双输出工程测试').every(task => task.shortVideoMaterials?.files.length && task.deliverables?.mp4?.status === 'completed' && task.deliverables?.['jianying-draft']?.status === 'completed')); await reopened.close();
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'passed', results, apiRequests, mediaRequests, projectReopened: true, paidRequests: 0, realProviderVerified: false, fixture: 'Actual local HTTP and actual decoded media; provider API and license source data are offline fixtures; Jianying application was not opened.' }, null, 2), 'utf8');
    server.closeAllConnections(); server.close(); keep.destroy(); app.exit(0);
  } catch (error) {
    await writeFile(join(work, 'report.json'), JSON.stringify({ status: 'failed', error: error instanceof Error ? error.stack : String(error), results, apiRequests, mediaRequests, paidRequests: 0, realProviderVerified: false }, null, 2), 'utf8');
    console.error(error); await db?.close(); server.closeAllConnections(); server.close(); keep.destroy(); app.exit(1);
  }
});
