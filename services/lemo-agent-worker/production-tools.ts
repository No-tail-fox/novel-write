import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { extname, isAbsolute, join, posix, win32 } from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { validateLemoAgentHostToolResult, type LemoAgentHostToolRequest, type LemoAgentHostToolResult } from '../../src/shared/lemo-agent-session';
import { LEMO_SDK_UPSTREAM_REVISION } from './policy';
import { rejectLedgerLinks } from './ledger-owner';
import type { LemoStageToolEvent } from './stage-store';

const MANIFEST_SHA256 = '6dbd77ed1b3ffefe06466b3da670843b2dcb9cf9a2015e60dead8ce47e357d67';
const MAX_LIBRARY_BYTES = 2 * 1024 * 1024;
const MAX_READ_CHARACTERS = 65536;
const textExtensions = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.svg', '.yml', '.yaml', '.py', '.sh']);
const names = ['review_film', 'read_library', 'finish_film'] as const;
type ToolName = typeof names[number];
export type LemoProductionToolName = `mcp__storydream_film__${ToolName}`;
export interface LemoProductionToolsOptions {
  upstreamRoot: string; runId: string; stageId: string; signal?: AbortSignal;
  invokeHostTool(request: LemoAgentHostToolRequest): Promise<LemoAgentHostToolResult>;
  onToolEvent(event: LemoStageToolEvent): Promise<void>;
  onFatal?: (code: string) => void;
}
interface ManifestEntry { path: string; sha256: string; bytes: number; mode: string }
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
function fail(code: string): never { throw new Error('LEMO_FILM_' + code); }
function safeError(error: unknown) {
  return error instanceof Error && /^LEMO_FILM_[A-Z_]+$/.test(error.message) ? error.message : 'LEMO_FILM_OPERATION_FAILED';
}
function cleanPath(value: unknown, hidden = false): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && !posix.isAbsolute(value) && !win32.isAbsolute(value)
    && !/[\\:\x00-\x1f\x7f<>"|?*]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'
      && !/[. ]$/.test(part) && (hidden || !part.startsWith('.')) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part));
}
function unchanged(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && b.nlink === 1 && b.isFile();
}
async function readRegular(path: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer> {
  await rejectLedgerLinks(path);
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) fail('LIBRARY_FILE');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const first = await handle.stat(); if (!unchanged(before, first)) fail('LIBRARY_CHANGED');
    const chunks: Buffer[] = []; let size = 0;
    for (;;) {
      if (signal?.aborted) fail('CANCELLED');
      const buffer = Buffer.alloc(Math.min(65536, maxBytes + 1 - size));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      size += bytesRead; if (size > maxBytes) fail('LIBRARY_LIMIT'); chunks.push(buffer.subarray(0, bytesRead));
    }
    const final = await handle.stat(); await rejectLedgerLinks(path);
    if (size !== final.size || !unchanged(first, final) || !unchanged(final, await lstat(path))) fail('LIBRARY_CHANGED');
    return Buffer.concat(chunks, size);
  } finally { await handle.close(); }
}
async function pinnedManifest(root: string, signal?: AbortSignal) {
  const bytes = await readRegular(join(root, 'storydream-upstream.json'), MAX_LIBRARY_BYTES, signal);
  if (sha256(bytes) !== MANIFEST_SHA256) fail('LIBRARY_MANIFEST_CHANGED');
  let manifest: { schemaVersion: number; revision: string; files: ManifestEntry[] };
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('LIBRARY_MANIFEST'); }
  if (manifest.schemaVersion !== 1 || manifest.revision !== LEMO_SDK_UPSTREAM_REVISION || !Array.isArray(manifest.files)
    || manifest.files.length > 10000) fail('LIBRARY_MANIFEST');
  const entries = new Map<string, ManifestEntry>();
  for (const entry of manifest.files) {
    if (!entry || !cleanPath(entry.path, true) || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !['100644', '100755'].includes(entry.mode)
      || entries.has(entry.path)) fail('LIBRARY_MANIFEST');
    entries.set(entry.path, entry);
  }
  return entries;
}
function validateImages(result: LemoAgentHostToolResult) {
  for (const part of result.content) {
    if (part.type !== 'image') continue;
    const bytes = Buffer.from(part.data, 'base64');
    if (bytes.toString('base64') !== part.data) fail('HOST_IMAGE');
    if (part.mimeType === 'image/png') {
      if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('HOST_IMAGE');
      let offset = 8; let header = false; let imageData = false; let ended = false;
      while (offset + 12 <= bytes.length) {
        const size = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
        if (size > bytes.length - offset - 12) fail('HOST_IMAGE');
        if (!header) {
          if (type !== 'IHDR' || size !== 13 || bytes.readUInt32BE(offset + 8) < 1 || bytes.readUInt32BE(offset + 12) < 1) fail('HOST_IMAGE');
          header = true;
        } else if (type === 'IHDR') fail('HOST_IMAGE');
        if (type === 'IDAT') imageData ||= size > 0;
        offset += size + 12;
        if (type === 'IEND') { if (size !== 0 || !imageData || offset !== bytes.length) fail('HOST_IMAGE'); ended = true; break; }
      }
      if (!ended) fail('HOST_IMAGE');
    } else if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) fail('HOST_IMAGE');
  }
}

