import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { HtmlVideoTimedCaptionCue } from '../src/shared/types';

export function buildSapiWordTimings(
  text: string,
  inputEvents: readonly { charIndex: number; audioMs: number }[],
  durationMs: number,
  offsetMs = 0,
) {
  const events = inputEvents
    .filter((event) => Number.isInteger(event.charIndex) && event.charIndex >= 0 && event.charIndex < text.length && Number.isFinite(event.audioMs))
    .sort((left, right) => left.charIndex - right.charIndex || left.audioMs - right.audioMs);
  if (!events.length || events[0].charIndex !== 0) throw new Error('SAPI did not report word starts for cue');

  const validEvents: typeof events = [];
  for (const event of events) {
    const previous = validEvents.at(-1);
    if (previous && (event.charIndex === previous.charIndex || event.audioMs <= previous.audioMs)) continue;
    if (event.audioMs < 0 || event.audioMs >= durationMs) continue;
    validEvents.push(event);
  }
  if (!validEvents.length || validEvents[0].charIndex !== 0) throw new Error('SAPI did not report a valid first word boundary');

  const words = validEvents.map((event, index) => {
    const next = validEvents[index + 1];
    const startMs = Math.max(0, Math.round(event.audioMs));
    const endMs = Math.min(Math.round(durationMs), Math.round(next?.audioMs ?? durationMs));
    const wordText = text.slice(event.charIndex, next?.charIndex ?? text.length);
    if (!wordText || endMs <= startMs) throw new Error('Invalid SAPI word boundary');
    return { text: wordText, startSec: (offsetMs + startMs) / 1000, endSec: (offsetMs + endMs) / 1000 };
  });
  if (words.map((word) => word.text).join('') !== text) throw new Error('SAPI word spans do not cover cue');

  return {
    words,
    tailMerged: validEvents.length !== inputEvents.length,
  };
}

