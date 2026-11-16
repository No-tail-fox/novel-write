/** Fixed trusted-host companion. Page supplies observations only; verdicts run in Node. */
export const lemoFilmReadcheckScript = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { openDemo, closeServer } = await import(pathToFileURL(resolve(input.upstreamRoot, 'core/render/page.mjs')).href);
const errors = [], modes = [], step = 1 / input.fps, expectedFrames = Math.ceil(input.durationSeconds * input.fps);
const fail = (code, captions, detail = '') => { if (errors.length < 200 && !errors.some(e => e.code === code && e.captions === captions && e.detail === detail)) errors.push({ code, captions, detail: String(detail).slice(0, 256) }); };
const need = text => { let cjk = 0, other = 0; for (const ch of text) { if (/\s/u.test(ch)) continue; /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch) ? cjk++ : other++; } return Math.max(1.5, cjk / 4.5 + other / 15 + 1.5); };
try {
  for (const captions of (input.captionMode === 'film' ? [1, 0] : [0])) {
    const { browser, page } = await openDemo(input.filmDir, { w: input.width, h: input.height, q: 'captions=' + captions });
    const records = new Map(), cueCounts = new Map(input.cues.map(c => [String(c.id), 0]));
    let sampledFrames = 0, textFrames = 0, captionFrames = 0, safeAreaViolations = 0, intervalCount = 0;
    try {
      for (let frame = 0; frame < expectedFrames; frame++) {
        const time = frame / input.fps, end = Math.min((frame + 1) / input.fps, input.durationSeconds);
        const observation = await page.evaluate(async time => {
          if (typeof window.render !== 'function') return { error: 'RENDER_MISSING' };
          await window.render(time);
          if (typeof window.TEXTS !== 'function') return { error: 'TEXTS_MISSING' };
          const raw = await window.TEXTS(time);
          if (!Array.isArray(raw) || raw.length > 256) return { error: 'TEXTS_LIMIT_OR_SHAPE' };
          const texts = [];
          for (const b of raw) {
            if (!b || !(typeof b.id === 'string' && b.id.length <= 256 || typeof b.id === 'number' && Number.isFinite(b.id)) || typeof b.text !== 'string' || b.text.length > 4096 || !['x0','y0','x1','y1'].every(k => typeof b[k] === 'number' && Number.isFinite(b[k])) || b.x1 <= b.x0 || b.y1 <= b.y0) return { error: 'TEXTS_SHAPE' };
            texts.push({ id: String(b.id), text: b.text, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
          }
          return { texts, duration: window.DUR, ready: window.READY === true };
        }, time);
        sampledFrames++;
        if (observation.error) { fail(observation.error, captions); continue; }
        if (!observation.ready) fail('READY_FALSE', captions);
        if (!Number.isFinite(observation.duration) || Math.abs(observation.duration - input.durationSeconds) > step + 1e-9) fail('DURATION_MISMATCH', captions);
        const ids = new Set(), actualCaps = new Set();
        if (observation.texts.length) textFrames++;
        if (observation.texts.some(b => b.id.startsWith('cap:'))) captionFrames++;
        for (const b of observation.texts) {
          if (ids.has(b.id)) fail('DUPLICATE_TEXT_ID', captions, b.id);
          ids.add(b.id);
          const safe = b.x0 >= 0 && b.y0 >= 0 && b.x1 <= input.width && b.y1 <= input.height;
          if (!safe) { safeAreaViolations++; fail('OUTSIDE_FRAME', captions, b.id); }
          if (b.id.startsWith('cap:')) {
            if (!captions) { fail('CAPTION_NOT_SUPPRESSED', captions, b.id); continue; }
            const id = b.id.slice(4), cue = input.cues.find(c => String(c.id) === id);
            if (!cue) { fail('CAPTION_UNKNOWN', captions, b.id); continue; }
            if (b.text !== cue.text) fail('CAPTION_TEXT_MISMATCH', captions, b.id);
            if (time < cue.startSeconds - step - 1e-9 || time >= cue.endSeconds + step - 1e-9) fail('CAPTION_OUTSIDE_CUE', captions, b.id);
            if (safe && b.text === cue.text) { actualCaps.add(id); cueCounts.set(id, cueCounts.get(id) + 1); }
          }
          const key = b.id + '\u0000' + b.text;
          let r = records.get(key);
          if (!r) {
            if (records.size >= 1024) { fail('TEXT_RECORD_LIMIT', captions); continue; }
            r = { id: b.id, text: b.text, caption: b.id.startsWith('cap:'), requiredSeconds: b.id.startsWith('cap:') ? null : need(b.text), observedFrames: 0, fullyVisibleFrames: 0, intervals: [], bounds: { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 } };
            records.set(key, r);
          }
          r.observedFrames++;
          r.bounds.x0 = Math.min(r.bounds.x0, b.x0); r.bounds.y0 = Math.min(r.bounds.y0, b.y0); r.bounds.x1 = Math.max(r.bounds.x1, b.x1); r.bounds.y1 = Math.max(r.bounds.y1, b.y1);
          if (safe) {
            r.fullyVisibleFrames++;
            const last = r.intervals.at(-1);
            if (last && last.lastFrame === frame - 1) { last.endSeconds = end; last.lastFrame = frame; last.frames++; }
            else if (intervalCount < 4096) { r.intervals.push({ startSeconds: time, endSeconds: end, firstFrame: frame, lastFrame: frame, frames: 1 }); intervalCount++; }
            else fail('INTERVAL_LIMIT', captions);
          }
        }
        if (captions) for (const cue of input.cues) {
          if (time >= cue.startSeconds + step - 1e-9 && time < cue.endSeconds - step - 1e-9 && !actualCaps.has(String(cue.id))) fail('CAPTION_COVERAGE_GAP', captions, String(cue.id));
        }
      }
      const texts = [...records.values()];
      for (const r of texts.filter(r => !r.caption)) {
        const first = r.intervals[0];
        if (!first) fail('NEVER_FULLY_VISIBLE', captions, r.id);
        else if (first.endSeconds - first.startSeconds < r.requiredSeconds - 1e-6) fail('READING_TOO_SHORT', captions, r.id);
      }
      if (captions) for (const cue of input.cues) {
        const matches = texts.filter(r => r.id === 'cap:' + cue.id && r.text === cue.text);
        const intervals = matches.flatMap(r => r.intervals);
        if (!cueCounts.get(String(cue.id)) || !intervals.length) fail('CAPTION_CUE_UNOBSERVED', captions, String(cue.id));
        else if (intervals.length !== 1 || Math.abs(intervals[0].startSeconds - cue.startSeconds) > step + 1e-9 || Math.abs(intervals[0].endSeconds - cue.endSeconds) > step + 1e-9) fail('CAPTION_WINDOW_MISMATCH', captions, String(cue.id));
      }
      modes.push({ captions, expectedFrames, sampledFrames, textFrames, captionFrames, safeAreaViolations, texts });
    } finally { await browser.close(); }
  }
  const hasNonCaption = modes.some(m => m.texts.some(t => !t.caption && t.text.trim()));
  const captionOnlyProven = input.captionMode === 'film' && input.cues.length > 0 && modes.some(m => m.captions === 1 && m.captionFrames > 0) && errors.length === 0;
  if (!hasNonCaption && !captionOnlyProven) fail('NO_NONCAPTION_TEXT_WITHOUT_PROVEN_CAPTION_COVERAGE', input.captionMode === 'film' ? 1 : 0);
  const result = { readingPassed: errors.length === 0, evidenceReason: hasNonCaption ? 'NONCAPTION_READING_AND_CAPTION_RULES' : captionOnlyProven ? 'CAPTION_ONLY_FULL_FILM_COVERAGE_PROVEN' : 'INSUFFICIENT_TEXT_EVIDENCE', modes, errors };
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json, 'utf8') > 2 * 1024 * 1024) throw new Error('READCHECK_RESULT_LIMIT');
  await writeFile(input.resultPath, json, 'utf8');
} finally { closeServer(); }
`;
