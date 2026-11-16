import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  collectLemoAttributionChecks, resolveFinalFilmFfmpeg, runFinalFilmGate, runFinalFilmGateSafely,
} from '../electron/final-film-gate-runner';
import { finalizeLemoUpstreamFilm } from '../electron/lemo-upstream-video';
import type { FinalFilmGateExpectation, FinalFilmGateReport } from '../src/shared/final-film-gate';

const pythonRoot = resolve(__dirname, '..', 'vendor', 'python');
const binaries = join(pythonRoot, 'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
const ffmpeg = existsSync(binaries) ? readdirSync(binaries).filter(name => /^ffmpeg.*\.exe$/i.test(name)).sort().map(name => join(binaries, name)).pop() : undefined;
const available = process.platform === 'win32' && !!ffmpeg;

function encode(args: string[]) {
  const result = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', timeout: 60_000 });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr}`);
}
const COLOR = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1'];
const expected: FinalFilmGateExpectation = { durationMs: 3000, fps: 24, width: 320, height: 180, audioExpected: true };
const status = (report: FinalFilmGateReport, id: string) => report.checks.find(item => item.id === id)?.status;

describe('final film gate wiring contract', () => {
  it('main.ts passes the Lemo film expectation and project folder to finalizeLemoUpstreamFilm; the duration hard gate stays', async () => {
    const main = await readFile(resolve(__dirname, '..', 'electron', 'main.ts'), 'utf8');
    const call = main.slice(main.indexOf('const mux = await finalizeLemoUpstreamFilm(result.outputPath'), main.indexOf("console.warn('[lemo-mux]'"));
    expect(call).toContain('audioExpected: document.productionRun?.settings.narration !== false || Boolean(document.productionRun?.settings.music)');
    expect(main).toContain('summarizeFinalFilmGate(mux.qualityGate)');
    const qa = await readFile(resolve(__dirname, '..', 'scripts', 'qa-lemo-upstream-production.ts'), 'utf8');
    expect(qa).toContain('finalizeLemoUpstreamFilm(result.outputPath');
    expect(qa).toContain('qualityGate: { expected:');
    const renderer = await readFile(resolve(__dirname, '..', 'electron', 'lemo-upstream-renderer.ts'), 'utf8');
    expect(renderer).toContain('LEMO_EXPORT_DURATION_MISMATCH');
  });
});

describe('final film gate runner: failure handling (no ffmpeg needed)', () => {
  it('records a missing film / missing ffmpeg / cancelled gate as status error and never throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'final-gate-err-'));
    try {
      const film = join(root, 'film.mp4');
      const missingFilm = await runFinalFilmGateSafely({ route: 'html', filmPath: film, expected, ffmpegPath: join(root, 'nope.exe'), log: () => {} });
      expect(missingFilm).toMatchObject({ status: 'error', blocking: false, error: { code: 'FINAL_GATE_FILM_MISSING' } });
      expect(JSON.parse(await readFile(join(root, 'quality-gate.json'), 'utf8'))).toMatchObject({ status: 'error', route: 'html', film: 'film.mp4' });

      await writeFile(film, 'not a video');
      const noFfmpeg = await runFinalFilmGateSafely({ route: 'template', filmPath: film, expected, ffmpegPath: join(root, 'nope.exe'), reportPath: null, log: () => {} });
      expect(noFfmpeg.error?.code).toBe('FINAL_GATE_FFMPEG_MISSING');

      const controller = new AbortController();
      controller.abort();
      const cancelled = await runFinalFilmGateSafely({ route: 'lemo', filmPath: film, expected, signal: controller.signal, reportPath: null, log: () => {} });
      expect(cancelled.error?.code).toBe('FINAL_GATE_CANCELLED');
      await expect(runFinalFilmGate({ route: 'lemo', filmPath: film, expected, signal: controller.signal })).rejects.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('greps a Lemo project for §11 sign-off and checks CREDITS against CC BY assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'final-gate-lemo-'));
    try {
      await mkdir(join(root, 'assets'), { recursive: true });
      await mkdir(join(root, 'node_modules', 'x'), { recursive: true });
      await writeFile(join(root, 'index.html'), '<p>片尾</p>\n<p>Made with LemoLab</p>\n');
      await writeFile(join(root, 'render.sh'), 'LIB=../lemo lab/core\n');
      await writeFile(join(root, 'LICENSE'), 'LemoLab MIT');
      await writeFile(join(root, 'node_modules', 'x', 'index.js'), '// opus 5.5');
      await writeFile(join(root, 'assets', 'MANIFEST.json'), JSON.stringify({ storydream: 'lemo-assets', version: 1, fps: 24, rules: [],
        assets: [{ id: 'a01', origin: 'imported', kind: 'image', license: 'CC BY 4.0', source: 'Wikimedia / Jane', sha256: 'x', width: 1, height: 1, description: '' }] }));
      let checks = await collectLemoAttributionChecks(root);
      expect(checks.find(item => item.id === 'lemo-signoff')).toMatchObject({ status: 'fail', code: 'FINAL_GATE_LEMO_SIGNOFF' });
      expect(checks.find(item => item.id === 'lemo-signoff')?.detail).toContain('index.html:2');
      expect(checks.find(item => item.id === 'lemo-credits')?.status).toBe('fail');
      await writeFile(join(root, 'index.html'), '<p>片尾</p>\n');
      await writeFile(join(root, 'CREDITS'), 'Photo a01: Wikimedia / Jane, CC BY 4.0\nLibrary: LemoLab\n');
      checks = await collectLemoAttributionChecks(root);
      expect(checks.map(item => item.status)).toEqual(['pass', 'pass']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!available)('final film gate runner with the bundled imageio ffmpeg', () => {
  it('resolves the bundled ffmpeg from a python root', async () => {
    const resolved = await resolveFinalFilmFfmpeg({ pythonRoot });
    expect(resolved?.ffmpegPath).toBe(ffmpeg);
  });

  it('passes a compliant clip and flags a black, untagged, mis-sized, silent one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'final-gate-run-'));
    try {
      const good = join(root, 'good', 'film.mp4');
      await mkdir(join(root, 'good'));
      encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3',
        '-filter_complex', '[0:v]setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1,format=yuv420p[v];[1:a]volume=7dB[a]',
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', ...COLOR, '-c:a', 'aac', '-b:a', '128k', good]);
      const report = await runFinalFilmGateSafely({ route: 'template', filmPath: good, expected, pythonRoot, log: () => {} });
      expect(report.checks.filter(item => item.status !== 'pass')).toEqual([]);
      expect(report).toMatchObject({ status: 'passed', passed: true, blocking: false, measurements: { probeSource: 'ffmpeg' } });
      expect(report.measurements?.loudness?.integratedLufs).toBeGreaterThan(-15);
      expect(report.measurements?.frames.map(frame => frame.meanLuma! > 20)).toEqual([true, true, true]);
      expect(JSON.parse(await readFile(join(root, 'good', 'quality-gate.json'), 'utf8'))).toMatchObject({ status: 'passed', film: 'film.mp4' });

      const bad = join(root, 'bad', 'film.mp4');
      await mkdir(join(root, 'bad'));
      encode(['-f', 'lavfi', '-i', 'color=black:size=320x240:rate=30:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', bad]);
      const failed = await runFinalFilmGateSafely({ route: 'html', filmPath: bad, expected, ffmpegPath: ffmpeg, log: () => {} });
      expect(failed).toMatchObject({ status: 'failed', passed: false });
      for (const id of ['duration', 'resolution', 'fps', 'audio', 'frame-first', 'frame-middle', 'frame-last']) expect([id, status(failed, id)]).toEqual([id, 'fail']);
      expect(status(failed, 'color')).toBe('warn');
      // Real tv-range black measures Y = 16, below the 20 threshold.
      expect(failed.measurements?.frames[1].meanLuma).toBeLessThan(20);

      const quiet = join(root, 'quiet.mp4');
      encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3',
        '-filter_complex', '[1:a]volume=-20dB[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...COLOR, '-c:a', 'aac', quiet]);
      const quietReport = await runFinalFilmGate({ route: 'template', filmPath: quiet, expected, ffmpegPath: ffmpeg });
      expect(status(quietReport, 'loudness')).toBe('fail');
      const silentDesign = await runFinalFilmGate({ route: 'lemo', filmPath: quiet, expected: { ...expected, audioExpected: false }, ffmpegPath: ffmpeg });
      expect(status(silentDesign, 'audio')).toBe('pass');
      expect(status(silentDesign, 'loudness')).toBe('skip');
      const authored = await runFinalFilmGate({ route: 'template', filmPath: quiet, expected: { ...expected, loudnessTarget: false }, ffmpegPath: ffmpeg });
      expect(status(authored, 'loudness')).toBe('skip');
      expect(authored.measurements?.loudness).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('Lemo finalize re-checks the muxed film with the §11 grep and writes quality-gate.json beside it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'final-gate-lemo-mux-'));
    try {
      const project = join(root, 'project'), out = join(root, 'out');
      await mkdir(project); await mkdir(out);
      await writeFile(join(project, 'index.html'), '<p>end card: LemoLab</p>');
      const film = join(out, 'film.mp4');
      encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
        '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...COLOR, '-c:a', 'aac', film]);
      const result = await finalizeLemoUpstreamFilm(film, { ffmpegPath: ffmpeg!, fps: 24,
        qualityGate: { expected: { durationMs: 2000, width: 320, height: 180, audioExpected: true }, lemoProjectDir: project } });
      expect(result.qualityGate).toMatchObject({ route: 'lemo', film: 'film.mp4', blocking: false, expected: { fps: 24 } });
      const saved = JSON.parse(await readFile(join(out, 'quality-gate.json'), 'utf8')) as FinalFilmGateReport;
      expect(saved.checks.find(item => item.id === 'lemo-signoff')).toMatchObject({ status: 'fail', code: 'FINAL_GATE_LEMO_SIGNOFF' });
      expect(saved.checks.find(item => item.id === 'lemo-credits')?.status).toBe('warn');
      // mux.sh two-pass loudnorm lands on −14 LUFS; the other technical checks pass.
      for (const id of ['duration', 'codec', 'resolution', 'fps', 'audio', 'loudness', 'frame-first', 'frame-middle', 'frame-last']) expect([id, status(saved, id)]).toEqual([id, 'pass']);
      const plain = await finalizeLemoUpstreamFilm(film, { ffmpegPath: ffmpeg!, fps: 24 });
      expect(plain.qualityGate).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it('records a timeout as an error report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'final-gate-timeout-'));
    try {
      const film = join(root, 'film.mp4');
      encode(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', film]);
      const report = await runFinalFilmGateSafely({ route: 'html', filmPath: film, expected, ffmpegPath: ffmpeg, timeoutMs: 1, log: () => {} });
      expect(report).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_TIMEOUT' } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 60_000);
});
