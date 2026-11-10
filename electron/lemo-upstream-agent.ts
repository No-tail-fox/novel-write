import { wasGenerationNotSubmitted } from '../src/shared/generation-authorization';
import { isDefinitiveLlmProviderRejection } from '../src/shared/llm-provider-error';
import { LlmTextInterruptedError } from '../src/shared/llm-text-stream';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { LlmMessage, LlmTextRequest, LlmTextResult } from '../src/shared/llm-provider';
import { LEMO_AGENT_MAX_TURNS, parseLemoAgentAction, type LemoUpstreamFilm, type LemoAgentAction } from '../src/shared/creative-animation/upstream-agent';
import { readLemoUpstreamManifest, LEMO_UPSTREAM_REVISION } from './lemo-upstream-source';
import type { LemoUpstreamReviewReceipt } from './lemo-upstream-renderer';
import { LEMO_ASSET_DIR, LEMO_ASSET_MANIFEST, addGeneratedLemoAsset, hasLemoAssetChannel, readLemoAssetManifest, stageLemoAssets, verifyLemoAssets, type LemoAssetInput, type LemoAssetMedia } from './lemo-upstream-assets';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const textFile = /\.(?:html|m?js|css|json|md|txt|svg)$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
interface Turn { index: number; reply: string; observation: string; tool: string; modelRequestId: string | null }
interface Journal { version: 1; contextHash: string; film: LemoUpstreamFilm; turns: Turn[] }
export interface LemoAgentContext {
  runId: string; styleId: string; brief: string; durationSeconds: number; width: number; height: number; styleReference?: string;
  /** Imported material (asset channel). Present only for runs created with the channel; part of the context hash. */
  assets?: LemoAssetInput[];
  /** Optional illustration channel; absent = disabled. */
  imageGeneration?: { maxImages: number };
}
export interface LemoAgentImageRequest { requestId: string; id: string; prompt: string; transparent: boolean; width: number; height: number }
export interface LemoAgentImages {
  provider: string;
  /** Submit one paid image request. Resolve with a local PNG/JPEG path. */
  generate(request: LemoAgentImageRequest): Promise<{ path: string }>;
  /** Look up an already submitted request without charging; undefined = unknown. */
  recover?(request: LemoAgentImageRequest): Promise<{ path: string } | undefined>;
  /** True only when the provider definitively refused the request (no charge). */
  isRejection(message: string): boolean;
  /** Free replay mode: a new request must never be written or submitted. */
  recoveryOnly?: boolean;
}
export interface LemoAgentOptions {
  root: string; upstreamRoot: string; context: LemoAgentContext;
  model(request: LlmTextRequest): Promise<LlmTextResult>;
  review(directory: string, outputDir: string, times: number[]): Promise<LemoUpstreamReviewReceipt>;
  /** Source files and media tools for staging context.assets (required when assets or images are enabled). */
  assetHost?: { files: Record<string, string>; media: LemoAssetMedia };
  images?: LemoAgentImages;
  signal?: AbortSignal;
  turn?: number;
  requestId?: string;
  retryOfRequestId?: string;
}
export class LemoAgentUnknownRequestError extends Error {
  constructor() { super('LEMO_AGENT_REQUEST_UNKNOWN: 上轮请求已提交但未保存完整回执；先核对服务商结果，禁止自动重复收费。'); }
}
export class LemoAgentImageUnknownError extends Error {
  constructor(detail = '') { super('LEMO_IMAGE_REQUEST_UNKNOWN: Agent 申请的插画已提交但结果未知；请先核对生图服务商记录，确认无结果后再继续，避免重复计费。' + (detail ? ` (${detail})` : '')); }
}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
async function readOptional<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch (error) { if (missing(error)) return undefined; throw error; }
}
async function atomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, path);
}
function cleanPath(path: string, empty = false) {
  if (empty && path === '') return '';
  if (!path || path.length > 512 || /[\\:\x00-\x1f]/.test(path) || path.startsWith('/')
    || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))) {
    throw new Error('LEMO_AGENT_PATH: 只能访问工程内相对路径。');
  }
  return path;
}
/** Reject every symlink/junction component, including nonexistent-file parents. */
export async function lemoAgentPath(root: string, name: string) {
  cleanPath(name);
  let file = resolve(root);
  const rootStat = await lstat(file);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('LEMO_AGENT_PATH: unsafe root.');
  for (const part of name.split('/')) {
    file = join(file, part);
    try { if ((await lstat(file)).isSymbolicLink()) throw new Error('LEMO_AGENT_PATH: symlink/junction denied.'); }
    catch (error) { if (!missing(error)) throw error; }
  }
  return file;
}
async function projectFiles(root: string) {
  const files: Array<{ path: string; sha256: string; bytes: number }> = [];
  let total = 0;
  // Host-managed binaries are covered by MANIFEST.json hashes (verified before export), not the source budget.
  const assetChannel = await hasLemoAssetChannel(root);
  async function walk(prefix: string, depth: number) {
    if (depth > 12) throw new Error('LEMO_AGENT_PROJECT_DEPTH');
    for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
      const name = prefix ? prefix + '/' + item.name : item.name;
      if (assetChannel && name.startsWith(LEMO_ASSET_DIR + '/') && name !== LEMO_ASSET_MANIFEST) continue;
      const path = await lemoAgentPath(root, name);
      if (item.isDirectory()) await walk(name, depth + 1);
      else {
        const size = (await lstat(path)).size;
        total += size;
        if (files.length >= 256 || total > MAX_PROJECT_BYTES || size > MAX_FILE_BYTES) throw new Error('LEMO_AGENT_PROJECT_BUDGET');
        const bytes = await readFile(path);
        files.push({ path: name, sha256: hash(bytes), bytes: bytes.length });
      }
    }
  }
  await walk('', 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
async function fingerprint(root: string) { return hash(JSON.stringify(await projectFiles(root))); }

function styleInstruction(context: LemoAgentContext) {
  if (!context.styleReference) return `Read DIRECTOR.md, TECHNIQUE.md and styles/${context.styleId}/STYLE.md using tools; inspect relevant demo source only to learn technique.`;
  // OPUSCAR 98 light styles have a style prompt but no library STYLE.md: upstream MY-STYLES.md "Start from a blank page".
  return `The user chose OPUSCAR 98 light style ${context.styleId}; it has a style prompt but no library STYLE.md. Read DIRECTOR.md, TECHNIQUE.md and MY-STYLES.md using tools, then follow MY-STYLES.md "Start from a blank page" without interviewing the user (the look is already chosen): pick ONE library style as the technique base (closest materials and engine; at most two to borrow moves from), read its styles/<base>/STYLE.md, and write the film's own STYLE.md in the project (invariants only, in the sections of a library STYLE.md, built from the style prompt below) before TREATMENT.md. Keep every later decision consistent with that STYLE.md. Inspect demo source only to learn technique.
${context.styleReference}`;
}
function materialInstruction(context: LemoAgentContext) {
  const lines: string[] = [];
  if (context.assets?.length || context.imageGeneration) {
    lines.push(`Material: ${LEMO_ASSET_MANIFEST} (read it with read_file) lists host-managed files under ${LEMO_ASSET_DIR}/. They are read-only: never write under ${LEMO_ASSET_DIR}/. Reference them by relative URL (./${LEMO_ASSET_DIR}/…) and preload them before window.READY. Video assets are 24 fps JPEG frame sequences: pick the frame for absolute film time inside render(t), never use <video> playback.`);
  }
  if (context.assets?.length) {
    lines.push(`The user imported ${context.assets.length} real asset(s): ${JSON.stringify(context.assets.map(({ id, kind, description, source, license }) => ({ id, kind, description, source, license })))}. Build the film around this material where it serves the narration; keep its meaning, never fabricate missing evidence, and show source tags where the style calls for them. To look at one asset, use {"tool":"view_asset","id":"a01"}; the thumbnail is attached to your next turn.`);
  }
  if (context.imageGeneration) {
    lines.push(`Illustrations: you may request at most ${context.imageGeneration.maxImages} generated image(s) for the whole film with {"tool":"request_image","id":"g1","prompt":"…","transparent":false}. Each request is paid; request only what code cannot draw well (complex painted subjects, characters, textures). Prompts describe pictorial subjects and texture only: NO text, letters, numbers, logos, maps, charts, documents, photographs of real events or anything that could pass as evidence. Use transparent:true for a cut-out subject. The host writes ${LEMO_ASSET_DIR}/generated/<id>.png and updates the manifest. Generated pictures are illustrations, never evidence. Titles, labels, data and stamps stay in code.`);
  }
  return lines.length ? '\n' + lines.join('\n') : '';
}
function systemPrompt(context: LemoAgentContext) {
  return `You are the film director and native HTML/ESM author inside StoryDream, using the unmodified Lemo library (${LEMO_UPSTREAM_REVISION}).
Create an ORIGINAL film for the user, not a copy of a demo story. ${styleInstruction(context)}${materialInstruction(context)}
Work in separate HTML/JS/CSS modules of your own design. No fixed scene factories, no whole-film JSON. You may write outline.md first. Create index.html as the entry. Expose window.READY=true only after assets load, window.DUR=${context.durationSeconds}, and deterministic window.render(t). Use exact ${context.width}x${context.height} viewport and fit the camera to it.
ESM import maps may map three to /node_modules/three/build/three.module.js and three/addons/ to /node_modules/three/examples/jsm/. Read-only /core/ and /styles/ paths are served. Your files are under /@film/. There is NO network, shell, npm install or Node access. Do not request external URLs or missing fonts; local system fonts are available. Do not alter library files or copy entire demos. Use substantive scene construction, lighting, composition, transitions and appropriate scale. Avoid repetitive title-card slides.
The host owns narration, ordinary subtitles and final mixing. Do not synthesize speech, play audio or render ordinary subtitles inside your film; in-scene labels are allowed. Respect approved narration and timing supplied below.
Each reply performs exactly ONE tool action. A small JSON header goes in a json fence. For write_file put the UNESCAPED file body in a separate fenced block after it. No giant escaped source JSON. Tools:
{"tool":"list_files","scope":"project|library","path":"optional directory"}
{"tool":"read_file","scope":"project|library","path":"relative/file","offset":0,"length":24000}
{"tool":"write_file","path":"relative/file.js"} followed by a code fence containing complete source
{"tool":"replace_text","path":"relative/file.js","before":"unique exact old text","after":"replacement"}
{"tool":"review_frames"}
{"tool":"finish","notes":"Specific visual findings about received frames: composition, scale, typography, defects and why ready."}
Split long sources into modules. If a response is truncated it is not applied: write a smaller file instead. Review actual frames, repair files and re-review. finish is accepted only after a technically clean review of the CURRENT sources and after you have received those frame images. A review does not automatically prove aesthetic quality. Never claim work that tools have not performed.`;
}
async function messagesFor(options: LemoAgentOptions, journal: Journal): Promise<LlmMessage[]> {
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(options.context) },
    { role: 'user', content: options.context.brief },
  ];
  // Keep recent file bodies verbatim; older receipts stay on disk and become compact tool history.
  for (const turn of journal.turns) {
    const recent = turn.index > journal.turns.length - 10;
    messages.push({ role: 'assistant', content: recent ? turn.reply : `[saved turn ${turn.index}, ${turn.tool}]` });
    messages.push({ role: 'user', content: recent ? turn.observation : turn.observation.slice(0, 1200) });
  }
  const files = await projectFiles(journal.film.directory);
  const latest: LlmMessage = { role: 'user', content: `Current project files:\n${JSON.stringify(files)}\nTurn ${journal.turns.length + 1}/${LEMO_AGENT_MAX_TURNS}. Read files again if you need omitted source. Continue with one tool.` };
  if (journal.film.review?.sourceHash === journal.film.sourceHash && journal.film.review.frames.length) {
    latest.images = await Promise.all(journal.film.review.frames.map(async (path, index) => ({ dataUrl: 'data:image/png;base64,' + (await readFile(path)).toString('base64'), label: `Current source frame ${index + 1}` })));
  }
  if (journal.film.assetPreview && journal.film.lastTool === 'view_asset') {
    const preview = journal.film.assetPreview;
    latest.images = [...(latest.images ?? []), { dataUrl: 'data:image/jpeg;base64,' + (await readFile(preview.path)).toString('base64'), label: `Asset ${preview.id} (thumbnail)` }];
  }
  messages.push(latest);
  return messages;
}

