import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, rename, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { REFERENCE_TRACK_LABELS, referenceManifestSchema, referencePartSchema, validateReferenceDocument, type ReferenceManifest, type ReferencePart } from './viral-reference';

export type ReferenceIndexPointer = { path: string; hash: string; revision: number };
export const referenceHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const safeId = /^[A-Za-z0-9_-]{1,160}$/;
const mediaSchema = z.object({ id: z.string().regex(safeId), path: z.string().max(4096), mime: z.string().max(100) }).strict();

/** All callers pass the database-owned managed directory, never a renderer path. */
export async function referenceManagedFile(workDir: string, path: string): Promise<string> {
  const root = await realpath(workDir);
  const entryRoot = resolve(workDir);
  const requested = resolve(workDir, path);
  const entryRel = relative(entryRoot, requested);
  const candidate = !entryRel.startsWith('..') && !isAbsolute(entryRel) ? resolve(root, entryRel) : requested;
  const rel = relative(root, candidate);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('VIRAL_REFERENCE_PATH: 路径超出分析目录。');
  let cursor = root;
  if ((await lstat(entryRoot)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH: 拒绝链接目录。');
  for (const segment of rel.split(sep)) {
    cursor = join(cursor, segment);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH: 拒绝符号链接。');
  }
  const actual = await realpath(candidate);
  const actualRel = relative(root, actual);
  if (!actualRel || actualRel.startsWith('..') || isAbsolute(actualRel) || !(await stat(actual)).isFile()) {
    throw new Error('VIRAL_REFERENCE_PATH: 非受管普通文件。');
  }
  return actual;
}

export async function readReferenceJson<T>(workDir: string, path: string, schema: z.ZodType<T>, hash?: string): Promise<T> {
  const file = await referenceManagedFile(workDir, path);
  if ((await stat(file)).size > 8 * 1024 * 1024) throw new Error('VIRAL_REFERENCE_TOO_LARGE: 索引/分片超出 8 MiB。');
  const bytes = await readFile(file);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('VIRAL_REFERENCE_TOO_LARGE');
  if (hash && referenceHash(bytes) !== hash) throw new Error('VIRAL_REFERENCE_CORRUPT: 文件校验失败。');
  return schema.parse(JSON.parse(bytes.toString('utf8')));
}

export async function writeReferenceJson(workDir: string, kind: string, value: unknown): Promise<{ path: string; hash: string }> {
  if (!safeId.test(kind)) throw new Error('Invalid reference artifact kind.');
  await mkdir(workDir, { recursive: true });
  if ((await lstat(workDir)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH: 拒绝链接目录。');
  const root = join(workDir, 'reference');
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH: 拒绝链接目录。');
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('VIRAL_REFERENCE_TOO_LARGE: 请继续分片。');
  const hash = referenceHash(body);
  const path = `reference/${kind}-${hash}.json`;
  const temp = join(root, `${randomUUID()}.partial`);
  const handle = await open(temp, 'wx');
  try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, join(workDir, path));
  return { path, hash };
}

export async function readReferenceManifest(workDir: string, pointer: ReferenceIndexPointer): Promise<ReferenceManifest> {
  const manifest = await readReferenceJson(workDir, pointer.path, referenceManifestSchema, pointer.hash);
  if (manifest.revision !== pointer.revision) throw new Error('VIRAL_REFERENCE_CORRUPT: 索引版本不匹配。');
  return manifest;
}

export async function readReferencePart(workDir: string, manifest: ReferenceManifest, partId: string): Promise<ReferencePart> {
  const entry = manifest.parts.find(part => part.partId === partId);
  if (!entry) throw new Error('VIRAL_REFERENCE_PART_NOT_FOUND');
  const part = await readReferenceJson(workDir, entry.artifactPath, referencePartSchema, entry.artifactHash);
  if (part.partId !== entry.partId || part.sourceMediaSha256 !== manifest.sourceMediaSha256) throw new Error('VIRAL_REFERENCE_CORRUPT: 分片归属不符。');
  return part;
}

export async function registerReferenceMedia(workDir: string, id: string, file: string, mime: string): Promise<void> {
  if (!safeId.test(id)) throw new Error('Invalid media id.');
  const actual = await referenceManagedFile(workDir, file);
  const mediaDir = join(workDir, 'reference-media');
  await mkdir(mediaDir, { recursive: true });
  if ((await lstat(mediaDir)).isSymbolicLink()) throw new Error('VIRAL_REFERENCE_PATH');
  const body = JSON.stringify(mediaSchema.parse({ id, path: relative(await realpath(workDir), actual), mime }));
  const temp = join(mediaDir, `${randomUUID()}.partial`);
  const handle = await open(temp, 'wx');
  try { await handle.writeFile(body, 'utf8'); await handle.sync(); } finally { await handle.close(); }
  await rename(temp, join(mediaDir, `${id}.json`));
}

export async function resolveReferenceMedia(workDir: string, id: string): Promise<{ path: string; mime: string }> {
  if (!safeId.test(id)) throw new Error('Invalid media id.');
  const media = await readReferenceJson(workDir, `reference-media/${id}.json`, mediaSchema);
  if (media.id !== id) throw new Error('VIRAL_REFERENCE_MEDIA_MISMATCH');
  return { path: await referenceManagedFile(workDir, media.path), mime: media.mime };
}

export async function exportReferenceReport(workDir: string, manifest: ReferenceManifest, format: 'json' | 'markdown' | 'csv'): Promise<string> {
  const parts: ReferencePart[] = [];
  for (const entry of manifest.parts) parts.push(await readReferencePart(workDir, manifest, entry.partId));
  if (validateReferenceDocument(manifest, parts).length) throw new Error('VIRAL_REFERENCE_CORRUPT: 报告汇总与分片不一致。');
  if (format === 'json') return JSON.stringify({ manifest, parts }, null, 2);
  const observations = parts.flatMap(part => [...part.observations, ...part.shots.flatMap(shot => shot.observations)]);
  if (format === 'csv') {
    const cell = (value: unknown) => `"${String(value).replace(/"/g, '""').replace(/^(\s*[=+@-])/, "'$1")}"`;
    return '\uFEFF' + [['轨道', '开始毫秒', '结束毫秒', '证据状态', '内容'], ...observations.map(item => [item.track, item.range.startMs, item.range.endMs, item.state, item.text])].map(row => row.map(cell).join(',')).join('\r\n');
  }
  return ['# 整体拆解报告', '', `时长：${(manifest.durationMs / 1000).toFixed(2)} 秒；修订：${manifest.revision}`, '',
    ...(manifest.summary ? ['## 全片总结', '', manifest.summary.overview, '', manifest.summary.narrative, '', manifest.summary.rhythm, '',
      '## 制作规律', '', ...manifest.summary.productionRules.map(item => `- ${item}`), '', '## 分析限制', '', ...manifest.summary.limitations.map(item => `- ${item}`), ''] : []),
    '## 覆盖情况', '', ...manifest.coverageSummary.map(item => `- ${REFERENCE_TRACK_LABELS[item.track]}：已观察 ${(item.observedMs / 1000).toFixed(1)}s / 推断 ${(item.inferredMs / 1000).toFixed(1)}s / 未分析 ${(item.notAnalyzedMs / 1000).toFixed(1)}s`), '', '## 逐段观察', '',
    ...observations.map(item => `- [${(item.range.startMs / 1000).toFixed(2)}–${(item.range.endMs / 1000).toFixed(2)}s] ${REFERENCE_TRACK_LABELS[item.track]} / ${item.state}：${item.text}`), '',
  ].join('\n');
}
