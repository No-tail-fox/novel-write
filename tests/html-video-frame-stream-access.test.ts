import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeStoryboundSidecarScript } from '../src/shared/storybound-sidecar';
import { runBoundedProcess } from '../src/shared/process-runner';
import { resolvePythonRuntimeInfo } from '../src/shared/python-runtime';
import { htmlVideoFrameCaptureTimeoutMs } from '../src/shared/video-render-budget';

describe('streaming frame file contention', () => {
  it('retries transient opens and releases without duplicating or losing any of 97 frames', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-frame-access-'));
    try {
      const script = await writeStoryboundSidecarScript(root);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', String.raw`
import builtins, errno, io, json, os, pathlib, runpy, sys, threading
ns = runpy.run_path(sys.argv[1]); write = ns['write_streamed_frames']; g = write.__globals__
frames = pathlib.Path(sys.argv[2]) / 'frames'; frames.mkdir()
expected = b''
for i in range(1, 98):
    data = bytes([i]) * (65537 if i == 48 else i)
    (frames / f'frame_{i:04d}.jpg').write_bytes(data); expected += data
original_open = builtins.open; original_unlink = os.unlink; attempts = {'open':0,'unlink':0}
def flaky_open(path, *args, **kwargs):
    if str(path).endswith('frame_0048.jpg'):
        attempts['open'] += 1
        if attempts['open'] < 3: raise PermissionError(errno.EACCES, 'sharing violation', str(path))
    return original_open(path, *args, **kwargs)
def flaky_unlink(path, *args, **kwargs):
    if str(path).endswith('frame_0048.jpg'):
        attempts['unlink'] += 1
        if attempts['unlink'] < 3: raise PermissionError(errno.EACCES, 'sharing violation', str(path))
    return original_unlink(path, *args, **kwargs)
g['open'] = flaky_open; os.unlink = flaky_unlink
pipe = io.BytesIO()
try: write(pipe, threading.Event(), str(frames), 97)
finally: os.unlink = original_unlink
assert pipe.getvalue() == expected, 'frames were duplicated, reordered, or lost'
assert not list(frames.iterdir())
assert attempts == {'open':3,'unlink':3}, attempts
print(json.dumps({'exactFrames':97, 'openAttempts':attempts['open'], 'releaseAttempts':attempts['unlink']}))
`, script, root], { cwd: root, timeoutMs: 15000, maxStdoutBytes: 10000, maxStderrBytes: 10000 });
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ exactFrames: 97, openAttempts: 3, releaseAttempts: 3 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('bounds persistent denial, honors cancellation, and does not retry missing files or disk-full errors', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-frame-denial-'));
    try {
      const script = await writeStoryboundSidecarScript(root);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', String.raw`
import errno, json, runpy, sys, threading, time
retry = runpy.run_path(sys.argv[1])['retry_frame_file_operation']
stop = threading.Event(); calls = 0
def denied():
    global calls
    calls += 1
    raise PermissionError(errno.EACCES, 'persistent denial')
started = time.monotonic()
try: retry(denied, stop, 'Release frame 48', timeout_seconds=0.04)
except RuntimeError as e:
    assert 'Release frame 48 timed out' in str(e)
    assert isinstance(e.__cause__, PermissionError)
else: raise AssertionError('persistent denial was swallowed')
assert 1 < calls < 10 and time.monotonic()-started < 1
stop.set(); before = calls
try: retry(denied, stop, 'Open frame 48')
except RuntimeError as e: assert 'cancelled' in str(e)
else: raise AssertionError('cancellation ignored')
assert calls == before
stop.clear()
for code in (errno.ENOENT, errno.ENOSPC):
    count = [0]
    def permanent():
        count[0] += 1
        raise OSError(code, 'permanent failure')
    try: retry(permanent, stop, 'Open frame 48')
    except OSError as e: assert e.errno == code
    else: raise AssertionError('permanent failure swallowed')
    assert count[0] == 1
print(json.dumps({'bounded':True,'cancelled':True,'noBlindRetry':True}))
`, script], { cwd: root, timeoutMs: 15000, maxStdoutBytes: 10000, maxStderrBytes: 10000 });
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ bounded: true, cancelled: true, noBlindRetry: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('Windows media process launch contention', () => {
  it('only retries failed process creation and keeps permanent denial bounded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storydream-media-launch-'));
    try {
      const script = await writeStoryboundSidecarScript(root);
      const result = await runBoundedProcess(resolvePythonRuntimeInfo().command, ['-c', String.raw`
import json, runpy, sys, types
fn = runpy.run_path(sys.argv[1])['start_media_process']; g=fn.__globals__
calls = []; result = object(); sleeps = []
def launch(*args, **kwargs):
    calls.append(1)
    if len(calls) < 3:
        error = PermissionError('temporarily locked'); error.winerror=5; raise error
    return result
g['os']=types.SimpleNamespace(name='nt'); g['time']=types.SimpleNamespace(sleep=lambda seconds:sleeps.append(seconds))
g['subprocess']=types.SimpleNamespace(Popen=launch)
assert fn(['encoder'],{}) is result and len(calls)==3 and len(sleeps)==2
calls.clear(); sleeps.clear()
def denied(*args, **kwargs):
    calls.append(1); error=PermissionError('permanent denial'); error.winerror=5; raise error
g['subprocess']=types.SimpleNamespace(Popen=denied)
try: fn(['encoder'],{})
except PermissionError: pass
else: raise AssertionError('denial swallowed')
assert len(calls)==5 and len(sleeps)==4
calls.clear(); g['os']=types.SimpleNamespace(name='posix')
try: fn(['encoder'],{})
except PermissionError: pass
else: raise AssertionError('POSIX permission denial swallowed')
assert len(calls)==1
print(json.dumps({'recovered':True,'bounded':True,'noProcessReplay':True}))
`, script], { cwd: root, timeoutMs: 15000, maxStdoutBytes: 10000, maxStderrBytes: 10000 });
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({ recovered: true, bounded: true, noProcessReplay: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('frame-count capture deadline', () => {
  it('retains the short-scene budget and budgets long films without lowering fps', () => {
    expect(htmlVideoFrameCaptureTimeoutMs(97)).toBe(30 * 60_000);
    expect(htmlVideoFrameCaptureTimeoutMs(12175)).toBe(3_643_750);
    expect(htmlVideoFrameCaptureTimeoutMs(12175)).toBeGreaterThan(12175 / 6.3 * 1000 + 600_000);
    expect(htmlVideoFrameCaptureTimeoutMs(24000)).toBeGreaterThan(htmlVideoFrameCaptureTimeoutMs(12175));
  });
  it.each([0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER])('rejects invalid or overflowing frame counts: %s', count => {
    expect(() => htmlVideoFrameCaptureTimeoutMs(count)).toThrow();
  });
});
