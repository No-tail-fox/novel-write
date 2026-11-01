import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo, setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { runSmokeWithTempRoot } from './smoke-signal-lifecycle';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fps = 24, width = 320, height = 180, durationMs = 6640;
const lyrics = Array.from({ length: 8 }, (_, i) => ({ text: '同步歌词' + (i + 1), startMs: i * 830 + 221, endMs: i * 830 + 541 }));
const stamp = (ms: number) => '[00:' + (ms / 1000).toFixed(3).padStart(6, '0') + ']';
const lrc = lyrics.flatMap(cue => [stamp(cue.startMs) + cue.text, stamp(cue.endMs)]).join('\n');

async function main() {
  // All generated fixtures, Chromium data, frames and media stay in the workspace.
  const scratch = join(root, '.tmp', 'music-sync-test-temp');
  await mkdir(scratch, { recursive: true });
  await runSmokeWithTempRoot({
    createTempRoot: () => mkdtemp(join(scratch, 'electron-mv-sync-')),
    run: async ({ tempRoot, signal }) => {
      const song = join(tempRoot, 'song.wav'), report = join(tempRoot, 'report.json');
      const runtime = join(tempRoot, 'native-runtime.js'), output = join(tempRoot, 'sync.mp4');
      await writeFile(song, makeSong());
      await build({ entryPoints: [join(root, 'src/features/vox-animation/lemo-native-runtime.ts')], outfile: runtime, bundle: true, platform: 'browser', format: 'iife', target: 'chrome142', logLevel: 'silent' });
      const entry = electronEntry({ tempRoot, song, report, runtime, output });
      await build({ stdin: { contents: entry, loader: 'ts', resolveDir: root }, outfile: join(tempRoot, 'entry.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['electron', 'typescript'], banner: { js: "import { createRequire as smokeCreateRequire } from 'node:module'; const require = smokeCreateRequire(import.meta.url);" }, logLevel: 'silent' });
      await writeFile(join(tempRoot, 'package.json'), JSON.stringify({ name: 'music-mv-sync-smoke', version: '1.0.0', type: 'module', main: 'entry.mjs' }), 'utf8');
      const env: NodeJS.ProcessEnv = { ...process.env, TEMP: tempRoot, TMP: tempRoot, TMPDIR: tempRoot, NODE_ENV: 'production', VITE_DEV_SERVER_URL: '' };
      delete env.ELECTRON_RUN_AS_NODE;
      const execution = await runBoundedProcess(createRequire(import.meta.url)('electron') as string, [tempRoot], {
        cwd: root, env, signal, timeoutMs: 240_000, maxStdoutBytes: 65536, maxStderrBytes: 65536,
      });
      const rendered = JSON.parse(await readFile(report, 'utf8').catch(() => '{}'));
      if (execution.code !== 0 || rendered.error || !rendered.scenes) throw new Error(JSON.stringify({ rendered, stderr: execution.stderr.slice(-3000) }));
      setDefaultPythonRuntimeAppRoot(root);
      const script = await writeStoryboundSidecarScript(tempRoot);
      const decoded = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', decoder, script, output, JSON.stringify(lyrics), String(durationMs), String(fps), String(width), String(height)], {
        cwd: tempRoot, env, signal, timeoutMs: 60_000, maxStdoutBytes: 65536, maxStderrBytes: 65536,
      });
      if (decoded.code !== 0) throw new Error(decoded.stderr || decoded.stdout);
      console.log(JSON.stringify({ ...rendered, ...JSON.parse(decoded.stdout) }, null, 2));
    },
    cleanup: async tempRoot => {
      const target = resolve(tempRoot);
      if (dirname(target) !== resolve(scratch) || !basename(target).startsWith('electron-mv-sync-')) throw new Error('Unexpected smoke cleanup path');
      await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  });
}

function makeSong(): Buffer {
  const rate = 44100, samples = Math.round(durationMs * rate / 1000), result = Buffer.alloc(44 + samples * 2);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(rate, 24); result.writeUInt32LE(rate * 2, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34);
  result.write('data', 36); result.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) {
    const active = lyrics.some(cue => n * 1000 / rate >= cue.startMs && n * 1000 / rate < cue.endMs);
    result.writeInt16LE(active ? Math.round(10000 * Math.sin(n * 2 * Math.PI * 880 / rate)) : 0, 44 + n * 2);
  }
  return result;
}

function electronEntry(paths: { tempRoot: string; song: string; report: string; runtime: string; output: string }): string {
  return `
import { app, BrowserWindow } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { createMusicMvDocument } from './src/shared/music-mv-production';
import { createVoxAnimation } from './src/shared/vox-animation';
import { prepareVoxHtml, compileVoxCode } from './electron/vox-animation-runtime';
import { createElectronHtmlVideoRenderer } from './electron/html-video-renderer';
import { setDefaultPythonRuntimeAppRoot } from './src/shared/python-runtime';
const paths = ${JSON.stringify(paths)};
const lyrics = ${JSON.stringify(lyrics)};
app.disableHardwareAcceleration();
app.setPath('userData', paths.tempRoot + '/user-data');
app.setPath('crashDumps', paths.tempRoot + '/crash-dumps');
app.setPath('logs', paths.tempRoot + '/logs');
setDefaultPythonRuntimeAppRoot(${JSON.stringify(root)});
let keepAlive;
async function run() {
  keepAlive = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  const document = createMusicMvDocument('sync-smoke', {
    title: '音乐字幕时钟回归', inputText: ${JSON.stringify(lrc)}, taskKind: 'music-mv', track: 'music-mv', storyboardSceneCount: 8,
    musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'minimal', visualMotif: '回归测试', audioPath: paths.song },
  }, ${durationMs}, '2026-10-29T00:00:00.000Z');
  const shots = document.beats.flatMap(beat => beat.shots).map(shot => {
    const clip = document.timeline?.clips.find(clip => clip.shotId === shot.id);
    if (!clip) throw new Error('Missing production timeline clip: ' + shot.id);
    return { ...shot, startMs: clip.startMs };
  }), cues = document.beats.flatMap(beat => beat.subtitleCues);
  const source = '<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:#000}canvas{display:block}</style></head><body><canvas width="320" height="180"></canvas><script>'
    + 'const c=document.querySelector("canvas"),ctx=c.getContext("2d"),cues=' + JSON.stringify(cues) + ';'
    + 'window.DUR=6.64;window.READY=true;window.TEXTS=t=>cues.filter(q=>q.startMs<=t*1000&&t*1000<q.endMs).map(q=>({id:q.id,cueId:q.id,text:q.text,x0:70,y0:130,x1:290,y1:160,fontFamily:"sans-serif",fontSize:22}));'
    + 'window.render=t=>{ctx.fillStyle="#18334d";ctx.fillRect(0,0,320,180);for(const q of window.TEXTS(t)){ctx.fillStyle="#fff";ctx.font="22px sans-serif";ctx.fillText(q.text,70,155);ctx.fillRect(5,145,20,20);}};'
    + '</script></body></html>';
  const code = compileVoxCode(source), scenes = [];
  let visibilityChecks = 0;
  for (const shot of shots) {
    const animation = { ...createVoxAnimation(), mode: 'code', code: { ...code, prompt: '' }, native: { filmId: 'sync-smoke', startMs: shot.startMs, durationMs: shot.durationMs, filmDurationMs: 6640, width: 320, height: 180, fps: 24, assetIds: [] } };
    const localCues = cues.filter(c=>c.shotId===shot.id).map(c=>({...c,startMs:c.startMs-shot.startMs,endMs:c.endMs-shot.startMs}));
    const html = await prepareVoxHtml(paths.runtime, { animation, width: 320, height: 180, fps: 24, durationMs: shot.durationMs, assets: [], cues: localCues });
    scenes.push({ sceneId: shots.indexOf(shot)+1, title: shot.id, caption: '', description: '', imagePath: '', html,
      audioPath: paths.song, audioClips: [{id:shot.id,path:paths.song,trackType:'music',startMs:0,sourceStartMs:shot.startMs,durationMs:shot.durationMs,gainDb:0}],
      durationMs: shot.durationMs, duration: shot.durationMs/1000 });
  }
  const renderer = createElectronHtmlVideoRenderer({ inspectScene: async (window,scene) => {
    const shot=shots[scene.sceneId-1];
    const times=[0,shot.durationMs-1,...cues.filter(c=>c.shotId===shot.id).flatMap(c=>[c.startMs-shot.startMs-1,c.startMs-shot.startMs,c.endMs-shot.startMs-1,c.endMs-shot.startMs])].filter(t=>t>=0&&t<shot.durationMs);
    for(const time of times){
      const drawn=await window.webContents.executeJavaScript('(async()=>{await window.__tl.seek('+time+'/1000);return window.__lemo.frameTexts().map(q=>q.text)})()');
      const expected=cues.filter(q=>q.startMs<=shot.startMs+time&&shot.startMs+time<q.endMs).map(q=>q.text);
      if(JSON.stringify(drawn)!==JSON.stringify(expected))throw new Error('Caption visibility mismatch '+JSON.stringify({time,shot:shot.id,drawn,expected}));
      visibilityChecks++;
    }
  }});
  await renderer.render({workDir:paths.tempRoot,outputPath:paths.output,title:'MV sync smoke',fps:24,canvas_w:320,canvas_h:180,totalDurationS:6.64,scenes,transition:{type:'cut',duration:0},normalizeAudio:false}, {});
  return { scenes: scenes.length, visibilityChecks, nativeEngine: code.engine };
}
app.whenReady().then(run).then(async result=>{await writeFile(paths.report,JSON.stringify(result),'utf8');app.exit(0)}).catch(async error=>{await writeFile(paths.report,JSON.stringify({error:error.stack||String(error)}),'utf8');app.exit(1)});
`;
}

const decoder = String.raw`
import array,json,runpy,subprocess,sys
ns=runpy.run_path(sys.argv[1]); path=sys.argv[2]; cues=json.loads(sys.argv[3]); duration=float(sys.argv[4])/1000; fps=int(sys.argv[5]); w=int(sys.argv[6]); h=int(sys.argv[7]); ff=ns['ffmpeg_exe']()
raw=subprocess.check_output([ff,'-v','error','-i',path,'-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24','-'],timeout=30)
frames=len(raw)//(w*h*3)
assert abs(frames/fps-duration)<=1/fps,(frames,duration)
states=[]; mismatches=[]
for i in range(frames):
    offset=i*w*h*3+(150*w+10)*3
    visible=min(raw[offset:offset+3])>200
    t=i/fps*1000
    expected=any(c['startMs']<=t<c['endMs'] for c in cues)
    states.append(visible)
    if visible!=expected:
        distance=min(abs(t-c[k]) for c in cues for k in ['startMs','endMs'])
        assert distance<=500/fps+0.01,(i,t,visible,expected,distance)
        mismatches.append(i)
starts=[i/fps for i in range(frames) if states[i] and (i==0 or not states[i-1])]
ends=[i/fps for i in range(1,frames) if not states[i] and states[i-1]]
assert len(starts)==len(cues)==len(ends),(starts,ends)
audio=array.array('f',subprocess.check_output([ff,'-v','error','-i',path,'-map','0:a:0','-ac','1','-ar','44100','-f','f32le','-'],timeout=30))
audio_starts=[]
for cue in cues:
    center=round(cue['startMs']/1000*44100)
    start=next(i for i in range(max(0,center-2205),center+2205) if abs(audio[i])>.05)
    audio_starts.append(start/44100)
errors=[abs(starts[i]-audio_starts[i])*1000 for i in range(len(cues))]
end_errors=[abs(ends[i]*1000-cues[i]['endMs']) for i in range(len(cues))]
assert max(errors)<=1000/fps+1,errors
assert max(end_errors)<=1000/fps+1,end_errors
assert max(abs(audio_starts[i]*1000-cues[i]['startMs']) for i in range(len(cues)))<10,audio_starts
print(json.dumps({'frames':frames,'captionCount':len(starts),'maxCaptionAudioOffsetMs':round(max(errors),3),'maxCaptionEndOffsetMs':round(max(end_errors),3),'globalGridBoundaryFrames':mismatches,'durationSeconds':frames/fps}))
`;

main().catch(error => { console.error(error); process.exitCode = 1; });
