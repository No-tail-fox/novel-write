import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { AppError } from '../src/shared/app-error';

export async function hashDirectorRenderOutput(path: string, expectedSize: number): Promise<string> {
  const handle = await open(path, 'r');
  const changed = () => new AppError('DIRECTOR_RENDER_OUTPUT_CHANGED', '成片文件在登记前发生变化，请重新导出。', true);
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.size <= 0 || initial.size !== BigInt(expectedSize)) throw changed();
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < expectedSize) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expectedSize - position), position);
      if (bytesRead === 0) throw changed();
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const same = (current: typeof initial) => current.isFile() && current.dev === initial.dev && current.ino === initial.ino
      && current.size === initial.size && current.mtimeNs === initial.mtimeNs && current.ctimeNs === initial.ctimeNs;
    if (!same(await handle.stat({ bigint: true })) || !same(await stat(path, { bigint: true }))) throw changed();
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}
