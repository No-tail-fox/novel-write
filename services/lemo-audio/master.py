"""Trusted data-only host mixer. Never imports or executes agent-generated source.

48 kHz stereo float32, disk-backed tracks and 32768-frame working chunks. Timeline
coordinates are immutable; approved pauses validate narration gaps, not insertions.
J/L transitions describe already-rendered stems and do not shift audio here.
"""
import argparse
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile

import numpy as np

RATE = 48000
CHUNK = 32768
TARGET = 'loudnorm=I=-14:TP=-1.2:LRA=11'


def ffmpeg(config, args):
    result = subprocess.run([config['ffmpegPath'], '-nostdin', '-hide_banner', '-y',
                             '-threads', '1', *args], capture_output=True, timeout=120,
                            encoding='utf-8', errors='replace', shell=False)
    if result.returncode:
        raise ValueError('FFMPEG_FAILED: ' + result.stderr[-8000:])
    return result.stderr


def frame(seconds):
    return int(math.floor(seconds * RATE + 0.5))


def blocks(length):
    for start in range(0, length, CHUNK):
        yield start, min(start + CHUNK, length)


def measurement(data):
    peak, nonfinite = 0.0, 0
    for a, b in blocks(len(data)):
        chunk = np.asarray(data[a:b])
        finite = np.isfinite(chunk)
        nonfinite += int(chunk.size - np.count_nonzero(finite))
        peak = max(peak, float(np.max(np.abs(chunk), where=finite, initial=0)))
    return dict(durationSeconds=len(data) / RATE, sampleRate=RATE, channels=2,
                format='float32', peakAmplitude=peak, nonFiniteSamples=nonfinite)


def close(data):
    data.flush()
    data._mmap.close()


