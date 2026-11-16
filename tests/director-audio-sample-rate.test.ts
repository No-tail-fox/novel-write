import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { createHtmlVideoComposePayload, type HtmlVideoComposition } from '../src/shared/html-video';

describe('director audio sample clock', () => {
  it.each([undefined, 44100, 48000] as const)('forwards requested rate %s to composition', (audioSampleRate) => {
    const input: HtmlVideoComposition = { audioSampleRate, workDir: 'work', outputPath: 'film.mp4', title: 'Film', fps: 24, canvas_w: 32, canvas_h: 32, totalDurationS: 0, scenes: [] };
    expect(createHtmlVideoComposePayload(input, []).audio_sample_rate).toBe(audioSampleRate);
  });

  it('uses the selected clock for real Python graphs, sample delays, streamed encoding and recursive composition', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'director-audio-clock-'));
    try {
      const script = await writeStoryboundSidecarScript(dir);
      const source = join(dir, 'source.wav');
      await writeFile(source, 'fixture');
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `
import json, os, runpy, sys
ns = runpy.run_path(sys.argv[1])
g = ns['scene_audio_input'].__globals__
calls = []
g['run_ffmpeg'] = lambda args, **kwargs: calls.append(args)
g['run_composition_ffmpeg'] = lambda args: calls.append(args)
g['first_frame_pattern'] = lambda path: 'frame.png'
reports = []
for requested in [None, 44100, 48000]:
    rate = ns['render_audio_sample_rate']({} if requested is None else {'audio_sample_rate': requested})
    calls.clear()
    clip = {'path':sys.argv[2], 'startMs':100, 'durationMs':500}
    ns['scene_audio_input']({'audio_clips':[clip]}, 1, sys.argv[3], 0, rate)
    mix = calls[-1]
    ns['scene_audio_input']({'audio_clips':[]}, 1, sys.argv[3], 0, rate)
    silence = calls[-1]
    ns['generate_encode_render_scene']({'scene':{'frames_dir':sys.argv[3], 'audio_path':sys.argv[2], 'duration_s':1}, 'work_dir':sys.argv[3], 'output_path':os.path.join(sys.argv[3],'segment.mp4'), **({} if requested is None else {'audio_sample_rate':requested})})
    encode = calls[-1]
    paths = [sys.argv[2]] * 16
    calls.clear()
    ns['_compose_with_hard_cuts'](paths, os.path.join(sys.argv[3],'cut.mp4'), [1]*16, audio_sample_rate=rate)
    cut = list(calls)
    calls.clear()
    ns['_compose_with_xfade'](paths, os.path.join(sys.argv[3],'fade.mp4'), durations=[1]*16, audio_sample_rate=rate)
    fade = list(calls)
    reports.append({'rate':rate,'mix':mix,'silence':silence,'encode':encode,'cut':cut,'fade':fade})
try:
    ns['render_audio_sample_rate']({'audio_sample_rate':96000})
    raise AssertionError('unsupported rate accepted')
except ValueError:
    pass
print(json.dumps(reports))
`, script, source, dir], { cwd: dir, timeoutMs: 10_000, maxStdoutBytes: 200000, maxStderrBytes: 65536 });
      expect(result.code, result.stderr).toBe(0);
      const reports = JSON.parse(result.stdout) as Array<{rate: number; mix: string[]; silence: string[]; encode: string[]; cut: string[][]; fade: string[][]}>;
      expect(reports.map(report => report.rate)).toEqual([44100, 44100, 48000]);
      for (const report of reports) {
        const graph = report.mix[report.mix.indexOf('-filter_complex') + 1];
        expect(graph).toContain(`aresample=${report.rate}`);
        expect(graph).toContain(`adelay=${Math.round(report.rate * .1)}S:all=1`);
        expect(graph).toContain(`aformat=sample_rates=${report.rate}`);
        expect(report.silence).toContain(`anullsrc=r=${report.rate}:cl=stereo`);
        expect(report.encode[report.encode.indexOf('-af') + 1]).toContain(`aresample=${report.rate}`);
        for (const call of [...report.cut, ...report.fade].filter(call => call.includes('-filter_complex'))) {
          expect(call[call.indexOf('-filter_complex') + 1]).toContain(`sample_rates=${report.rate}`);
        }
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
