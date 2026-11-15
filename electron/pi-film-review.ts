import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderLemoUpstreamStills } from './lemo-upstream-stills';
import { probeLemoPage, type LemoPageProbeReceipt } from './pi-lemo-page-probe';
import type { LemoUpstreamRenderRuntime } from './lemo-upstream-video';

export interface PiFilmReviewOptions {
  runtime: LemoUpstreamRenderRuntime; upstreamRoot: string; filmDir: string; outputDir: string;
  durationSeconds: number; fps: number; width: number; height: number;
  times: number[]; captionMode: 'film' | 'host'; signal?: AbortSignal;
}
/** Host review uses the same staged library/browser as final export. This is technical evidence only. */
export async function reviewPiFilm(options: PiFilmReviewOptions) {
  const page = await probeLemoPage(options);
  const stills = await renderLemoUpstreamStills({ ...options, captions: options.captionMode === 'film' ? 1 : 0, timeoutMs: 180_000 });
  const hashes = await Promise.all(stills.frames.map(async frame => ({ ...frame, sha256: createHash('sha256').update(await readFile(frame.path)).digest('hex') })));
  const receipt = { version: 1, page, stills: { ...stills, frames: hashes }, technicalPassed: page.technicalPassed && stills.technicalPassed,
    readingPassed: false, aestheticReview: false };
  await mkdir(options.outputDir, { recursive: true });
  await writeFile(join(options.outputDir, 'technical-review.json'), JSON.stringify(receipt, null, 2), 'utf8');
  return receipt;
}

/** Only observed points are checked here; no sparse samples are expanded into continuous coverage. */
export function piCaptionSampleErrors(page: LemoPageProbeReceipt, cues: readonly { id: string; text: string; startMs: number; endMs: number }[], mode: 'film' | 'host'): string[] {
  const errors = new Set<string>();
  for (const sample of page.modes.find(m => m.captions === 0)?.samples ?? []) {
    if (sample.texts.some(t => String(t.id).startsWith('cap:'))) errors.add('PI_CAPTION_SWITCH_FAILED');
  }
  if (mode === 'host') return [...errors];
  const samples = page.modes.find(m => m.captions === 1)?.samples ?? [];
  if (!samples.length) errors.add('PI_CAPTION_EVIDENCE_MISSING');
  for (const sample of samples) {
    if (!sample.textsPresent) { errors.add('PI_CAPTION_TEXTS_MISSING'); continue; }
    const active = cues.filter(cue => sample.time * 1000 >= cue.startMs && sample.time * 1000 < cue.endMs);
    for (const cue of active) {
      const box = sample.texts.find(t => t.id === 'cap:' + cue.id);
      if (!box) errors.add('PI_CAPTION_MISSING:' + cue.id);
      else {
        if (box.text !== cue.text) errors.add('PI_CAPTION_TEXT_MISMATCH:' + cue.id);
        if (box.x0 < page.width * .05 || box.x1 > page.width * .95 || box.y0 < page.height * .05 || box.y1 > page.height * .95) errors.add('PI_CAPTION_SAFE_AREA:' + cue.id);
      }
    }
  }
  return [...errors];
}
