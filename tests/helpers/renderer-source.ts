import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface RendererSources {
  all: string;
  file(path: string): string | null;
  requiredFile(path: string): string;
}

export async function readRendererSources(): Promise<RendererSources> {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', 'src'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  const paths = stdout
    .split('\0')
    .map(normalizeRendererPath)
    .filter((path) => /^src\/.*\.tsx?$/.test(path))
    .sort(comparePaths);
  const entries = await Promise.all(
    paths.map(async (path) => [path, await readFile(resolve(projectRoot, ...path.split('/')), 'utf8')] as const),
  );
  const sources = new Map(entries);

  return {
    all: entries.map(([, source]) => source).join('\n'),
    file(path) {
      return sources.get(normalizeRendererPath(path)) ?? null;
    },
    requiredFile(path) {
      const normalizedPath = normalizeRendererPath(path);
      const source = sources.get(normalizedPath);
      if (source === undefined) {
        throw new Error(`Required renderer source is not tracked: ${normalizedPath}`);
      }
      return source;
    },
  };
}

function normalizeRendererPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
