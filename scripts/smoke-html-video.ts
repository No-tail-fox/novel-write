import { build } from 'esbuild';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedProcess } from '../src/shared/process-runner';
import { formatSmokeError, runSmokeWithTempRoot, setSmokeFailureExitCode } from './smoke-signal-lifecycle';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const electronPath = createRequire(import.meta.url)('electron') as string;
const timeoutMs = 180_000;
const maxOutputBytes = 4 * 1024 * 1024;
const durationToleranceS = 0.4;
const smokeManagedStorageKey = '0123456789abcdef0123456789abcdef0123456789abcdef';

interface HtmlVideoSmokeReport {
  outputPath: string;
  outputBytes: number;
  expectedDurationS: number;
  probedDurationS: number;
  previewCount: number;
  thumbnailsNonempty: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  videoWidth: number;
  videoHeight: number;
  framesCleaned: boolean;
  error?: string;
}

async function main(): Promise<void> {
  await runSmokeWithTempRoot({
    createTempRoot: () => mkdtemp(join(tmpdir(), 'storydream-html-video-smoke-')),
    run: async ({ tempRoot, signal }) => {
      const workDir = join(tempRoot, 'storydream-smoke', 'tasks', smokeManagedStorageKey);
      const reportPath = join(tempRoot, 'report.json');
      const bundlePath = join(tempRoot, 'electron-smoke.mjs');
      await mkdir(workDir, { recursive: true });
      signal.throwIfAborted();

      const backgrounds = [join(workDir, 'background-1.png'), join(workDir, 'background-2.png')];
      const voices = [join(workDir, 'voice-1.wav'), join(workDir, 'voice-2.wav')];
      const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zp6cAAAAASUVORK5CYII=', 'base64');
      await Promise.all([
        writeFile(backgrounds[0], pixel),
        writeFile(backgrounds[1], pixel),
        writeFile(voices[0], wavTone(900, 330)),
        writeFile(voices[1], wavTone(900, 440)),
      ]);
      signal.throwIfAborted();

      await build({
        stdin: {
          contents: electronEntry({ rootDir, workDir, reportPath, backgrounds, voices }),
          loader: 'ts',
          resolveDir: rootDir,
          sourcefile: 'html-video-smoke-entry.ts',
        },
        outfile: bundlePath,
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        external: ['electron'],
        logLevel: 'silent',
      });
      signal.throwIfAborted();
      await writeFile(join(tempRoot, 'package.json'), JSON.stringify({
        name: 'storydream-html-video-smoke',
        version: '1.0.0',
        type: 'module',
        main: 'electron-smoke.mjs',
      }), 'utf8');
      signal.throwIfAborted();

      const environment: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production', VITE_DEV_SERVER_URL: '' };
      delete environment.ELECTRON_RUN_AS_NODE;
      let execution: Awaited<ReturnType<typeof runBoundedProcess>>;
      try {
        execution = await runBoundedProcess(electronPath, [tempRoot], {
          cwd: rootDir,
          env: environment,
          timeoutMs,
          maxStdoutBytes: maxOutputBytes,
          maxStderrBytes: maxOutputBytes,
          signal,
        });
        signal.throwIfAborted();
      } catch (error) {
        const phase = await readFile(reportPath, 'utf8').catch(() => 'no phase report');
        throw new Error(`HTML video Electron smoke process failed. Last phase: ${phase}`, { cause: error });
      }
      if (execution.code !== 0 || execution.signal) {
        const detail = execution.stderr.trim().slice(-4000);
        const report = await readFile(reportPath, 'utf8').catch(() => '');
        throw new Error(`HTML video Electron smoke exited with ${execution.code ?? execution.signal}.${detail ? `\n${detail}` : ''}${report ? `\nreport:\n${report}` : ''}`);
      }

      let reportSource: string;
      try {
        reportSource = await readFile(reportPath, 'utf8');
      } catch (error) {
        const stdout = execution.stdout.trim().slice(-4000);
        const stderr = execution.stderr.trim().slice(-4000);
        throw new Error(
          `HTML video Electron smoke did not write its report.${stdout ? `\nstdout:\n${stdout}` : ''}${stderr ? `\nstderr:\n${stderr}` : ''}`,
          { cause: error },
        );
      }
      const report = JSON.parse(reportSource) as HtmlVideoSmokeReport;
      if (report.error) throw new Error(`HTML video Electron smoke failed: ${report.error}`);
      if (report.previewCount !== 2 || !report.thumbnailsNonempty) {
        throw new Error('HTML video Electron smoke did not create two nonempty previews.');
      }
      if (!(report.outputBytes > 0) || !(report.probedDurationS > 0)) {
        throw new Error('HTML video Electron smoke produced an empty or unreadable MP4.');
      }
      if (!report.hasVideo || !report.hasAudio) {
        throw new Error('HTML video Electron smoke output does not contain both video and audio streams.');
      }
      if (report.videoWidth !== 320 || report.videoHeight !== 568) {
        throw new Error(`HTML video Electron smoke canvas mismatch: ${report.videoWidth}x${report.videoHeight}.`);
      }
      if (!report.framesCleaned) {
        throw new Error('HTML video Electron smoke left captured frame directories behind after success.');
      }
      if (Math.abs(report.probedDurationS - report.expectedDurationS) > durationToleranceS) {
        throw new Error(`HTML video Electron smoke duration mismatch: expected ${report.expectedDurationS}s, probed ${report.probedDurationS}s.`);
      }
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    },
    cleanup: async (tempRoot) => {
      await rm(tempRoot, { recursive: true, force: true });
    },
  });
}

