import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
/** Content identity excludes host outputs but includes authored audio scripts and mix design. */
export async function piFilmSourceHash(root: string): Promise<string> {
  const digest = createHash('sha256');
  let bytes = 0;
  const walk = async (directory: string, prefix: string) => {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (!prefix && ['out', 'material', 'assets'].includes(entry.name.toLowerCase())) continue;
      const path = join(directory, entry.name), relative = prefix + entry.name;
      const info = await lstat(path);
      if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1) throw new Error('PI_SOURCE_LINK');
      if (info.isDirectory()) await walk(path, relative + '/');
      else {
        bytes += info.size;
        if (bytes > 32 * 1024 * 1024) throw new Error('PI_SOURCE_SIZE');
        const content = await readFile(path);
        digest.update(relative).update('\0').update(String(content.length)).update('\0').update(content);
      }
    }
  };
  await walk(root, ''); return digest.digest('hex');
}
export const piDataHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
