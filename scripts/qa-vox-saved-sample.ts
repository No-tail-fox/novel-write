/** Local rendering evidence from completed automatic nodes. Never calls a provider. */
import { app, BrowserWindow } from 'electron';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseEditorialCollagePipelineData, rebuildEditorialTimeline } from '../src/shared/editorial-collage';
import { buildDirectorRenderScenes } from '../src/shared/director-render';
import { renderDirectorVideo } from '../electron/director-renderer';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';

const root = resolve('.'), source = join(root, '.artifacts/vox-production-paper/document.json');
const work = join(root, '.artifacts/vox-production-paper/saved-sample');
app.disableHardwareAcceleration();
app.setPath('userData', join(work, 'profile'));
setDefaultPythonRuntimeAppRoot(root);
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const keep = new BrowserWindow({ show: false });
  try {
    await mkdir(work, { recursive: true });
    const original = parseEditorialCollagePipelineData(JSON.parse(await readFile(source, 'utf8')));
    // Only complete narrated sentences. Later automatic shots have an unresolved paid request.
    const included = new Set(['shot-1', 'shot-2-a']);
    const document = structuredClone(original);
    document.beats = document.beats.flatMap(beat => {
      const shots = beat.shots.filter(shot => included.has(shot.id));
      if (!shots.length) return [];
      for (const shot of shots) {
        if (!original.productionRun?.nodes.some(n => n.id === `compile:${shot.id}` && n.status === 'completed')) throw new Error(`Incomplete shot ${shot.id}`);
      }
      const subtitleCueIds = new Set(shots.flatMap(s => s.subtitleCueIds));
      const subtitleCues = beat.subtitleCues.filter(c => subtitleCueIds.has(c.id));
      return [{ ...beat, shots, subtitleCues, narration: subtitleCues.map(c => c.text).join(''), durationMs: shots.reduce((n, s) => n + s.durationMs, 0) }];
    });
    delete document.productionRun;
    if (document.timeline?.audioClips) document.timeline.audioClips = document.timeline.audioClips.filter(clip => clip.shotId && included.has(clip.shotId));
    document.title += ' · 已完成镜头片段';
    const current = rebuildEditorialTimeline(document);
    const scenes = buildDirectorRenderScenes(current);
    console.log('Rendering saved real assets:', scenes.length, current.timeline?.durationMs);
    const rendered = await renderDirectorVideo({ workDir: work, projectTitle: current.title, modeLabel: 'VOX', ratio: current.ratio, scenes,
      animationRuntimePath: join(root, 'dist-electron/electron/vox-animation-runtime.js') });
    const output = join(work, 'urban-heat-partial.mp4');
    await copyFile(rendered.outputPath, output);
    const probe = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: work, media_path: output, require_nonblack: true, analyze_quality: true });
    if (!probe.has_video || !probe.has_audio || !probe.has_nonblack_video || probe.audio_is_silent) throw new Error('Saved sample media failed validation');
    await writeFile(join(work, 'document.json'), JSON.stringify(current, null, 2), 'utf8');
    await writeFile(join(work, 'report.json'), JSON.stringify({ kind: 'local-render-of-completed-automatic-shots', source, included: [...included],
      paidProviderCalls: 0, automaticRunStatus: original.productionRun?.status, limitation: 'Partial sample only; the original full run remains blocked on an unknown image request. Sentence-level estimated subtitles; no VLM or word alignment claim.',
      output, scenes, rendered, probe }, null, 2), 'utf8');
    await rm(join(work, 'error.txt'), { force: true });
    console.log(output); keep.destroy(); app.exit(0);
  } catch (error) {
    console.error(error); await writeFile(join(work, 'error.txt'), error instanceof Error ? error.stack ?? error.message : String(error), 'utf8');
    keep.destroy(); app.exit(1);
  }
});
