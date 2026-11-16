"""Trusted data-only score renderer. Never imports agent modules or evaluates source.
Only stdlib + bundled numpy; sample decoding uses the host-selected bundled ffmpeg.
All CLI paths are host-owned. score.json/foley.json cannot contain paths or code.
"""
import argparse
import json
import math
import os
from pathlib import Path
import struct
import subprocess
from collections import OrderedDict

os.environ['OPENBLAS_NUM_THREADS'] = '1'
os.environ['OMP_NUM_THREADS'] = '1'
import numpy as np

SR = 48000
MAX_JSON = 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError(message)


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'SCORE_DUPLICATE_KEY')
        result[key] = value
    return result


def load(path, limit=MAX_JSON):
    require(path.stat().st_size <= limit, 'SCORE_JSON_SIZE')
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('SCORE_NONFINITE')))


def obj(value, required, optional=()):
    require(type(value) is dict and set(required) <= value.keys()
            and value.keys() <= set(required) | set(optional), 'SCORE_SCHEMA')


def num(value, low, high, integer=False):
    require(type(value) in (int, float) and math.isfinite(value) and low <= value <= high
            and (not integer or type(value) is int), 'SCORE_NUMBER')
    return value


def sample_path(root, name):
    require(type(name) is str and '\\' not in name and ':' not in name
            and not name.startswith('/') and all(p not in ('', '.', '..') for p in name.split('/')), 'SCORE_SAMPLE_PATH')
    path = root / name
    # Reject package links, including directory junction escapes.
    current = root
    for part in name.split('/'):
        current = current / part
        require(not current.is_symlink(), 'SCORE_SAMPLE_LINK')
    require(path.resolve().is_relative_to(root.resolve()) and path.is_file(), 'SCORE_SAMPLE_MISSING')
    require(path.suffix.lower() in ('.wav', '.flac'), 'SCORE_SAMPLE_FORMAT')
    return path


def validate(score, foley, duration, installed):
    obj(score, ('version', 'tracks'))
    obj(foley, ('version', 'events'))
    require(type(score['version']) is int and score['version'] == 1
            and type(foley['version']) is int and foley['version'] == 1, 'SCORE_VERSION')
    require(type(score['tracks']) is list and len(score['tracks']) <= 32, 'SCORE_TRACK_LIMIT')
    require(type(foley['events']) is list and len(foley['events']) <= 256, 'SCORE_EVENT_LIMIT')
    notes = []
    for track in score['tracks']:
        obj(track, ('instrument', 'notes'))
        require(type(track['instrument']) is str and track['instrument'] in installed, 'SCORE_INSTRUMENT_NOT_INSTALLED')
        require(type(track['notes']) is list, 'SCORE_SCHEMA')
        for note in track['notes']:
            obj(note, ('midi', 'velocity', 'time', 'duration'), ('gain', 'pan'))
            num(note['midi'], 0, 127, True)
            num(note['velocity'], 0, 1)
            notes.append((track['instrument'], note))
    require(len(notes) <= 1000, 'SCORE_NOTE_LIMIT')
    for event in foley['events']:
        obj(event, ('preset', 'time', 'duration'), ('gain', 'pan'))
        require(type(event['preset']) is str and event['preset'] in ('click', 'whoosh', 'impact', 'noise'), 'SCORE_PRESET')
    events = [n for _, n in notes] + foley['events']
    for event in events:
        num(event['time'], 0, 198)
        num(event['duration'], 1 / SR, 198)
        num(event.get('gain', 1), 0, 2)
        num(event.get('pan', 0), -1, 1)
        require(event['time'] + event['duration'] <= duration + 1e-9, 'SCORE_TIMING_BOUNDS')
    require(sum(e['duration'] for e in events) <= 1800, 'SCORE_WORK_LIMIT')
    return notes