def decode(config, source, dest, source_start=0, length=None):
    # Restrict protocols even for containers that can reference remote resources.
    args = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', source]
    if source_start:
        args += ['-ss', str(source_start)]
    args += ['-t', str(length if length is not None else 198 + 1 / RATE),
             '-map', '0:a:0', '-vn', '-ar', str(RATE), '-ac', '2',
             '-c:a', 'pcm_f32le', '-f', 'f32le', str(dest)]
    ffmpeg(config, args)
    size = dest.stat().st_size
    if not size or size % 8:
        raise ValueError('AUDIO_DECODE_EMPTY_OR_INVALID')
    return np.memmap(dest, dtype='<f4', mode='r+', shape=(size // 8, 2))


def raw_input(path):
    return ['-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-i', str(path)]


def loudness(config, path):
    log = ffmpeg(config, ['-i', str(path), '-af', TARGET + ':print_format=json', '-f', 'null', '-'])
    matches = re.findall(r'\{\s*"input_i".*?\}', log, re.S)
    if not matches:
        raise ValueError('AUDIO_LOUDNESS_MEASUREMENT_MISSING')
    return json.loads(matches[-1])


def finite_or_none(value):
    number = float(value)
    return number if math.isfinite(number) else None


def window_peak(data, t0, t1):
    a, b = frame(t0), frame(t1)
    if b <= a:
        raise ValueError('AUDIO_INTERVAL_BELOW_ONE_SAMPLE')
    peak = 0.0
    for offset in range(a, b, CHUNK):
        peak = max(peak, float(np.max(np.abs(data[offset:min(offset + CHUNK, b)]), initial=0)))
    return peak


def duck_envelope(a, b, cues, attack, release, db):
    # Linear dB ramps reach full duck at cue start and release after cue end.
    # Overlapping cue ramps combine by strongest attenuation, never summation.
    positions = np.arange(a, b, dtype=np.float64)
    envelope = np.zeros(b - a, dtype=np.float64)
    for cue in cues:
        start, end = frame(cue['t0']), frame(cue['t1'])
        strength = ((positions >= start) & (positions < end)).astype(np.float64)
        if attack > 0:
            strength = np.maximum(strength, np.where(positions < start,
                np.clip((positions - (start - attack)) / attack, 0, 1), 0))
        if release > 0:
            strength = np.maximum(strength, np.where(positions >= end,
                np.clip(1 - (positions - end) / release, 0, 1), 0))
        envelope = np.maximum(envelope, strength)
    return np.power(10.0, envelope * db / 20.0).astype(np.float32)


def main(config):
    duration = config['durationSeconds']
    if not math.isfinite(duration) or not 0 < duration <= 198:
        raise ValueError('AUDIO_DURATION_INVALID')
    count = frame(duration)
    if count < 1:
        raise ValueError('AUDIO_DURATION_BELOW_ONE_SAMPLE')
    output = Path(config['outputDir'])
    mix = config['mix']
    report = dict(outputPath=str(output / 'master.wav'), premasterPath=str(output / 'premaster.wav'),
                  metadataPath=str(output / 'metadata.json'), stems=[], silenceMeasurements=[],
                  pauseMeasurements=[], narration=[dict(t0=n['t0'], t1=n['t1']) for n in config['narration']], onsets=[])
    with tempfile.TemporaryDirectory(prefix='work-', dir=output) as work:
        work = Path(work)
        total = np.memmap(work / 'sum.f32', dtype='<f4', mode='w+', shape=(count, 2))
        total[:] = 0
        narration = np.memmap(work / 'narration.f32', dtype='<f4', mode='w+', shape=(count, 2))
        narration[:] = 0
        try:
            for index, cue in enumerate(config['narration']):
                a, b = frame(cue['t0']), frame(cue['t1'])
                if not 0 <= a < b <= count:
                    raise ValueError('AUDIO_NARRATION_BOUNDS')
                decoded = decode(config, cue['path'], work / f'cue-{index}.f32', cue['sourceStartSeconds'], (b - a) / RATE)
                try:
                    measured = measurement(decoded)
                    if measured['nonFiniteSamples']:
                        raise ValueError('AUDIO_NONFINITE: ' + json.dumps(measured))
                    if len(decoded) != b - a:
                        raise ValueError('AUDIO_NARRATION_SLICE_TOO_SHORT')
                    for start, end in blocks(b - a):
                        narration[a + start:a + end] += decoded[start:end] * (10 ** (cue['gainDb'] / 20))
                finally:
                    close(decoded)
                (work / f'cue-{index}.f32').unlink()
            for pause in config['approvedPauses']:
                if any(cue['t0'] < pause['t1'] and cue['t1'] > pause['t0'] for cue in config['narration']):
                    raise ValueError('AUDIO_PAUSE_NARRATION_OVERLAP')
                report['pauseMeasurements'].append(dict(**pause, peakAmplitude=window_peak(narration, **pause), provenance='measured'))
            tracks = list(config['stems']) + (['narration'] if config['narration'] else [])
            for name in tracks:
                data = narration if name == 'narration' else decode(config, config['stems'][name], work / f'{name}.f32')
                try:
                    measured = measurement(data)
                    if name != 'narration':
                        report['stems'].append(dict(stem=name, **measured))
                    if measured['nonFiniteSamples']:
                        raise ValueError('AUDIO_NONFINITE: ' + json.dumps(measured))
                    # Stems are full-timeline renders; never silently pad, crop or stretch them.
                    if len(data) != count:
                        raise ValueError(f'AUDIO_STEM_DURATION: {name}: {len(data) / RATE} != {count / RATE}')
                    gain = 1 if name == 'narration' else 10 ** (mix['stems'][name]['gainDb'] / 20)
                    for a, b in blocks(count):
                        chunk = np.array(data[a:b], copy=True) * gain
                        if name in ('music', 'ambience') and name in mix['duck']:
                            duck = mix['duck']
                            chunk *= duck_envelope(a, b, config['narration'], duck['attackMs'] * RATE / 1000,
                                                   duck['releaseMs'] * RATE / 1000, duck[name])[:, None]
                        data[a:b] = chunk
                        total[a:b] += chunk
                    for index, silence in enumerate(mix['silences']):
                        report['silenceMeasurements'].append(dict(silenceIndex=index, stem=name,
                            peakAmplitude=window_peak(data, silence['t0'], silence['t1']), provenance='measured',
                            method='decoded 48000 Hz stereo full-window absolute sample maximum after gain and duck, before mastering'))
                finally:
                    if name != 'narration':
                        close(data)
                        (work / f'{name}.f32').unlink()
            report['premaster'] = measurement(total)
            if report['premaster']['nonFiniteSamples']:
                raise ValueError('AUDIO_MIX_NONFINITE')
            total.flush()
            ffmpeg(config, ['-v', 'error', *raw_input(work / 'sum.f32'), '-c:a', 'pcm_f32le', report['premasterPath']])
        finally:
            close(total)
            close(narration)
        first = loudness(config, report['premasterPath'])
        finite = all(finite_or_none(first[k]) is not None for k in ('input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'))
        filters = 'anull'
        if finite:
            filters = TARGET + ''.join(':' + key + '=' + first[value] for key, value in (
                ('measured_I', 'input_i'), ('measured_TP', 'input_tp'), ('measured_LRA', 'input_lra'),
                ('measured_thresh', 'input_thresh'), ('offset', 'target_offset'))) + ':linear=true'
        # No peak-normalizing/attenuation prepass: loudnorm can amplify quiet inputs.
        # Explicit resampling after loudnorm avoids its dynamic-mode 192 kHz output.
        filters += f',aresample={RATE},apad=whole_len={count},atrim=end_sample={count}'
        ffmpeg(config, ['-v', 'error', '-i', report['premasterPath'], '-af', filters,
                       '-ar', str(RATE), '-ac', '2', '-c:a', 'pcm_f32le', report['outputPath']])
        final = decode(config, report['outputPath'], work / 'final.f32')
        try:
            report['master'] = measurement(final)
            if len(final) != count or report['master']['nonFiniteSamples']:
                raise ValueError('AUDIO_MASTER_INVALID')
        finally:
            close(final)
        measured = loudness(config, report['outputPath'])
        report['loudness'] = dict(integratedLufs=finite_or_none(measured['input_i']),
                                 truePeakDbtp=finite_or_none(measured['input_tp']), targetLufs=-14, targetTruePeakDbtp=-1.2)
    Path(report['metadataPath']).write_text(json.dumps(report, allow_nan=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    main(json.loads(Path(args.config).read_text(encoding='utf-8')))
