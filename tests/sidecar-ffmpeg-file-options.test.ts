import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';
it('selects cached file-filter flags for FFmpeg 6, 7 and 9 without expanding graphs into command arguments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sidecar-file-options-'));
  const script = await writeStoryboundSidecarScript(dir);
  const result = await runBoundedProcess(resolve('vendor/python/python.exe'), ['-c', `
import runpy, sys, types
ns = runpy.run_path(sys.argv[1])
choose = ns['file_filter_option']
g = choose.__globals__
for version, expected in [('6.1.2', ['-filter_script:v', '-filter_complex_script']), ('7.1', ['-/filter:v', '-/filter_complex']), ('9.0.2-essentials_build', ['-/filter:v', '-/filter_complex'])]:
    calls = []
    def run(*args, **kwargs):
        calls.append(args)
        return types.SimpleNamespace(stdout='ffmpeg version ' + version, returncode=0)
    g['_ffmpeg_file_option_modern'] = None
    g['run_bounded_subprocess'] = run
    assert [choose(), choose(True)] == expected
    assert len(calls) == 1
for legacy in [True, False]:
    calls = []
    def custom(*args, **kwargs):
        calls.append(args)
        return types.SimpleNamespace(stdout='ffmpeg version N-git' if len(calls) == 1 else ('-filter_complex_script filename' if legacy else '-filter_complex graph'), stderr='', returncode=0)
    g['_ffmpeg_file_option_modern'] = None
    g['run_bounded_subprocess'] = custom
    assert choose(True) == ('-filter_complex_script' if legacy else '-/filter_complex')
    assert len(calls) == 2
print('compatible')
`, script], { cwd: dir, timeoutMs: 10000, maxStdoutBytes: 65536, maxStderrBytes: 65536 });
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('compatible');
});
