"""Windows-only external process-tree memory benchmark. No network or paid calls.

Run with vendor/python/python.exe scripts/qa-html-video-benchmark.py --case hd
Cases: hd (six scenes), hd-long (24 scenes), uhd (six scenes), concurrent (two six-scene renders).
Working set counts shared pages per process; it is not unique physical RAM usage.
"""
import argparse
import ctypes as ct
from ctypes import wintypes as wt
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
CASES = {'hd': (1920, 1, 1), 'hd-long': (1920, 4, 1), 'uhd': (3840, 1, 1), 'concurrent': (1920, 1, 2)}


class ProcessEntry(ct.Structure):
    _fields_ = [('dwSize', wt.DWORD), ('cntUsage', wt.DWORD), ('th32ProcessID', wt.DWORD),
                ('th32DefaultHeapID', ct.c_size_t), ('th32ModuleID', wt.DWORD), ('cntThreads', wt.DWORD),
                ('th32ParentProcessID', wt.DWORD), ('pcPriClassBase', wt.LONG), ('dwFlags', wt.DWORD),
                ('szExeFile', wt.WCHAR * 260)]


class MemoryCounters(ct.Structure):
    _fields_ = [('cb', wt.DWORD), ('PageFaultCount', wt.DWORD)] + [
        (name, ct.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize', 'QuotaPeakPagedPoolUsage',
                                       'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage', 'QuotaNonPagedPoolUsage',
                                       'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage')]


class MemoryStatus(ct.Structure):
    _fields_ = [('dwLength', wt.DWORD), ('dwMemoryLoad', wt.DWORD),
                ('ullTotalPhys', ct.c_ulonglong), ('ullAvailPhys', ct.c_ulonglong),
                ('ullTotalPageFile', ct.c_ulonglong), ('ullAvailPageFile', ct.c_ulonglong),
                ('ullTotalVirtual', ct.c_ulonglong), ('ullAvailVirtual', ct.c_ulonglong),
                ('ullAvailExtendedVirtual', ct.c_ulonglong)]


def available_physical_bytes():
    kernel = ct.WinDLL('kernel32', use_last_error=True)
    kernel.GlobalMemoryStatusEx.argtypes = [ct.POINTER(MemoryStatus)]
    kernel.GlobalMemoryStatusEx.restype = wt.BOOL
    status = MemoryStatus()
    status.dwLength = ct.sizeof(status)
    if not kernel.GlobalMemoryStatusEx(ct.byref(status)):
        raise ct.WinError(ct.get_last_error())
    return status.ullAvailPhys