/** Offline SAPI narration with measured sentence timing. */
export async function prepareQaNarration(directory: string, sentences: readonly (readonly string[])[]) {
  await mkdir(directory, { recursive: true });
  const items = sentences.flatMap((lines, scene) => lines.map((text, cue) => ({ text, path: join(directory, `${scene}-${cue}.wav`) })));
  const manifest = join(directory, 'speech-manifest.json');
  await writeFile(manifest, JSON.stringify(items, null, 2), 'utf8');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', resolve('scripts/qa-animation-voices.ps1'), '-Manifest', manifest], { windowsHide: true, timeout: 120000 });
  const results = [];
  for (const [scene, lines] of sentences.entries()) {
    const segments = await Promise.all(lines.map(async (_, cue) => readFile(join(directory, `${scene}-${cue}.wav`))));
    const pcm: Buffer[] = []; let format: Buffer | undefined; let elapsed = 0;
    const captionCues: HtmlVideoTimedCaptionCue[] = [];
    for (const [cue, wav] of segments.entries()) {
      let data: Buffer | undefined, fmt: Buffer | undefined;
      for (let pos = 12; pos + 8 <= wav.length;) {
        const length = wav.readUInt32LE(pos + 4), id = wav.toString('ascii', pos, pos + 4);
        if (id === 'fmt ') fmt = wav.subarray(pos + 8, pos + 8 + length);
        if (id === 'data') data = wav.subarray(pos + 8, pos + 8 + length);
        pos += 8 + length + length % 2;
      }
      if (!fmt || !data || fmt.readUInt16LE(0) !== 1) throw new Error('QA narration must be PCM WAV');
      if (format && !format.equals(fmt)) throw new Error('QA narration formats differ');
      format = fmt;
      const duration = data.length / fmt.readUInt32LE(8);
      captionCues.push({ text: lines[cue], startSec: elapsed, endSec: elapsed + duration, source: 'tts', confidence: 1 });
      elapsed += duration; pcm.push(data);
    }
    const raw = Buffer.concat(pcm), header = Buffer.alloc(28 + format!.length);
    header.write('RIFF'); header.writeUInt32LE(header.length + raw.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(format!.length, 16); format!.copy(header, 20);
    header.write('data', 20 + format!.length); header.writeUInt32LE(raw.length, 24 + format!.length);
    const path = join(directory, `scene-${scene + 1}.wav`);
    await writeFile(path, Buffer.concat([header, raw]));
    results.push({ path, durationMs: Math.ceil(elapsed * 1000), captionCues });
  }
  await writeFile(join(directory, 'timing.json'), JSON.stringify(results, null, 2), 'utf8');
  return results;
}

export async function prepareQaNarrationWithWordTimings(directory: string, sentences: readonly (readonly string[])[]) {
  await mkdir(directory, { recursive: true });
  const items = sentences.flatMap((lines, scene) => lines.map((text, cue) => ({ text, path: join(directory, `${scene}-${cue}.wav`), eventsPath: join(directory, `${scene}-${cue}.events.json`) })));
  const manifest = join(directory, 'word-speech-manifest.json');
  await writeFile(manifest, JSON.stringify(items, null, 2), 'utf8');
  await promisify(execFile)('powershell.exe', ['-NoProfile', '-File', resolve('scripts/qa-animation-voices-words.ps1'), '-Manifest', manifest], { windowsHide: true, timeout: 120000 });
  const results = [];
  for (const [scene, lines] of sentences.entries()) {
    const segments = await Promise.all(lines.map(async (_, cue) => ({
      wav: await readFile(join(directory, `${scene}-${cue}.wav`)),
      events: JSON.parse(await readFile(join(directory, `${scene}-${cue}.events.json`), 'utf8')) as Array<{ charIndex: number; audioMs: number }>,
    })));
    const pcm: Buffer[] = []; let format: Buffer | undefined; let elapsed = 0;
    const captionCues: Array<HtmlVideoTimedCaptionCue & { words: Array<{ text: string; startSec: number; endSec: number }>; wordTimingQuality?: 'measured' | 'tail-merged' }> = [];
    for (const [cueIndex, segment] of segments.entries()) {
      let data: Buffer | undefined, fmt: Buffer | undefined;
      for (let pos = 12; pos + 8 <= segment.wav.length;) {
        const length = segment.wav.readUInt32LE(pos + 4), id = segment.wav.toString('ascii', pos, pos + 4);
        if (id === 'fmt ') fmt = segment.wav.subarray(pos + 8, pos + 8 + length);
        if (id === 'data') data = segment.wav.subarray(pos + 8, pos + 8 + length);
        pos += 8 + length + length % 2;
      }
      if (!fmt || !data || fmt.readUInt16LE(0) !== 1) throw new Error('QA narration must be PCM WAV');
      if (format && !format.equals(fmt)) throw new Error('QA narration formats differ');
      format = fmt;
      const durationMs = data.length / fmt.readUInt32LE(8) * 1000;
      let aligned: ReturnType<typeof buildSapiWordTimings>;
      try {
        aligned = buildSapiWordTimings(lines[cueIndex], segment.events, durationMs, elapsed);
      } catch (error) {
        throw new Error(`Invalid SAPI word boundaries for cue ${scene + 1}:${cueIndex + 1}`, { cause: error });
      }
      captionCues.push({ text: lines[cueIndex], startSec: elapsed / 1000, endSec: (elapsed + durationMs) / 1000, source: 'tts', confidence: 1, words: aligned.words,
        ...(aligned.tailMerged ? { wordTimingQuality: 'tail-merged' as const } : {}) });
      elapsed += durationMs; pcm.push(data);
    }
    const raw = Buffer.concat(pcm), header = Buffer.alloc(28 + format!.length);
    header.write('RIFF'); header.writeUInt32LE(header.length + raw.length, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(format!.length, 16); format!.copy(header, 20);
    header.write('data', 20 + format!.length); header.writeUInt32LE(raw.length, 24 + format!.length);
    const path = join(directory, `scene-${scene + 1}.wav`);
    await writeFile(path, Buffer.concat([header, raw]));
    results.push({ path, durationMs: Math.ceil(elapsed), captionCues });
  }
  await writeFile(join(directory, 'word-timing.json'), JSON.stringify(results, null, 2), 'utf8');
  return results;
}