/** Host-owned rendering capabilities and read-only, hash-pinned upstream text.
 * A tool/model response cannot manufacture host acceptance or execute programs.
 */
export async function createLemoProductionTools(options: LemoProductionToolsOptions) {
  if (!isAbsolute(options.upstreamRoot) || ![options.runId, options.stageId].every(value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value))
    || typeof options.invokeHostTool !== 'function' || typeof options.onToolEvent !== 'function') fail('OPTIONS');
  await pinnedManifest(options.upstreamRoot, options.signal);
  let queue = Promise.resolve(); let poisoned = false; let assistantTurn = 0; let reviewedAt: number | undefined;
  const turns = new Set<string>();
  const fatal = (code: string) => { poisoned = true; try { options.onFatal?.(code); } catch { /* Keep protocol error sanitized. */ } };
  const execute = async (name: ToolName, args: Record<string, unknown>, extra: unknown,
    action: (state: { sideEffectApplied: boolean; check(): void }) => Promise<LemoAgentHostToolResult>, operationId = randomUUID()): Promise<CallToolResult> => {
    const requestSignal = extra && typeof extra === 'object' && 'signal' in extra && extra.signal instanceof AbortSignal ? extra.signal : undefined;
    const state = { sideEffectApplied: false, check() { if (poisoned) fail('UNAVAILABLE'); if (options.signal?.aborted || requestSignal?.aborted) fail('CANCELLED'); } };
    const toolName: LemoProductionToolName = ('mcp__storydream_film__' + name) as LemoProductionToolName;
    const argumentsSha256 = sha256(JSON.stringify(Object.keys(args).sort().map(key => [key, args[key]])));
    const previous = queue; let release!: () => void; queue = new Promise<void>(resolve => { release = resolve; }); await previous;
    let started = false; let terminal = false; let resultSha256: string | undefined; let resultBytes: number | undefined;
    const emit = async (phase: LemoStageToolEvent['phase'], errorCode?: string) => {
      try { await options.onToolEvent({ version: 1, operationId, tool: toolName, phase, argumentsSha256, at: new Date().toISOString(),
        ...(phase === 'started' ? {} : { sideEffectApplied: state.sideEffectApplied,
          ...(resultSha256 ? { resultSha256 } : {}), ...(resultBytes === undefined ? {} : { resultBytes }), ...(errorCode ? { errorCode } : {}) }) }); }
      catch { fatal('LEMO_FILM_AUDIT_FAILED'); fail('AUDIT_FAILED'); }
    };
    try {
      state.check(); await emit('started'); started = true; state.check();
      const result = validateLemoAgentHostToolResult(await action(state)); validateImages(result);
      const serialized = JSON.stringify(result); resultSha256 = sha256(serialized); resultBytes = Buffer.byteLength(serialized);
      state.check();
      if (result.isError) fail('HOST_FAILED');
      if (name === 'review_film' && !result.content.some(part => part.type === 'image')) fail('REVIEW_IMAGES_REQUIRED');
      await emit('completed'); terminal = true;
      if (name === 'review_film') reviewedAt = assistantTurn;
      return { content: result.content };
    } catch (error) {
      let code = safeError(error);
      if (started && !terminal) { try { await emit('failed', code); } catch { code = 'LEMO_FILM_AUDIT_FAILED'; } }
      if (state.sideEffectApplied || code === 'LEMO_FILM_AUDIT_FAILED') fatal(code);
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code, operationId, sideEffectApplied: state.sideEffectApplied }) }] };
    } finally { release(); }
  };
  const invoke = (name: 'review_film' | 'finish_film', args: { notes?: string }, extra: unknown) => {
    const operationId = randomUUID();
    return execute(name, args, extra, async state => {
      if (name === 'finish_film' && (reviewedAt === undefined || assistantTurn <= reviewedAt)) fail('REVIEW_REQUIRED');
      state.check(); state.sideEffectApplied = true;
      const result = validateLemoAgentHostToolResult(await options.invokeHostTool({ version: 1, action: 'host-tool',
        runId: options.runId, stageId: options.stageId, operationId, tool: name, input: args }));
      state.sideEffectApplied = result.sideEffectApplied ?? true;
      return result;
    }, operationId);
  };
  const notes = z.string().min(20).max(8000).refine(value => value.trim().length >= 20);
  const definitions = [
    tool('review_film', 'Ask the trusted host to render and capture actual current-source frames. Inspect the returned images in the next model turn before finish_film.',
      {}, (args, extra) => invoke('review_film', args, extra)),
    tool('read_library', 'Read verified original UTF-8 Lemo library source such as DIRECTOR.md, TECHNIQUE.md, styles/<id>/STYLE.md or core modules. Offset and length count characters.',
      { path: z.string().min(1).max(1024), offset: z.number().int().min(0).max(MAX_LIBRARY_BYTES).default(0),
        length: z.number().int().min(1).max(MAX_READ_CHARACTERS).default(24000) }, (args, extra) => execute('read_library', args, extra, async state => {
        if (!cleanPath(args.path) || !textExtensions.has(extname(args.path).toLowerCase())) fail('LIBRARY_PATH');
        const entries = await pinnedManifest(options.upstreamRoot, options.signal); const entry = entries.get(args.path);
        if (!entry || entry.bytes > MAX_LIBRARY_BYTES) fail('LIBRARY_DENIED');
        state.check(); const bytes = await readRegular(join(options.upstreamRoot, args.path), MAX_LIBRARY_BYTES, options.signal);
        if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail('LIBRARY_CHANGED');
        let body: string; try { body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return fail('LIBRARY_UTF8'); }
        if (body.includes('\0')) fail('LIBRARY_TEXT');
        return { content: [{ type: 'text', text: JSON.stringify({ path: args.path, offset: args.offset, totalCharacters: body.length,
          sha256: entry.sha256, text: body.slice(args.offset, args.offset + args.length) }) }] };
      })),
    tool('finish_film', 'Ask the trusted host to accept sources only after reviewing actual current-source frame images in a subsequent model turn. Notes must describe observed visual findings; the host independently checks readiness.',
      { notes }, (args, extra) => invoke('finish_film', args, extra)),
  ];
  const server = createSdkMcpServer({ name: 'storydream_film', version: '1.0.0', tools: definitions,
    instructions: 'Read pinned library text and author original project files using the separate storydream file tools. Review actual host-rendered images, repair sources if needed, and only then call finish_film. No shell, network, dynamic script execution or fabricated ready state is available.' });
  return { server, definitions, allowedToolNames: names.map(name => ('mcp__storydream_film__' + name) as LemoProductionToolName),
    reviewState() { return { assistantTurn, ...(reviewedAt === undefined ? {} : { reviewedAt }) }; },
    restoreReviewState(value: { assistantTurn: number; reviewedAt?: number }) {
      if (!value || !Number.isSafeInteger(value.assistantTurn) || value.assistantTurn < 0 || value.assistantTurn > 1000
        || (value.reviewedAt !== undefined && (!Number.isSafeInteger(value.reviewedAt) || value.reviewedAt < 0 || value.reviewedAt > value.assistantTurn))) fail('REVIEW_STATE');
      assistantTurn = value.assistantTurn; reviewedAt = value.reviewedAt;
    },
    noteAssistantTurn(id: string) { if (id && !turns.has(id)) { turns.add(id); assistantTurn++; } } };
}
