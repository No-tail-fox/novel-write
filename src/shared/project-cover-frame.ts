import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { runBoundedProcess } from './process-runner';
import { resolveReferenceFfmpeg } from './viral-reference-media';

const pending = new Map<string, Promise<string | null>>();
const failures = new Map<string, number>();
const waiters: Array<() => void> = [];
let active = 0;
let ffmpeg: Promise<string> | undefined;

/** Cache by source revision, and share bounded decoding work across concurrent list reads. */
export async function projectVideoFirstFrame(video: string, workDir: string, options: {
  background?: boolean; onReady?: () => void;
} = {}): Promise<string | null> {
  const source = await stat(video).catch(() => null);
  if (!source?.isFile() || source.size <= 0) return null;
  const key = createHash('sha256').update(`${video}\n${source.mtimeMs}\n${source.size}`).digest('hex');
  const path = join(workDir, 'project-covers', `frame-${key}.jpg`);
  if ((await stat(path).catch(() => null))?.size) return path;
  if ((failures.get(path) ?? 0) > Date.now()) return null;
  const existing = pending.get(path);
  if (existing) return options.background ? null : existing;
  const operation = extract();
  pending.set(path, operation);
  if (options.background) {
    void operation.then((result) => { if (result) options.onReady?.(); }).finally(() => pending.delete(path));
    return null;
  }
  try { return await operation; } finally { pending.delete(path); }

  async function extract(): Promise<string | null> {
    if (active >= 2) await new Promise<void>((resolve) => waiters.push(resolve));
    else active += 1;
    const temporary = join(workDir, 'project-covers', `.frame-${randomUUID()}.jpg`);
    try {
      await mkdir(join(workDir, 'project-covers'), { recursive: true });
      const command = await (ffmpeg ??= resolveReferenceFfmpeg().catch((error) => { ffmpeg = undefined; throw error; }));
      const result = await runBoundedProcess(command, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe',
        '-i', video, '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease',
        '-threads', '1', '-q:v', '3', temporary,
      ], { cwd: workDir, timeoutMs: 10_000, maxStdoutBytes: 4096, maxStderrBytes: 16_384 });
      if (result.code !== 0 || !(await stat(temporary)).size) throw new Error('First frame unavailable');
      await rename(temporary, path);
      return path;
    } catch {
      if (failures.size >= 256) failures.delete(failures.keys().next().value!);
      failures.set(path, Date.now() + 60_000);
      return null;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
      const next = waiters.shift();
      if (next) next();
      else active -= 1;
    }
  }
}