function electronEntry(input: {
  rootDir: string;
  workDir: string;
  reportPath: string;
  backgrounds: string[];
  voices: string[];
}): string {
  return `
import { app, BrowserWindow } from 'electron';
import { access, stat, writeFile } from 'node:fs/promises';
import { createElectronHtmlVideoRuntime, ensureHtmlVideoTaskWorkDir } from './electron/html-video-runtime';
import { createElectronHtmlVideoRenderer } from './electron/html-video-renderer';
import { runStoryboundMediaSidecar } from './src/shared/storybound-sidecar';
import { setDefaultPythonRuntimeAppRoot } from './src/shared/python-runtime';

const rootDir = ${JSON.stringify(input.rootDir)};
const trustedAppDataRoot = ${JSON.stringify(dirname(dirname(dirname(input.workDir))))};
const workDir = ${JSON.stringify(input.workDir)};
const reportPath = ${JSON.stringify(input.reportPath)};
const backgrounds = ${JSON.stringify(input.backgrounds)};
const voices = ${JSON.stringify(input.voices)};
let keepAliveWindow = null;

async function writePhase(phase) {
  await writeFile(reportPath, JSON.stringify({ error: 'phase:' + phase }), 'utf8');
}

app.disableHardwareAcceleration();
app.setPath('userData', ${JSON.stringify(join(input.workDir, '.electron-user-data'))});
setDefaultPythonRuntimeAppRoot(rootDir);

async function probeMedia(path, signal) {
  return runStoryboundMediaSidecar({
    mode: 'probe_media',
    work_dir: workDir,
    media_path: path,
  }, { signal });
}

async function runAfterReady() {
  await writePhase('app-ready');
  const taskDirectory = await ensureHtmlVideoTaskWorkDir(
    trustedAppDataRoot,
    'storydream-smoke',
    ${JSON.stringify(smokeManagedStorageKey)},
  );
  keepAliveWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const runtime = createElectronHtmlVideoRuntime({
    taskDirectory,
    taskTitle: 'HTML video smoke',
    maxLongEdge: 568,
    fps: 2,
    renderer: createElectronHtmlVideoRenderer(),
    probeMedia: async (_root, path, signal) => {
      const result = await probeMedia(path, signal);
      return {
        duration: result.duration,
        hasAudio: result.has_audio,
        hasVideo: result.has_video,
        width: result.width,
        height: result.height,
      };
    },
    getAvailableDiskBytes: async () => 4 * 1024 * 1024 * 1024,
  });
  const durations = await Promise.all(voices.map((path) => runtime.measureAudioDuration(path)));
  await writePhase('audio-probed');
  const scenes = [1, 2].map((index) => ({
    index,
    narration: 'Smoke scene ' + index,
    title: 'Scene ' + index,
    captions: ['Smoke scene ' + index],
    sceneTemplate: 'cinematic-title',
    background: { prompt: 'solid smoke background ' + index },
    elements: [],
  }));
  const assets = backgrounds.map((src, offset) => ({ sceneIndex: offset + 1, kind: 'bg', slot: 0, src }));
  const voiceClips = voices.map((src, offset) => ({
    sceneIndex: offset + 1,
    src,
    durationSec: durations[offset],
    text: scenes[offset].narration,
  }));
  const transitionDurationS = 0.3;
  const input = {
    scenes,
    assets,
    voices: voiceClips,
    config: { ratio: '9:16', foreground: false, transitionType: 'fade' },
  };
  const previews = await runtime.createPreviews(input);
  await writePhase('previews-created');
  const output = await runtime.render({ ...input, compositions: previews.compositions });
  await writePhase('video-rendered');
  const outputStat = await stat(output.path);
  const thumbnailStats = await Promise.all(previews.compositions.map((item) => stat(item.thumbnailPath)));
  const outputProbe = await probeMedia(output.path);
  const frameDirectories = scenes.map((scene) => workDir + '/frames-' + String(scene.index).padStart(3, '0'));
  const framesCleaned = (await Promise.all(frameDirectories.map(async (path) => {
    try {
      await access(path);
      return false;
    } catch {
      return true;
    }
  }))).every(Boolean);
  await writePhase('output-probed');
  return {
    outputPath: output.path,
    outputBytes: outputStat.size,
    expectedDurationS: durations.reduce((sum, value) => sum + value, 0) - transitionDurationS * Math.max(0, scenes.length - 1),
    probedDurationS: outputProbe.duration ?? 0,
    previewCount: previews.compositions.length,
    thumbnailsNonempty: thumbnailStats.every((item) => item.size > 0),
    hasVideo: outputProbe.has_video === true,
    hasAudio: outputProbe.has_audio === true,
    videoWidth: outputProbe.width ?? 0,
    videoHeight: outputProbe.height ?? 0,
    framesCleaned,
  };
}

function startSmoke() {
  void runAfterReady().then(async (report) => {
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
    if (keepAliveWindow && !keepAliveWindow.isDestroyed()) keepAliveWindow.destroy();
    app.exit(0);
  }).catch(async (error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    await writeFile(reportPath, JSON.stringify({ error: message }, null, 2), 'utf8').catch(() => undefined);
    if (keepAliveWindow && !keepAliveWindow.isDestroyed()) keepAliveWindow.destroy();
    app.exit(1);
  });
}

if (app.isReady()) startSmoke();
else app.once('ready', startSmoke);
`;
}

function wavTone(durationMs: number, frequency: number): Buffer {
  const sampleRate = 8_000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1_000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < samples; index += 1) {
    const value = Math.round(Math.sin((index / sampleRate) * Math.PI * 2 * frequency) * 8_000);
    buffer.writeInt16LE(value, 44 + index * 2);
  }
  return buffer;
}

main().catch((error) => {
  process.stderr.write(`${formatSmokeError(error)}\n`);
  setSmokeFailureExitCode(process);
});