class Samples:
    def __init__(self, root, ffmpeg, index):
        self.root, self.ffmpeg, self.index = root, ffmpeg, index
        self.cache = OrderedDict()
        self.bytes = 0

    def pick(self, instrument, midi, velocity):
        zones = self.index[instrument]['zones']
        layers = sorted({z['vel'] for z in zones if z.get('vel') is not None})
        def vp(z):
            return .8 if len(layers) < 2 or z.get('vel') is None else (layers.index(z['vel']) + .5) / len(layers)
        # Root includes the upstream index's measured tuning and octave corrections.
        return min(zones, key=lambda z: abs(z['root'] - midi) + 4 * abs(vp(z) - velocity))

    def decode(self, zone):
        key = zone['f']
        if key in self.cache:
            self.cache.move_to_end(key)
            return self.cache[key]
        path = sample_path(self.root, key)
        # A decoder subprocess is bounded to 30 seconds of mono data and 15 wall seconds.
        result = subprocess.run([self.ffmpeg, '-v', 'error', '-nostdin', '-threads', '1',
            '-protocol_whitelist', 'file,pipe', '-i', str(path), '-t', '30', '-vn',
            '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'],
            capture_output=True, timeout=15, check=True)
        require(len(result.stdout) <= 30 * SR * 4, 'SCORE_DECODE_SIZE')
        data = np.frombuffer(result.stdout, dtype='<f4').copy()
        require(data.size > 0 and np.isfinite(data).all(), 'SCORE_SAMPLE_INVALID')
        # Honor the installed index's onset trim; this is not an output-onset measurement.
        onset = int(round(float(zone.get('on', 0)) * SR / float(zone.get('sr', SR))))
        data = data[max(0, onset):]
        require(data.size > 1, 'SCORE_SAMPLE_EMPTY')
        while self.cache and self.bytes + data.nbytes > 32 * 1024 * 1024:
            _, old = self.cache.popitem(last=False)
            self.bytes -= old.nbytes
        self.cache[key] = data
        self.bytes += data.nbytes
        return data

    def note(self, instrument, note, count):
        zone = self.pick(instrument, note['midi'], note['velocity'])
        raw = self.decode(zone)
        ratio = 2 ** ((note['midi'] - float(zone['root'])) / 12)
        # Decaying bass ends naturally; sustained sax/erhu repeat a crossfaded steady region.
        positions = np.arange(count, dtype=np.float64) * ratio
        out = np.interp(positions, np.arange(len(raw)), raw, right=0).astype(np.float32)
        if instrument in ('alto_sax', 'erhu') and positions[-1] >= len(raw):
            a, b = int(len(raw) * .35), int(len(raw) * .85)
            width = min(int(.04 * SR), (b - a) // 4)
            if width > 1:
                # A periodic loop with a crossfaded seam; no sharp jump when wrapping.
                loop = raw[a:b].copy()
                fade = np.linspace(0, 1, width, dtype=np.float32)
                loop[:width] = loop[:width] * fade + loop[-width:] * (1 - fade)
                loop = loop[:-width]
                mask = positions >= a
                out[mask] = np.interp((positions[mask] - a) % len(loop), np.arange(len(loop)), loop)
        rms = max(float(zone.get('rms', .1)), .005)
        gain = min(4, .1 / rms) * 10 ** (max(-24, min(12, float(zone.get('db', 0)))) / 20)
        return out * np.float32(gain * note['velocity'])


def envelope(data):
    n = len(data)
    attack, release = min(n // 2, 240), min(n // 2, 1440)
    if attack:
        data[:attack] *= np.linspace(0, 1, attack, dtype=np.float32)
    if release:
        data[-release:] *= np.linspace(1, 0, release, dtype=np.float32)
    return data


def effect(preset, count, seed):
    t = np.arange(count, dtype=np.float64) / SR
    noise = np.random.default_rng(seed).standard_normal(count).astype(np.float32)
    if preset == 'click':
        data = (noise * .3 + np.sin(2 * np.pi * 2900 * t)) * np.exp(-t / .012)
    elif preset == 'impact':
        data = (np.sin(2 * np.pi * 65 * t) + noise * .25) * np.exp(-t / .09)
    elif preset == 'whoosh':
        data = np.convolve(noise, np.ones(9) / 9, mode='same')[:count] * np.sin(np.linspace(0, np.pi, count)) ** 2
    else:
        data = np.convolve(noise, np.ones(33) / 33, mode='same')[:count] * .3
    return np.asarray(data, dtype=np.float32) * .35


def write_wav(path, data):
    # IEEE float32 RIFF WAV, avoiding soundfile/scipy dependencies and encode copies.
    size = data.nbytes
    with path.open('xb') as stream:
        stream.write(b'RIFF' + struct.pack('<I', 48 + size) + b'WAVEfmt ')
        stream.write(struct.pack('<IHHIIHH', 16, 3, 2, SR, SR * 8, 8, 32))
        stream.write(b'fact' + struct.pack('<II', 4, len(data)))
        stream.write(b'data' + struct.pack('<I', size))
        data.astype('<f4', copy=False).tofile(stream)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    config = load(Path(args.config))
    obj(config, ('durationSeconds', 'instrumentsRoot', 'ffmpegPath', 'outputDir'))
    duration = num(config['durationSeconds'], 1 / SR, 198)
    root, output = Path(config['instrumentsRoot']).resolve(), Path(config['outputDir']).resolve()
    index = load(root / 'index.json', 16 * MAX_JSON)
    installed = {}
    for name, entry in index.items():
        require(type(name) is str and name.isascii() and len(name) <= 64
                and name.replace('_', '').isalnum(), 'SCORE_INDEX_ID')
        if not entry.get('zones'):
            continue
        for zone in entry['zones']:
            sample_path(root, zone['f'])
            num(zone.get('root'), -128, 255)
        installed[name] = entry
    score, foley = load(output / 'score.json'), load(output / 'foley.json')
    notes = validate(score, foley, duration, installed)
    samples = Samples(root, config['ffmpegPath'], installed)
    frames = int(math.floor(duration * SR + .5))
    result = {'stems': {}, 'installedInstruments': sorted(installed), 'metadata': [], 'events': []}
    # One stem in memory at a time (69 MB maximum); bounded decode cache and event work.
    for stem in ('music', 'ambience', 'sfx'):
        buf = np.zeros((frames, 2), dtype=np.float32)
        events = notes if stem == 'music' else [(None, e) for e in foley['events']
                  if (e['preset'] == 'noise') == (stem == 'ambience')]
        for i, (instrument, event) in enumerate(events):
            start = int(math.floor(event['time'] * SR + .5))
            end = min(frames, int(math.floor((event['time'] + event['duration']) * SR + .5)))
            count = end - start
            require(count > 0, 'SCORE_SUBFRAME_EVENT')
            data = samples.note(instrument, event, count) if instrument else effect(event['preset'], count, i + 7)
            envelope(data)
            angle = (event.get('pan', 0) + 1) * math.pi / 4
            gain = event.get('gain', 1)
            buf[start:end, 0] += data * (gain * math.cos(angle))
            buf[start:end, 1] += data * (gain * math.sin(angle))
            result['events'].append({'stem': stem, 'startFrame': start, 'endFrame': end, 'provenance': 'scheduled'})
        require(np.isfinite(buf).all(), 'SCORE_OUTPUT_NONFINITE')
        path = output / (stem + '.wav')
        write_wav(path, buf)
        result['stems'][stem] = str(path)
        result['metadata'].append({'stem': stem, 'durationSeconds': frames / SR, 'frames': frames,
            'sampleRate': SR, 'channels': 2, 'format': 'float32', 'peakAmplitude': float(np.max(np.abs(buf))), 'nonFiniteSamples': 0})
    (output / 'metadata.json').write_text(json.dumps(result, allow_nan=False), encoding='utf-8')


if __name__ == '__main__':
    main()
