import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = resolve('.');
const work = resolve(process.env.STORYDREAM_PIXELLE_CAPTION_QA_ROOT ?? '.artifacts/pixelle-caption-layout-20261102');
const execute = promisify(execFile);
await mkdir(work, { recursive: true });
await mkdir(join(work, 'temp'), { recursive: true });
const env = { ...process.env, TEMP: join(work, 'temp'), TMP: join(work, 'temp'), PLAYWRIGHT_BROWSERS_PATH: join(root, 'vendor/python/playwright-browsers') };
const helpers = join(work, 'helpers.mjs');
await build({ stdin: { contents: "export {fitPixelleTimedCaption} from './src/shared/pixelle-caption-layout'; export {getTemplate,draftFontOptions} from './src/shared/templates'; export {buildShortVideoComposition} from './src/shared/short-video-render'; export {PIXELLE_REVISION} from './src/shared/pixelle';", resolveDir: root }, outfile: helpers, bundle: true, platform: 'node', format: 'esm', target: 'node20' });
const { fitPixelleTimedCaption, getTemplate, draftFontOptions, buildShortVideoComposition, PIXELLE_REVISION } = await import(pathToFileURL(helpers).href + '?run=' + Date.now());
const descriptor = { width: 1080, height: 1920, ref: { provider: 'pixelle', revision: PIXELLE_REVISION, path: '1080x1920/video_default.html', sha256: 'a'.repeat(64) } };
const cases = [
  { name: 'W150', text: 'W'.repeat(150) },
  { name: 'W100', text: 'W'.repeat(100) },
  { name: 'cjk', text: '清晰地解释每一个细节。'.repeat(12) },
  { name: 'mixed', text: 'WWW 解释真实字体边界，English words remain complete. '.repeat(2) },
  { name: 'multiline', text: '第一行中文信息\nSecond line with English words\n第三行节奏与转场\nFourth line readable captions' },
  { name: 'word-boundaries', text: ('W'.repeat(18) + ' ').repeat(5) },
  { name: 'styled', text: '字幕完整显示 WWW 中文与 English words。'.repeat(2), style: { lineSpacing: 3, letterSpacing: 2, border: { color: '#000000', width: 8, alpha: 1 } } },
  { name: 'dense-W200', text: 'W'.repeat(200), rejected: true },
  { name: 'dense-cjk', text: '超长内容'.repeat(300), rejected: true },
  { name: 'dense-newlines', text: '一\n'.repeat(9), rejected: true },
  ...draftFontOptions.filter(font => font.value !== 'system').map(font => ({ name: 'font-' + font.value, text: 'W'.repeat(150), style: { fontFamily: font.value } })),
];
const original = await readFile(join(root, 'vendor/pixelle-upstream/templates/1080x1920/video_default.html'), 'utf8');
await writeFile(join(work, 'original.html'), original.replace(/\{\{[^=}]+(?:=([^}]*))?\}\}/gu, (_match, value) => value ?? ''), 'utf8');
const manifest = [];
for (const entry of cases) {
  const template = structuredClone(getTemplate('default-portrait-9-16'));
  Object.assign(template.caption, entry.style);
  try {
    template.caption = fitPixelleTimedCaption(template.caption, descriptor, [entry.text]);
    assert(!entry.rejected, entry.name + ' must reject at the readable minimum');
  } catch (error) {
    if (!entry.rejected) throw error;
    assert.match(String(error), /PIXELLE_CAPTION_TOO_DENSE/u);
    Object.assign(template.caption, { fontSize: 6, x: 0, y: .72, width: Math.min(.84, template.caption.width) });
  }
  template.canvas.width = 1080; template.canvas.height = 1920;
  Object.assign(template.image, { visible: true, left: 0, top: 0, width: 1, height: 1, fit: 'contain', mediaScale: 1, motion: '', animation: '' });
  template.frame.enabled = false;
  template.title.visible = false; template.subtitle.visible = false; template.disclaimer.visible = false;
  template.caption.visible = true;
  const input = { workDir: work, draftRootDir: work, title: 'Caption geometry', ratio: '9:16', template,
    cover: { title: '', subtitle: [], summary: '', tags: [], comments: [] }, reviewedText: entry.text, rewrittenCopy: entry.text,
    scenes: [{ id: 1, cap: entry.text, descPrompt: '', durationMs: 2200 }], imagePrompts: [],
    generatedImages: [{ sceneId: 1, path: join(work, 'original-overlay.png') }],
    narrationAudio: [{ sceneId: 1, path: join(work, 'unused-audio.wav'), durationMs: 2200 }], bgm: null,
    subtitles: { cues: [{ id: 'cue', sceneId: 1, text: entry.text, startMs: 0, endMs: 2200 }] },
  };
  const html = buildShortVideoComposition(input).scenes[0].html;
  const file = join(work, entry.name + '.html');
  await writeFile(file, html, 'utf8');
  manifest.push({ ...entry, file, caption: template.caption });
}
await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
const geometry = await execute(join(root, 'vendor/python/python.exe'), [join(root, 'scripts/qa-pixelle-caption-layout.py'), work], { env, windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
process.stdout.write(geometry.stdout);
if (process.argv.includes('--dual-output')) {
  // Reuse the real dual-output harness, selecting only the three affected cases.
  const source = await readFile(join(root, 'scripts/smoke-pixelle-dual-output.ts'), 'utf8');
  const loop = 'for (const { descriptor, subtitleMode, name, mediaKind, text, parameters } of cases) {';
  const counts = 'expectedTemplates: allTemplates ? 31 : 3, extendedCases: extendedCoverage ? 6 : 0';
  assert(source.includes(loop) && source.includes(counts), 'Dual-output harness anchors changed');
  const scoped = source.replace(loop, loop.replace('of cases)', "of cases.filter(item => item.descriptor.ref.path === '1080x1920/video_default.html'))"))
    .replace(counts, 'expectedTemplates: 1, extendedCases: 2');
  const outfile = join(work, 'runtime/pixelle-dual-output.mjs');
  await build({ stdin: { contents: scoped, loader: 'ts', resolveDir: join(root, 'scripts') }, outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20', external: ['electron', 'sql.js', 'undici'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const deliveryEnv = { ...env, STORYDREAM_PIXELLE_ALL_TEMPLATES: '0', STORYDREAM_PIXELLE_EXTENDED: '1', STORYDREAM_PIXELLE_VALIDATION_ROOT: join(work, 'deliveries') };
  delete deliveryEnv.ELECTRON_RUN_AS_NODE;
  try {
    const result = await execute(join(root, 'node_modules/electron/dist/electron.exe'), [outfile], { env: deliveryEnv, windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    await writeFile(join(work, 'dual-output.log'), result.stdout + result.stderr, 'utf8');
  } catch (error) {
    await writeFile(join(work, 'dual-output.log'), String(error.stdout ?? '') + String(error.stderr ?? '') + String(error), 'utf8');
    throw error;
  }
  const report = JSON.parse(await readFile(join(work, 'deliveries/dual-output/report.json'), 'utf8'));
  assert.equal(report.status, 'passed'); assert.equal(report.results.length, 3); assert.equal(report.paidRequests, 0);
  process.stdout.write(JSON.stringify({ dualOutputs: report.results.length, paidRequests: report.paidRequests }) + '\n');
}