def process_tree_memory(root_pid):
    kernel = ct.WinDLL('kernel32', use_last_error=True)
    psapi = ct.WinDLL('psapi', use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wt.HANDLE
    kernel.Process32FirstW.argtypes = [wt.HANDLE, ct.POINTER(ProcessEntry)]
    kernel.Process32NextW.argtypes = [wt.HANDLE, ct.POINTER(ProcessEntry)]
    kernel.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    kernel.OpenProcess.restype = wt.HANDLE
    kernel.CloseHandle.argtypes = [wt.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [wt.HANDLE, ct.POINTER(MemoryCounters), wt.DWORD]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == wt.HANDLE(-1).value:
        raise ct.WinError(ct.get_last_error())
    table = {}
    try:
        entry = ProcessEntry()
        entry.dwSize = ct.sizeof(entry)
        ok = kernel.Process32FirstW(snapshot, ct.byref(entry))
        while ok:
            table[entry.th32ProcessID] = (entry.th32ParentProcessID, entry.szExeFile)
            ok = kernel.Process32NextW(snapshot, ct.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    included = {root_pid}
    while True:
        expanded = included | {pid for pid, (parent, _) in table.items() if parent in included}
        if expanded == included:
            break
        included = expanded
    processes = []
    for pid in included:
        handle = kernel.OpenProcess(0x0400 | 0x0010, False, pid)
        if not handle:
            continue  # A short-lived child may exit between enumeration and sampling.
        try:
            memory = MemoryCounters()
            memory.cb = ct.sizeof(memory)
            if psapi.GetProcessMemoryInfo(handle, ct.byref(memory), ct.sizeof(memory)):
                processes.append({'pid': pid, 'name': table.get(pid, (0, ''))[1],
                                  'workingSetBytes': memory.WorkingSetSize, 'privateBytes': memory.PrivateUsage})
        finally:
            kernel.CloseHandle(handle)
    return processes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', choices=CASES, default='hd')
    parser.add_argument('--timeout', type=int, default=3600)
    parser.add_argument('--min-start-free-gib', type=float, default=3.5)
    parser.add_argument('--min-free-gib', type=float, default=1.5)
    parser.add_argument('--max-tree-private-gib', type=float, default=3.5)
    parser.add_argument('--min-disk-free-gib', type=float, default=2.0)
    parser.add_argument('--verify-existing', type=Path, help='Re-verify a completed run without rendering again')
    args = parser.parse_args()
    if os.name != 'nt':
        raise RuntimeError('This sampler requires Windows PSAPI')
    if args.verify_existing:
        work = args.verify_existing.resolve()
        report = json.loads((work / 'report.json').read_text(encoding='utf-8'))
        verify_outputs(work, report)
        return 0 if report['status'] == 'passed' else 1
    edge, repeat, concurrency = CASES[args.case]
    free_start = available_physical_bytes()
    disk_free = __import__('shutil').disk_usage(ROOT).free
    if free_start < args.min_start_free_gib * 1024**3:
        print(json.dumps({'status': 'not-started', 'reason': 'insufficient-free-memory',
                          'availableBytes': free_start, 'requiredBytes': int(args.min_start_free_gib * 1024**3)}), flush=True)
        return 2
    if disk_free < args.min_disk_free_gib * 1024**3:
        print(json.dumps({'status': 'not-started', 'reason': 'insufficient-free-disk',
                          'availableBytes': disk_free, 'requiredBytes': int(args.min_disk_free_gib * 1024**3)}), flush=True)
        return 2
    run_id = time.strftime('%Y%m%d-%H%M%S') + '-' + args.case
    work = ROOT / '.artifacts' / 'html-video-benchmark' / run_id
    work.mkdir(parents=True)
    bundle = work / 'benchmark.mjs'
    banner = "import {createRequire as __qaRequire} from 'node:module';const require=__qaRequire(import.meta.url);"
    subprocess.run(['node', str(ROOT / 'node_modules/esbuild/bin/esbuild'),
                    'scripts/qa-html-video-benchmark-entry.ts', '--bundle', '--platform=node', '--format=esm',
                    '--external:electron', '--banner:js=' + banner, '--outfile=' + str(bundle)], cwd=ROOT, check=True)
    environment = dict(os.environ, HTML_BENCH_WORK=str(work), HTML_BENCH_EDGE=str(edge),
                       HTML_BENCH_REPEAT=str(repeat), HTML_BENCH_CONCURRENCY=str(concurrency))
    environment.pop('ELECTRON_RUN_AS_NODE', None)
    started = time.monotonic()
    samples = []
    timed_out = False
    safety_stop = None
    safety_limits = {'minStartFreeBytes': int(args.min_start_free_gib * 1024**3),
                     'minFreeBytes': int(args.min_free_gib * 1024**3),
                     'maxTreePrivateBytes': int(args.max_tree_private_gib * 1024**3),
                     'minDiskFreeBytes': int(args.min_disk_free_gib * 1024**3)}
    with (work / 'stdout.log').open('w', encoding='utf-8') as stdout, (work / 'stderr.log').open('w', encoding='utf-8') as stderr:
        process = subprocess.Popen([str(ROOT / 'node_modules/electron/dist/electron.exe'), str(bundle)],
                                   cwd=ROOT, env=environment, stdout=stdout, stderr=stderr,
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        print(json.dumps({'work': str(work), 'pid': process.pid, 'case': args.case}), flush=True)
        while process.poll() is None:
            members = process_tree_memory(process.pid)
            tree_private = sum(item['privateBytes'] for item in members)
            free_now = available_physical_bytes()
            disk_now = __import__('shutil').disk_usage(ROOT).free
            sample = {'elapsedMs': round((time.monotonic() - started) * 1000), 'processes': members,
                      'workingSetBytes': sum(item['workingSetBytes'] for item in members),
                      'privateBytes': tree_private, 'systemAvailableBytes': free_now, 'diskFreeBytes': disk_now}
            events_path = work / 'events.jsonl'
            try:
                events = events_path.read_text(encoding='utf-8').splitlines()
                sample['lastEvent'] = json.loads(events[-1]) if events else None
            except (OSError, ValueError):
                sample['lastEvent'] = samples[-1].get('lastEvent') if samples else None
            samples.append(sample)
            with (work / 'memory.jsonl').open('a', encoding='utf-8') as stream:
                stream.write(json.dumps(sample) + '\n')
            if tree_private > safety_limits['maxTreePrivateBytes']:
                safety_stop = {'reason': 'process-tree-private-memory-limit', 'observedBytes': tree_private,
                               'limitBytes': safety_limits['maxTreePrivateBytes']}
            elif free_now < safety_limits['minFreeBytes']:
                safety_stop = {'reason': 'system-available-memory-floor', 'observedBytes': free_now,
                               'limitBytes': safety_limits['minFreeBytes']}
            elif disk_now < safety_limits['minDiskFreeBytes']:
                safety_stop = {'reason': 'disk-free-floor', 'observedBytes': disk_now,
                               'limitBytes': safety_limits['minDiskFreeBytes']}
            if safety_stop:
                safety_stop['elapsedMs'] = sample['elapsedMs']
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
                break
            if time.monotonic() - started > args.timeout:
                timed_out = True
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
                break
            time.sleep(0.5)
        exit_code = process.wait(timeout=30)
    rendered = json.loads((work / 'render-report.json').read_text(encoding='utf-8')) if (work / 'render-report.json').exists() else {}
    report = {'case': args.case, 'work': str(work), 'exitCode': exit_code,
              'timedOut': timed_out, 'safetyStop': safety_stop, 'safetyLimits': safety_limits,
              'elapsedSec': round(time.monotonic() - started, 3),
              'render': rendered, 'sampleCount': len(samples), 'sampleIntervalMs': 500,
              'peakWorkingSetBytes': max((item['workingSetBytes'] for item in samples), default=0),
              'peakPrivateBytes': max((item['privateBytes'] for item in samples), default=0),
              'sampling': 'Sum of simultaneous current process-tree working sets/private bytes, Electron plus Python/FFmpeg; shared pages counted per process. No post-hoc sum of individual lifetime peaks.',
              'machine': {'platform': platform.platform(), 'processor': platform.processor(), 'logicalCpuCount': os.cpu_count()},
              'paidCalls': 0}
    verify_outputs(work, report)
    return 0 if report['status'] == 'passed' else 1


def verify_outputs(work, report):
    ffmpeg = next((ROOT / 'vendor/python/Lib/site-packages/imageio_ffmpeg/binaries').glob('ffmpeg*.exe'))
    rendered = report['render']
    verification = []
    for result in rendered.get('results', []):
        output = Path(result['outputPath'])
        decoded = subprocess.run([str(ffmpeg), '-v', 'error', '-threads', '2', '-i', str(output), '-map', '0:v:0', '-map', '0:a:0',
                                  '-f', 'null', '-'], capture_output=True, timeout=600)
        probe = subprocess.run([str(ffmpeg), '-hide_banner', '-i', str(output)], capture_output=True)
        detail = probe.stderr.decode('utf-8', errors='replace')
        video_line = next((line for line in detail.splitlines() if re.search(r'Stream #.*Video:', line)), '')
        dimensions = re.search(r'\b(\d{2,5})x(\d{2,5})\b', video_line)
        fps = re.search(r'([\d.]+) fps', video_line)
        duration = re.search(r'Duration: (\d+):(\d+):([\d.]+)', detail)
        duration_sec = (int(duration[1]) * 3600 + int(duration[2]) * 60 + float(duration[3])) if duration else None
        width, height = (int(dimensions[1]), int(dimensions[2])) if dimensions else (None, None)
        expected = result['authoredDurationSec']
        checks = {'decode': decoded.returncode == 0,
                  'dimensions': width == rendered['longEdge'] and height == rendered['longEdge'] * 9 // 16,
                  'fps': fps is not None and abs(float(fps[1]) - rendered['fps']) < .001,
                  'duration': duration_sec is not None and abs(duration_sec - expected) <= 1 / rendered['fps'] + .03,
                  'scratchCleaned': result.get('scratchCleaned') is True,
                  'nonempty': output.stat().st_size > 0}
        with output.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        verification.append({'path': str(output), 'sha256': digest, 'decodeExitCode': decoded.returncode,
                             'decodeErrors': decoded.stderr.decode('utf-8', errors='replace'), 'probe': detail,
                             'width': width, 'height': height, 'fps': float(fps[1]) if fps else None,
                             'durationSec': duration_sec, 'expectedDurationSec': expected, 'checks': checks})
    samples = [json.loads(line) for line in (work / 'memory.jsonl').read_text(encoding='utf-8').splitlines()]
    grouped = {}
    for sample in samples:
        event = sample.get('lastEvent') or {}
        key = f"run-{event.get('run', 0)}-{event.get('phase', 'startup')}-scene-{event.get('sceneId', 0)}"
        group = grouped.setdefault(key, {'samples': 0, 'peakWorkingSetBytes': 0, 'peakPrivateBytes': 0})
        group['samples'] += 1
        for metric in ('workingSetBytes', 'privateBytes'):
            peak_key = 'peak' + metric[0].upper() + metric[1:]
            group[peak_key] = max(group[peak_key], sample[metric])
    report['memoryByLastEvent'] = grouped
    report['phaseCaveat'] = 'Last scene encode also includes final composition; labels are observation windows, not exclusive CPU stage timings.'
    report['verification'] = verification
    report['status'] = 'passed' if (report['exitCode'] == 0 and not report['timedOut'] and
                                    len(verification) == rendered.get('concurrency') and
                                    all(all(item['checks'].values()) for item in verification)) else 'failed'
    (work / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: report[key] for key in ('status', 'case', 'work', 'elapsedSec', 'peakWorkingSetBytes', 'peakPrivateBytes')}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