const previewDir = (options: LemoAgentOptions) => join(resolve(options.root), 'asset-previews');
interface ImageReceipt { status: 'submitted' | 'received' | 'rejected'; imageRequestId: string; nodeRequestId?: string; id: string; prompt: string; transparent: boolean; path?: string; error?: string }
/** Host-side guard rails appended to every agent prompt; the agent's words stay first. */
export function lemoAgentImagePrompt(prompt: string, transparent: boolean) {
  return [prompt.trim(), 'Illustration for an animated film. No text, letters, numbers, captions, labels, logos, signatures or watermarks. Not a photograph of a real event, not a document, chart or map.',
    transparent ? 'One complete subject, centered, fully in frame with generous margin, on a solid pure green chroma-key background (#00FF00); no green on the subject.' : ''].filter(Boolean).join('\n\n');
}
async function requestImage(options: LemoAgentOptions, film: LemoUpstreamFilm, action: Extract<LemoAgentAction, { tool: 'request_image' }>, turnDir: string): Promise<string> {
  const policy = options.context.imageGeneration;
  if (!policy || !options.images || !options.assetHost) throw new Error('LEMO_IMAGE_DISABLED: illustration requests are not enabled for this film. Draw it in code or use imported assets.');
  const manifest = await readLemoAssetManifest(film.directory);
  if (!manifest) throw new Error('LEMO_ASSET_CHANNEL: material manifest is missing.');
  const generated = manifest.assets.filter(entry => entry.origin === 'generated');
  const receiptPath = join(turnDir, 'image.json');
  let receipt = await readOptional<ImageReceipt>(receiptPath);
  const request = (imageRequestId: string): LemoAgentImageRequest => ({ requestId: imageRequestId, id: action.id, prompt: lemoAgentImagePrompt(action.prompt, action.transparent),
    transparent: action.transparent, width: options.context.width, height: options.context.height });
  let result: { path: string } | undefined;
  if (receipt?.status === 'rejected') throw new Error(`LEMO_IMAGE_REJECTED: the image provider refused this request (${receipt.error ?? 'no detail'}). Change the prompt or draw it in code.`);
  if (receipt?.status === 'received') result = { path: receipt.path! };
  if (receipt?.status === 'submitted') {
    // The user confirmed with the provider that the earlier submission produced nothing: retry that one only.
    if (options.retryOfRequestId && receipt.nodeRequestId === options.retryOfRequestId && options.requestId !== receipt.nodeRequestId) {
      await rename(receiptPath, join(turnDir, `image-abandoned-${randomUUID()}.json`));
      receipt = undefined;
    } else {
      result = await options.images.recover?.(request(receipt.imageRequestId));
      if (!result) throw new LemoAgentImageUnknownError();
    }
  }
  if (!receipt) {
    if (manifest.assets.some(entry => entry.id === action.id)) throw new Error(`LEMO_IMAGE_ID_TAKEN: "${action.id}" already exists in the manifest; choose a new id.`);
    if (generated.length >= policy.maxImages) throw new Error(`LEMO_IMAGE_BUDGET: all ${policy.maxImages} illustration(s) for this film are used. Reuse existing assets or draw it in code.`);
    if (options.images.recoveryOnly) throw new Error('LEMO_RECOVERY_MUST_NOT_CHARGE: image request not yet submitted');
    receipt = { status: 'submitted', imageRequestId: randomUUID(), nodeRequestId: options.requestId, id: action.id, prompt: action.prompt, transparent: action.transparent };
    try { await writeFile(receiptPath, JSON.stringify(receipt), { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LemoAgentImageUnknownError(); throw error; }
    try { result = await options.images.generate(request(receipt.imageRequestId)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.images.isRejection(message)) {
        await atomic(receiptPath, { ...receipt, status: 'rejected', error: message.slice(0, 500) });
        throw new Error(`LEMO_IMAGE_REJECTED: ${message.slice(0, 500)}. Change the prompt or draw it in code.`);
      }
      throw new LemoAgentImageUnknownError(message.slice(0, 300));
    }
  }
  if (receipt.status !== 'received') { receipt = { ...receipt, status: 'received', path: result!.path }; await atomic(receiptPath, receipt); }
  const entry = await addGeneratedLemoAsset({ projectDir: film.directory, previewDir: previewDir(options), media: options.assetHost.media, id: action.id,
    sourcePath: result!.path, prompt: action.prompt, transparent: action.transparent, provider: options.images.provider });
  film.sourceHash = await fingerprint(film.directory);
  film.status = 'authoring'; delete film.visualReview;
  const used = generated.some(item => item.id === entry.id) ? generated.length : generated.length + 1;
  return JSON.stringify({ ...entry, remaining: Math.max(0, policy.maxImages - used), message: 'Illustration saved and listed in the manifest. Use it by relative URL.' });
}

async function executeAction(options: LemoAgentOptions, journal: Journal, action: LemoAgentAction, turnDir: string): Promise<string> {
  const film = journal.film;
  if (action.tool === 'list_files' || action.tool === 'read_file') {
    const library = action.scope === 'library';
    const entries = library ? (await readLemoUpstreamManifest(options.upstreamRoot)).files : await projectFiles(film.directory);
    const name = cleanPath(action.path, action.tool === 'list_files');
    if (action.tool === 'list_files') return JSON.stringify(entries.filter(file => textFile.test(file.path) && (!name || file.path.startsWith(name + '/'))).map(file => ({ path: file.path, bytes: file.bytes })).slice(0, 250));
    if (!textFile.test(name) || !entries.some(file => file.path === name)) throw new Error('LEMO_AGENT_READ_DENIED: file is not in the permitted manifest.');
    const body = await readFile(await lemoAgentPath(library ? options.upstreamRoot : film.directory, name), 'utf8');
    return JSON.stringify({ path: name, offset: action.offset, totalCharacters: body.length, text: body.slice(action.offset, action.offset + action.length) });
  }
  if (action.tool === 'write_file' || action.tool === 'replace_text') {
    if (!textFile.test(action.path)) throw new Error('LEMO_AGENT_WRITE_DENIED: only film source files can be written.');
    if ((action.path === LEMO_ASSET_DIR || action.path.startsWith(LEMO_ASSET_DIR + '/')) && (await hasLemoAssetChannel(film.directory) || options.context.assets?.length || options.context.imageGeneration)) {
      throw new Error(`LEMO_AGENT_WRITE_DENIED: ${LEMO_ASSET_DIR}/ is host-managed material and read-only.`);
    }
    const path = await lemoAgentPath(film.directory, action.path);
    let before = '';
    try { before = await readFile(path, 'utf8'); } catch (error) { if (!missing(error)) throw error; }
    const operationPath = join(turnDir, 'mutation.json');
    let operation = await readOptional<{ beforeHash: string; afterHash: string; body: string }>(operationPath);
    if (!operation) {
      let body = action.body ?? '';
      if (action.tool === 'replace_text') {
        if (!before.includes(action.before) || before.indexOf(action.before) !== before.lastIndexOf(action.before)) throw new Error('LEMO_AGENT_PATCH_MISMATCH: before text must occur exactly once. Read the file first.');
        body = before.replace(action.before, () => action.after);
      }
      if (Buffer.byteLength(body) > MAX_FILE_BYTES) throw new Error('LEMO_AGENT_FILE_TOO_LARGE: split source into modules.');
      const existing = await projectFiles(film.directory);
      if (existing.reduce((sum, file) => sum + file.bytes, 0) - Buffer.byteLength(before) + Buffer.byteLength(body) > MAX_PROJECT_BYTES
        || !existing.some(file => file.path === action.path) && existing.length >= 256) throw new Error('LEMO_AGENT_PROJECT_BUDGET');
      operation = { beforeHash: hash(before), afterHash: hash(body), body };
      await atomic(operationPath, operation);
    }
    if (hash(before) !== operation.afterHash) {
      if (hash(before) !== operation.beforeHash) throw new Error('LEMO_AGENT_FILE_CHANGED: cannot replay a patch over external changes.');
      await mkdir(dirname(path), { recursive: true });
      await lemoAgentPath(film.directory, action.path);
      const temp = path + '.' + randomUUID() + '.tmp';
      await writeFile(temp, operation.body, 'utf8'); await rename(temp, path);
    }
    film.sourceHash = await fingerprint(film.directory);
    film.status = 'authoring'; delete film.visualReview;
    return JSON.stringify({ path: action.path, sha256: operation.afterHash, bytes: Buffer.byteLength(operation.body), applied: true });
  }
  if (action.tool === 'review_frames') {
    const duration = options.context.durationSeconds;
    const times = [0.08, 0.45, 0.86].map(fraction => fraction * duration);
    const receipt = await options.review(film.directory, join(turnDir, 'review'), times);
    const correctDuration = typeof receipt.durationSeconds === 'number' && Math.abs(receipt.durationSeconds - duration) <= 1 / 30;
    film.review = { sourceHash: film.sourceHash, technicalPassed: receipt.technicalPassed && correctDuration,
      frames: receipt.frames.map(frame => frame.path), durationSeconds: receipt.durationSeconds };
    delete film.visualReview;
    return JSON.stringify({ ...receipt, expectedDurationSeconds: duration, durationMatches: correctDuration,
      message: 'These are real current-source captures, not an aesthetic approval. Examine the images in your next turn and repair defects.' });
  }
  if (action.tool === 'view_asset') {
    const entry = (await readLemoAssetManifest(film.directory))?.assets.find(item => item.id === action.id);
    if (!entry) throw new Error(`LEMO_ASSET_UNKNOWN: no asset "${action.id}" in ${LEMO_ASSET_MANIFEST}.`);
    const path = join(previewDir(options), `${entry.id}.jpg`);
    await readFile(path);
    film.assetPreview = { id: entry.id, path };
    return JSON.stringify({ ...entry, message: 'Thumbnail attached to your next turn. It is a reduced preview; the film uses the full file.' });
  }
  if (action.tool === 'request_image') return requestImage(options, film, action, turnDir);
  if (!film.review?.technicalPassed || film.review.sourceHash !== film.sourceHash || film.review.frames.length < 3) throw new Error('LEMO_AGENT_REVIEW_REQUIRED: render and inspect current sources before finishing.');
  // Images must have existed in the input of this model turn, never merely captured after its response.
  film.visualReview = { sourceHash: film.sourceHash, notes: action.notes, turn: journal.turns.length + 1 };
  film.status = 'ready';
  return 'Film sources ready. Model visual review recorded separately from technical evidence; final audiovisual export still required.';
}

/** Exactly one paid model call per production node; every response is saved before parsing or file execution. */
export async function stepLemoUpstreamAgent(options: LemoAgentOptions): Promise<LemoUpstreamFilm> {
  options.signal?.throwIfAborted();
  const { context } = options;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(context.styleId) || !Number.isFinite(context.durationSeconds) || context.durationSeconds <= 0) throw new Error('LEMO_AGENT_CONTEXT');
  const root = resolve(options.root), directory = join(root, 'project'), journalPath = join(root, 'journal.json');
  await mkdir(directory, { recursive: true });
  // Optional fields are omitted by JSON.stringify, so runs without material keep their original hash.
  const contextHash = hash(JSON.stringify(context));
  let journal = await readOptional<Journal>(journalPath);
  if (journal && journal.contextHash !== contextHash) throw new Error('LEMO_AGENT_CONTEXT_CHANGED: create a new run for changed inputs.');
  if (context.assets?.length || context.imageGeneration) {
    if (!options.assetHost) throw new Error('LEMO_ASSET_CHANNEL: 素材通道缺少宿主文件与媒体工具。');
    await stageLemoAssets({ projectDir: directory, previewDir: previewDir(options), inputs: context.assets ?? [], files: options.assetHost.files,
      media: options.assetHost.media, canvas: { width: context.width, height: context.height } });
  }
  if (!journal) {
    journal = { version: 1, contextHash, turns: [], film: { version: 1, runId: context.runId, styleId: context.styleId, directory, turn: 0, status: 'authoring', sourceHash: await fingerprint(directory), lastTool: 'start', message: '原生工程已创建。' } };
    await atomic(journalPath, journal);
  }
  if (options.turn && options.turn <= journal.turns.length) {
    const recovered = await recoverLemoUpstreamAgentTurn(root, options.turn);
    if (recovered) return recovered;
    throw new Error('LEMO_AGENT_RECEIPT_MISSING');
  }
  if (options.turn && options.turn !== journal.turns.length + 1) throw new Error('LEMO_AGENT_TURN_STALE');
  if (journal.film.status === 'ready') return journal.film;
  if (journal.turns.length >= LEMO_AGENT_MAX_TURNS) throw new Error('LEMO_AGENT_TURN_BUDGET: 已达到本次预算，工程和全部回执保留；未宣称完成。');
  const currentHash = await fingerprint(directory);
  if (currentHash !== journal.film.sourceHash) {
    journal.film.sourceHash = currentHash; delete journal.film.visualReview;
  }
  const index = journal.turns.length + 1, turnDir = join(root, `turn-${String(index).padStart(4, '0')}`);
  await mkdir(turnDir, { recursive: true });
  let response = await readOptional<LlmTextResult>(join(turnDir, 'response.json'));
  if (!response) {
    const messages = await messagesFor(options, journal);
    const rejected = await readOptional<{ requestId?: string }>(join(turnDir, 'rejected.json'));
    const submitted = await readOptional<{ requestId?: string }>(join(turnDir, 'submitted.json'));
    // A rejection authorizes retry of that submission only, never of a later unknown request.
    if (submitted && options.requestId && submitted.requestId !== options.requestId && ((rejected && submitted.requestId === rejected.requestId) || (options.retryOfRequestId && submitted.requestId === options.retryOfRequestId))) {
      await rename(join(turnDir, 'submitted.json'), join(turnDir, 'rejected-submission-' + randomUUID() + '.json')).catch(error => { if (!missing(error)) throw error; });
    }
    try { await writeFile(join(turnDir, 'submitted.json'), JSON.stringify({ at: new Date().toISOString(), contextHash, index, requestId: options.requestId }), { encoding: 'utf8', flag: 'wx' }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new LemoAgentUnknownRequestError(); throw error; }
    try {
      response = await options.model({ step: index, name: 'Lemo 原生 Agent', messages, signal: options.signal,
        stream: true, captureIncomplete: true, defaultMaxTokens: 16384, maxRetries: 0, timeoutMs: 240000 });
    } catch (error) {
      if (wasGenerationNotSubmitted(error)) {
        await atomic(join(turnDir, 'rejected.json'), { requestId: options.requestId, reason: 'local-authorization-before-dispatch' });
        throw new Error('LLM_NOT_SUBMITTED: ' + (error as Error).message, { cause: error });
      }
      if (error instanceof LlmTextInterruptedError) await atomic(join(turnDir, 'interrupted.json'), error.result);
      if (isDefinitiveLlmProviderRejection(error instanceof Error ? error.message : String(error))) await atomic(join(turnDir, 'rejected.json'), { requestId: options.requestId });
      throw error;
    }
    await atomic(join(turnDir, 'response.json'), response);
  }
  let observation: string, tool = 'invalid_reply';
  try {
    if (/length|max_tokens|incomplete/i.test(response.finishReason ?? '')) throw new Error('LEMO_AGENT_TRUNCATED: reply saved but no source applied. Split the file into smaller modules; do not repeat a giant output.');
    const action = parseLemoAgentAction(response.text); tool = action.tool;
    observation = await executeAction(options, journal, action, turnDir);
  } catch (error) {
    // Local infrastructure failures are not an invitation to buy another model turn.
    // Keep response.json replayable; the same action resumes after the host is repaired.
    options.signal?.throwIfAborted();
    if ((error as Error)?.name === 'AbortError' || error instanceof LemoAgentImageUnknownError
      || /^LEMO_RECOVERY_MUST_NOT_CHARGE/.test((error as Error)?.message ?? '')
      || /^(?:EACCES|EPERM|ENOSPC|EMFILE|ENFILE|EIO|EROFS|EBUSY)$/.test((error as NodeJS.ErrnoException)?.code ?? '')) throw error;
    observation = `Tool rejected; no success claimed: ${error instanceof Error ? error.message : String(error)}. Read actual files and correct the next action.`;
  }
  journal.turns.push({ index, reply: response.text, observation, tool, modelRequestId: response.requestId });
  journal.film = { ...journal.film, turn: index, lastTool: tool, message: observation.slice(0, LEMO_TURN_MESSAGE_LIMIT) };
  await atomic(journalPath, journal);
  await atomic(join(turnDir, 'result.json'), lemoTurnReceipt(journal.film, index));
  return journal.film;
}

/**
 * Per-turn receipt v2. The film's `message` (up to 12 000 chars) is exactly the journal turn's observation
 * prefix, so it is not duplicated per turn; recovery rebuilds it from journal.json and checks `filmHash`.
 * Legacy turn receipts (a bare film) remain readable.
 */
interface LemoTurnReceipt { receipt: 'lemo-turn'; version: 2; turn: number; filmHash: string; film: LemoUpstreamFilm }
const LEMO_TURN_MESSAGE_LIMIT = 12000;
const lemoFilmHash = (film: LemoUpstreamFilm) => hash(JSON.stringify(film));
function lemoTurnReceipt(film: LemoUpstreamFilm, turn: number): LemoTurnReceipt {
  // Overwriting the existing key keeps its position, so the rebuilt film hashes identically.
  return { receipt: 'lemo-turn', version: 2, turn, filmHash: lemoFilmHash(film), film: { ...film, message: '' } };
}
const isLemoTurnReceipt = (value: unknown): value is LemoTurnReceipt => (value as LemoTurnReceipt | undefined)?.receipt === 'lemo-turn';

/** Free recovery: a caller must never dispatch another model request to recover an acknowledged turn. */
export async function recoverLemoUpstreamAgentTurn(root: string, index: number): Promise<LemoUpstreamFilm | undefined> {
  const stored = await readOptional<LemoUpstreamFilm | LemoTurnReceipt>(join(root, `turn-${String(index).padStart(4, '0')}`, 'result.json'));
  if (stored && !isLemoTurnReceipt(stored)) return stored;
  const journal = await readOptional<Journal>(join(root, 'journal.json'));
  if (stored) {
    const turn = journal?.turns.find(item => item.index === index);
    if (turn) {
      const film = { ...stored.film, message: turn.observation.slice(0, LEMO_TURN_MESSAGE_LIMIT) };
      if (lemoFilmHash(film) === stored.filmHash) return film;
    }
  }
  return journal?.film.turn === index ? journal.film : undefined;
}
export async function assertLemoUpstreamFilmCurrent(film: LemoUpstreamFilm, durationSeconds: number) {
  if (film.status !== 'ready' || !film.review?.technicalPassed || !film.visualReview
    || film.review.sourceHash !== film.sourceHash || film.visualReview.sourceHash !== film.sourceHash
    || Math.abs((film.review.durationSeconds ?? 0) - durationSeconds) > 1 / 30
    || await fingerprint(film.directory) !== film.sourceHash) throw new Error('LEMO_AGENT_NOT_READY: 原生工程未完成当前版本审片，不能导出。');
  // Binary assets are outside the source fingerprint; their bytes must still match the manifest.
  await verifyLemoAssets(film.directory);
}
