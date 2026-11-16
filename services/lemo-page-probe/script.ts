/** Fixed companion program, embedded so packaged hosts need no external script lookup.
 * Browser evaluation is static; all host inputs travel as JSON data, never source.
 */
export const lemoPageProbeScript = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
const { openDemo, closeServer } = await import(pathToFileURL(resolve(input.upstreamRoot, 'core/render/page.mjs')).href);
const modes = [];
try {
  for (const captions of [1, 0]) {
    const { browser, page } = await openDemo(input.filmDir, { w: input.width, h: input.height, q: 'captions=' + captions });
    try {
      const samples = [];
      for (const time of input.times) {
        samples.push(await page.evaluate(async (time) => {
          const errors = [];
          const fail = message => { if (errors.length < 100) errors.push(message); };
          const finite = value => typeof value === 'number' && Number.isFinite(value);
          const str = value => typeof value === 'string' && value.length <= 4096;
          if (typeof window.render !== 'function') fail('RENDER_MISSING');
          else await window.render(time);
          let fontsReady = false;
          try { await document.fonts.ready; fontsReady = document.fonts.status === 'loaded'; }
          catch { fail('FONTS_READY_REJECTED'); }
          const faces = Array.from(document.fonts);
          if (faces.length > 256) fail('FONT_LIMIT');
          const fonts = faces.slice(0, 256).map(face => ({ family: face.family.slice(0, 512), status: face.status }));
          if (fonts.some(face => face.status === 'error')) fail('FONT_LOAD_FAILED');
          if (!fontsReady) fail('FONTS_NOT_READY');
          const durationSeconds = finite(window.DUR) ? window.DUR : null;
          if (durationSeconds === null || durationSeconds <= 0) fail('DURATION_INVALID');
          if (durationSeconds !== null && time >= durationSeconds) fail('TIME_OUTSIDE_RUNTIME_DURATION');
          const ready = window.READY === true;
          if (!ready) fail('READY_FALSE');
          const textsPresent = typeof window.TEXTS === 'function';
          const texts = [];
          if (textsPresent) {
            try {
              const raw = await window.TEXTS(time);
              if (!Array.isArray(raw)) fail('TEXTS_SHAPE');
              else {
                if (raw.length > 256) fail('TEXTS_LIMIT');
                for (const item of raw.slice(0, 256)) {
                  if (!item || !(str(item.id) || finite(item.id)) || !str(item.text) || !['x0','y0','x1','y1'].every(key => finite(item[key])) || item.x1 < item.x0 || item.y1 < item.y0) { fail('TEXTS_SHAPE'); continue; }
                  texts.push({ id: item.id, text: item.text, x0: item.x0, y0: item.y0, x1: item.x1, y1: item.y1 });
                }
              }
            } catch { fail('TEXTS_FAILED'); }
          }
          const eventsPresent = window.EV !== undefined;
          const events = [];
          if (eventsPresent) {
            if (!Array.isArray(window.EV)) fail('EV_SHAPE');
            else {
              if (window.EV.length > 2048) fail('EV_LIMIT');
              for (const event of window.EV.slice(0, 2048)) {
                if (!event || !finite(event.t) || !str(event.type)) { fail('EV_SHAPE'); continue; }
                events.push({ t: event.t, type: event.type });
              }
            }
          }
          return { time, ready, durationSeconds, fontsReady, fonts, textsPresent, texts, eventsPresent, events, errors };
        }, time));
      }
      modes.push({ captions, samples });
    } finally { await browser.close(); }
  }
  const json = JSON.stringify({ modes });
  if (Buffer.byteLength(json, 'utf8') > 1024 * 1024) throw new Error('LEMO_PAGE_PROBE_RESULT_LIMIT');
  await writeFile(input.resultPath, json, 'utf8');
} finally { closeServer(); }
`;
