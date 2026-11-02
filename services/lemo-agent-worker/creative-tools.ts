import { createHash, randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

export const LEMO_CREATIVE_TOOL_LIMITS = Object.freeze({ maxTextBytes: 1024 * 1024, maxImageBytes: 8 * 1024 * 1024, maxDirectoryEntries: 256 });
const toolNames = ['list_directory', 'read_text', 'write_text', 'read_image'] as const;
type ToolName = typeof toolNames[number];
export type LemoCreativeToolName = `mcp__storydream__${ToolName}`;
export interface LemoCreativeToolEvent {
  version: 1;
  operationId: string;
  tool: LemoCreativeToolName;
  phase: 'started' | 'completed' | 'failed';
  argumentsSha256: string;
  at: string;
  resultSha256?: string;
  resultBytes?: number;
  sideEffectApplied?: boolean;
  errorCode?: string;
}
export interface LemoCreativeToolsOptions {
  workspaceRoot: string;
  /** Must durably persist before resolving. Without a sink every invocation fails closed. */
  onToolEvent?: (event: LemoCreativeToolEvent) => Promise<void>;
  signal?: AbortSignal;
  /** Concrete host/upstream directories; they must not overlap the authoring workspace. */
  protectedRoots?: readonly string[];
  maxTextBytes?: number;
  maxImageBytes?: number;
  maxDirectoryEntries?: number;
}
interface Operation { sideEffectApplied: boolean; resultSha256?: string; resultBytes?: number; checkCancelled(): void }
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const textExtensions = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.css', '.html', '.svg', '.yaml', '.yml', '.toml', '.py', '.srt', '.vtt']);
const protectedSegments = new Set(['node_modules', 'vendor', 'lemo-upstream', 'lemo-opuscar', 'electron', 'services',
  'dist-electron', 'dist-renderer', 'private-responses', 'owner-history', 'sdk-state', 'worker-state']);
function fail(code: string): never { throw new Error('LEMO_CREATIVE_' + code); }
function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return !part || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
}
function safeSegment(segment: string): boolean {
  return !!segment && segment !== '.' && segment !== '..' && !segment.startsWith('.') && !/[. ]$/.test(segment)
    && !/[\x00-\x1f\x7f<>:"|?*]/.test(segment) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    && !protectedSegments.has(segment.toLowerCase())
    && !/^(?:auth|credentials?|secrets?|tokens?|api[-_]?keys?|id_rsa|id_ed25519)(?:[._-].*)?$/i.test(segment)
    && !/^(?:config\.toml|settings(?:\.local)?\.json|app\.asar|owner\.lock|recovery\.lock|requests\.jsonl)$/i.test(segment)
    && !/\.(?:pem|key|p12|pfx|kdbx)$/i.test(segment);
}
function relativePath(value: string, allowRoot = false): string {
  if (allowRoot && value === '.') return '';
  if (!value || value.length > 1024 || posix.isAbsolute(value) || win32.isAbsolute(value)) fail('PATH');
  const parts = value.replace(/\\/g, '/').split('/');
  if (!parts.every(safeSegment)) fail('PATH');
  return parts.join('/');
}
async function noLinkedParents(path: string): Promise<void> {
  let current = resolve(path);
  for (;;) {
    try { if ((await lstat(current)).isSymbolicLink()) fail('LINK'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
function identityMatches(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function unchanged(a: Stats, b: Stats): boolean {
  return identityMatches(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
function safeError(error: unknown): string {
  if (error instanceof Error && /^LEMO_CREATIVE_[A-Z_]+$/.test(error.message)) return error.message;
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' ? 'LEMO_CREATIVE_NOT_FOUND' : code === 'EACCES' || code === 'EPERM' ? 'LEMO_CREATIVE_ACCESS' : 'LEMO_CREATIVE_IO';
}
function textResult(text: string, metadata: Record<string, unknown> = {}): CallToolResult {
  return { content: [{ type: 'text', text }], structuredContent: metadata };
}
function builtInProtectedRoots(): string[] {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (basename(directory) !== 'lemo-agent-worker' && dirname(directory) !== directory) directory = dirname(directory);
  if (basename(directory) !== 'lemo-agent-worker') return [dirname(fileURLToPath(import.meta.url))];
  const host = resolve(directory, '../..');
  return [directory, ...['electron', 'src', 'vendor', 'node_modules', 'scripts', 'dist-electron', 'dist-renderer', 'lemo-upstream'].map(name => join(host, name))];
}
function imageMime(bytes: Buffer, extension: string): 'image/png' | 'image/jpeg' {
  if (extension === '.png' && bytes.length >= 57 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8; let header = false; let data = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset); const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (length > bytes.length - offset - 12) fail('IMAGE_TYPE');
      if (!header) {
        if (type !== 'IHDR' || length !== 13 || bytes.readUInt32BE(offset + 8) < 1 || bytes.readUInt32BE(offset + 12) < 1) fail('IMAGE_TYPE');
        header = true;
      } else if (type === 'IHDR') fail('IMAGE_TYPE');
      if (type === 'IDAT') data ||= length > 0;
      offset += length + 12;
      if (type === 'IEND') { if (length !== 0 || !data || offset !== bytes.length) fail('IMAGE_TYPE'); return 'image/png'; }
    }
  }
  if ((extension === '.jpg' || extension === '.jpeg') && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9) {
    let offset = 2; let frame = false;
    while (offset < bytes.length - 2) {
      if (bytes[offset++] !== 0xff) fail('IMAGE_TYPE');
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (offset + 2 > bytes.length || marker === 0xd8 || marker === 0xd9 || marker === 0x00) fail('IMAGE_TYPE');
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length - 2) fail('IMAGE_TYPE');
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8 || bytes.readUInt16BE(offset + 3) < 1 || bytes.readUInt16BE(offset + 5) < 1) fail('IMAGE_TYPE');
        frame = true;
      }
      if (marker === 0xda) { if (!frame) fail('IMAGE_TYPE'); return 'image/jpeg'; }
      offset += length;
    }
  }
  return fail('IMAGE_TYPE');
}

/** Host-owned, in-process file tools, not an OS sandbox. The host must give this server
 * an exclusive authoring workspace and keep credentials/runtime/state elsewhere.
 * No command execution, dependency installation, network operation or automatic replay.
 */
export async function createLemoCreativeTools(options: LemoCreativeToolsOptions) {
  if (!isAbsolute(options.workspaceRoot)) fail('ROOT');
  const limits = { ...LEMO_CREATIVE_TOOL_LIMITS, ...Object.fromEntries(
    ['maxTextBytes', 'maxImageBytes', 'maxDirectoryEntries'].filter(key => options[key as keyof LemoCreativeToolsOptions] !== undefined)
      .map(key => [key, options[key as keyof LemoCreativeToolsOptions]])) } as typeof LEMO_CREATIVE_TOOL_LIMITS;
  if (!Object.values(limits).every(value => Number.isSafeInteger(value) && value > 0)
    || limits.maxTextBytes > 32 * 1024 * 1024 || limits.maxImageBytes > 32 * 1024 * 1024 || limits.maxDirectoryEntries > 10000) fail('LIMITS');
  const root = resolve(options.workspaceRoot); await noLinkedParents(root);
  const rootIdentity = await lstat(root); if (!rootIdentity.isDirectory()) fail('ROOT');
  const canonicalRoot = await realpath(root);
  const protectedRoots = [...builtInProtectedRoots(), ...(options.protectedRoots ?? [])];
  for (const protectedRoot of protectedRoots) {
    if (!isAbsolute(protectedRoot)) fail('ROOT');
    if (inside(resolve(protectedRoot), root) || inside(root, resolve(protectedRoot))) fail('PROTECTED_ROOT');
  }
  const sink = options.onToolEvent; const signal = options.signal;
  let queue = Promise.resolve();
  const assertRoot = async () => {
    await noLinkedParents(root);
    const current = await lstat(root);
    if (!current.isDirectory() || !identityMatches(current, rootIdentity) || await realpath(root) !== canonicalRoot) fail('ROOT_CHANGED');
  };
  const checkedPath = async (value: string, allowRoot = false) => {
    const path = relativePath(value, allowRoot); const absolute = resolve(root, path);
    if (!inside(root, absolute)) fail('PATH');
    await assertRoot(); await noLinkedParents(absolute);
    return { path: path || '.', absolute };
  };
  const readBytes = async (absolute: string, limit: number, operation: Operation): Promise<Buffer> => {
    const before = await lstat(absolute);
    if (!before.isFile() || before.nlink !== 1) fail('FILE_TYPE');
    if (before.size > limit) fail('FILE_LIMIT');
    const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const initial = await handle.stat();
      if (!initial.isFile() || initial.nlink !== 1 || !unchanged(before, initial)) fail('FILE_CHANGED');
      const chunks: Buffer[] = []; let size = 0;
      for (;;) {
        operation.checkCancelled();
        const buffer = Buffer.alloc(Math.min(65536, limit + 1 - size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead; if (size > limit) fail('FILE_LIMIT');
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const final = await handle.stat();
      if (final.nlink !== 1 || size !== final.size || !unchanged(initial, final)) fail('FILE_CHANGED');
      await noLinkedParents(absolute);
      if (!unchanged(final, await lstat(absolute))) fail('FILE_CHANGED');
      return Buffer.concat(chunks, size);
    } finally { await handle.close(); }
  };
  const execute = async (name: ToolName, args: Record<string, unknown>, extra: unknown, action: (operation: Operation) => Promise<CallToolResult>) => {
    const operationId = randomUUID(); const fullName: LemoCreativeToolName = `mcp__storydream__${name}`;
    const argumentsSha256 = sha256(JSON.stringify(Object.keys(args).sort().map(key => [key, args[key]])));
    const requestSignal = extra && typeof extra === 'object' && 'signal' in extra && extra.signal instanceof AbortSignal ? extra.signal : undefined;
    const operation: Operation = { sideEffectApplied: false, checkCancelled: () => { if (signal?.aborted || requestSignal?.aborted) fail('CANCELLED'); } };
    const previous = queue; let release!: () => void; queue = new Promise<void>(done => { release = done; });
    await previous;
    const emit = async (phase: LemoCreativeToolEvent['phase'], errorCode?: string) => {
      if (!sink) fail('AUDIT_REQUIRED');
      try { await sink({ version: 1, operationId, tool: fullName, phase, argumentsSha256, at: new Date().toISOString(),
        ...(phase === 'started' ? {} : { sideEffectApplied: operation.sideEffectApplied,
          ...(operation.resultSha256 ? { resultSha256: operation.resultSha256 } : {}),
          ...(operation.resultBytes === undefined ? {} : { resultBytes: operation.resultBytes }), ...(errorCode ? { errorCode } : {}) }) }); }
      catch { fail('AUDIT_FAILED'); }
    };
    try {
      operation.checkCancelled(); await emit('started'); operation.checkCancelled();
      const result = await action(operation);
      await emit('completed');
      return { ...result, structuredContent: { ...result.structuredContent, operationId } };
    } catch (error) {
      let code = safeError(error);
      if (sink) { try { await emit('failed', code); } catch { code = 'LEMO_CREATIVE_AUDIT_FAILED'; } }
      return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ code, operationId,
        sideEffectApplied: operation.sideEffectApplied, ...(operation.resultSha256 ? { resultSha256: operation.resultSha256 } : {}) }) }] };
    } finally { release(); }
  };
  const pathSchema = z.string().min(1).max(1024);
  const definitions = [
    tool('list_directory', 'List safe project files and directories inside the authoring workspace.', { path: pathSchema.default('.') }, (args, extra) =>
      execute('list_directory', args, extra, async operation => {
        const target = await checkedPath(args.path, true); if (!(await lstat(target.absolute)).isDirectory()) fail('DIRECTORY_TYPE');
        const entries: Array<{ name: string; type: 'file' | 'directory'; bytes?: number }> = []; let count = 0;
        const directory = await opendir(target.absolute);
        for await (const entry of directory) {
          operation.checkCancelled(); if (++count > limits.maxDirectoryEntries) fail('DIRECTORY_LIMIT');
          if (!safeSegment(entry.name)) continue;
          const stat = await lstat(join(target.absolute, entry.name));
          if (stat.isSymbolicLink()) continue;
          if (stat.isDirectory()) entries.push({ name: entry.name, type: 'directory' });
          else if (stat.isFile() && stat.nlink === 1 && (textExtensions.has(extname(entry.name).toLowerCase()) || /\.(?:png|jpe?g)$/i.test(entry.name)))
            entries.push({ name: entry.name, type: 'file', bytes: stat.size });
        }
        await assertRoot(); await noLinkedParents(target.absolute);
        entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
        const text = JSON.stringify({ path: target.path, entries }); operation.resultSha256 = sha256(text);
        return textResult(text, { path: target.path, entries });
      })),
    tool('read_text', 'Read a bounded UTF-8 project treatment, source file or manifest.', { path: pathSchema }, (args, extra) =>
      execute('read_text', args, extra, async operation => {
        const target = await checkedPath(args.path); if (!textExtensions.has(extname(target.path).toLowerCase())) fail('TEXT_TYPE');
        const bytes = await readBytes(target.absolute, limits.maxTextBytes, operation);
        let text: string; try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { fail('UTF8'); }
        if (text.includes('\0')) fail('TEXT_TYPE');
        operation.resultSha256 = sha256(bytes); operation.resultBytes = bytes.length;
        return textResult(text, { path: target.path, bytes: bytes.length, sha256: operation.resultSha256 });
      })),
    tool('write_text', 'Atomically write bounded UTF-8 project content. Does not execute code or install dependencies.',
      { path: pathSchema, content: z.string().max(limits.maxTextBytes) }, (args, extra) => execute('write_text', args, extra, async operation => {
        const target = await checkedPath(args.path); if (!textExtensions.has(extname(target.path).toLowerCase())) fail('TEXT_TYPE');
        const bytes = Buffer.from(args.content, 'utf8');
        if (bytes.length > limits.maxTextBytes) fail('FILE_LIMIT');
        if (bytes.toString('utf8') !== args.content) fail('UTF8');
        if (args.content.includes('\0')) fail('TEXT_TYPE');
        let parent = root;
        for (const part of relative(root, dirname(target.absolute)).split(sep).filter(Boolean)) {
          operation.checkCancelled(); parent = join(parent, part); await noLinkedParents(parent);
          try { await mkdir(parent, { mode: 0o700 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
          await noLinkedParents(parent); if (!(await lstat(parent)).isDirectory() || !inside(canonicalRoot, await realpath(parent))) fail('PATH');
        }
        let before: Stats | undefined;
        try { before = await lstat(target.absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (before && (!before.isFile() || before.nlink !== 1)) fail('FILE_TYPE');
        const temporary = join(dirname(target.absolute), `.${basename(target.absolute)}-${randomUUID()}.pending`);
        const handle = await open(temporary, 'wx', 0o600); const identity = await handle.stat();
        try {
          operation.checkCancelled(); await handle.writeFile(bytes); await handle.sync(); await handle.close();
          operation.checkCancelled(); await assertRoot(); await noLinkedParents(target.absolute);
          let current: Stats | undefined;
          try { current = await lstat(target.absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          if (before ? !current || current.nlink !== 1 || !unchanged(before, current) : current !== undefined) fail('TARGET_CHANGED');
          const staged = await lstat(temporary);
          if (!staged.isFile() || staged.nlink !== 1 || !identityMatches(staged, identity)) fail('FILE_CHANGED');
          operation.checkCancelled(); await rename(temporary, target.absolute);
          operation.sideEffectApplied = true; operation.resultSha256 = sha256(bytes); operation.resultBytes = bytes.length;
          const result = { path: target.path, bytes: bytes.length, sha256: operation.resultSha256 };
          return textResult(JSON.stringify(result), result);
        } finally {
          await handle.close().catch(() => {});
          try { const current = await lstat(temporary); if (identityMatches(current, identity) && current.nlink === 1) await unlink(temporary); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      })),
    tool('read_image', 'Read a bounded PNG or JPEG project preview as an MCP image. No remote URLs.', { path: pathSchema }, (args, extra) =>
      execute('read_image', args, extra, async operation => {
        const target = await checkedPath(args.path); const extension = extname(target.path).toLowerCase();
        if (!['.png', '.jpg', '.jpeg'].includes(extension)) fail('IMAGE_TYPE');
        const bytes = await readBytes(target.absolute, limits.maxImageBytes, operation); const mimeType = imageMime(bytes, extension);
        operation.resultSha256 = sha256(bytes); operation.resultBytes = bytes.length;
        return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType }],
          structuredContent: { path: target.path, bytes: bytes.length, sha256: operation.resultSha256 } };
      })),
  ];
  const server = createSdkMcpServer({ name: 'storydream', version: '1.0.0', tools: definitions,
    instructions: 'Operate only on this project workspace. These host file tools are not an OS sandbox. No shell, network or dynamic execution is available. Never automatically replay a failed write; inspect its operation receipt.' });
  const allowedToolNames = toolNames.map((name): LemoCreativeToolName => `mcp__storydream__${name}`);
  return { server, allowedToolNames, definitions };
}
