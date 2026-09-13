import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { evaluateDirectorVisualContinuity, productionVisualContinuityEvidenceSchema } from '../src/shared/production-visual-continuity';

async function withSidecar(run: (dir: string, script: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'visual-cuts-'));
  try { await run(dir, await writeStoryboundSidecarScript(dir)); }
  finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

async function python(dir: string, script: string, code: string, args: string[] = []) {
  const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', `import json, runpy, sys, os\nns = runpy.run_path(sys.argv[1])\n${code}`, script, ...args], {
    cwd: dir, timeoutMs: 90_000, maxStdoutBytes: 2 * 1024 * 1024, maxStderrBytes: 2 * 1024 * 1024,
  });
  expect(result.code, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('real FFmpeg cut-frame probe', () => {
  it.each(['normal', 'black-after', 'white-before', 'hard-cut', 'fractional'] as const)('measures %s without confusing a cut with an intra-shot flash', async kind => {
    await withSidecar(async (dir, script) => {
      const output = await python(dir, script, String.raw`
kind = sys.argv[2]
video = os.path.join(os.getcwd(), '实际切点.mp4')
filters = {'black-after': "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='eq(n,48)'",
           'white-before': "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,47)'",
           'hard-cut': "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='gte(n,48)'"}
ns['run_ffmpeg'](['-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=24:d=4', *(['-vf', filters[kind]] if kind in filters else []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
result = ns['probe_media']({'media_path': video, 'visual_continuity_points_ms': [2001 if kind == 'fractional' else 2000], 'visual_continuity_fps': 24})
print(json.dumps(result))
`, [kind]);
      const evidence = productionVisualContinuityEvidenceSchema.parse(output.visual_continuity);
      expect(evidence.status, evidence.error).toBe('ok');
      expect(evidence.version).toBe(2);
      expect(evidence.cuts[0].frames[1].lumaMeanAbsoluteDelta).toEqual(expect.any(Number));
      const durationMs = kind === 'fractional' ? 2001 : 2000;
      const check = evaluateDirectorVisualContinuity([{ id: 'a', durationMs }, { id: 'b', durationMs: 4000 - durationMs }], evidence);
      expect(check.status, check.detail).toBe(['black-after', 'white-before'].includes(kind) ? 'failed' : 'passed');
      if (kind === 'black-after') expect(evidence.cuts[0].frames[2].blackPercent).toBeGreaterThanOrEqual(98);
      if (kind === 'fractional') expect(evidence.cuts[0].frames.map(frame => frame.index)).toEqual([47, 48, 49, 50]);
      expect((await readdir(dir)).filter(name => name.endsWith('.filter'))).toEqual([]);
    });
  }, 90_000);

  it('decodes 499 cuts in one pass and preserves all evidence', async () => {
    await withSidecar(async (dir, script) => {
      const output = await python(dir, script, String.raw`
video = os.path.join(os.getcwd(), 'capacity.mp4')
ns['run_ffmpeg'](['-f', 'lavfi', '-i', 'color=c=white:s=32x32:r=24:d=400', '-c:v', 'libx264', '-preset', 'ultrafast', video])
probe = ns['visual_continuity_metrics']
execute = probe.__globals__['run_bounded_subprocess']
calls = []
def counted(command, **kwargs):
    calls.append(command)
    return execute(command, **kwargs)
probe.__globals__['run_bounded_subprocess'] = counted
result = probe(video, 400, [index * 800 for index in range(1, 500)], 24)
print(json.dumps({'result': result, 'calls': len(calls), 'maxArgs': max(len(str(command)) for command in calls)}))
`);
      const evidence = productionVisualContinuityEvidenceSchema.parse(output.result);
      expect(evidence.status, evidence.error).toBe('ok');
      expect(evidence.cuts).toHaveLength(499);
      expect(output.calls).toBe(1);
      expect(output.maxArgs).toBeLessThan(2048);
      expect((await readdir(dir)).filter(name => name.endsWith('.filter'))).toEqual([]);
    });
  }, 90_000);

  it('returns explicit failure and cleans filter files on timeout, missing metrics and invalid requests', async () => {
    await withSidecar(async (dir, script) => {
      const result = await python(dir, script, String.raw`
import types
probe = ns['visual_continuity_metrics']
probe.__globals__['ffmpeg_exe'] = lambda: 'ffmpeg-test'
failures = []
for mode in ['timeout', 'decoder', 'missing', 'bad-clock', 'bad-metric']:
    def execute(*args, **kwargs):
        if mode == 'timeout': raise TimeoutError('sample timeout')
        detail = ''
        if mode in ['bad-clock', 'bad-metric']:
            for index in range(46, 50):
                detail += f'frame:{index-46} pts:{index} pts_time:{index/24 + (0.2 if mode == "bad-clock" else 0)}\n'
                detail += 'lavfi.signalstats.YAVG=nan\nlavfi.signalstats.YMIN=16\nlavfi.signalstats.YMAX=230\nlavfi.blackframe.pblack=0\n'
        return types.SimpleNamespace(returncode=1 if mode == 'decoder' else 0, stdout='', stderr=detail)
    probe.__globals__['run_bounded_subprocess'] = execute
    failures.append(probe('fixture.mp4', 4, [2000], 24))
for points in [[2000,2000], [2000,1000], [-1], [4000], [float('nan')], [True], list(range(1,501))]:
    failures.append(probe('fixture.mp4', 4, points, 24))
print(json.dumps(failures))
`);
      expect(result).toHaveLength(12);
      for (const evidence of result) expect(evidence).toMatchObject({ status: 'failed', error: expect.any(String), cuts: [] });
      expect((await readdir(dir)).filter(name => name.endsWith('.filter'))).toEqual([]);
    });
  }, 90_000);
});
