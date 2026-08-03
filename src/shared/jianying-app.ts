import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface JianyingExecutableSearchOptions {
  localAppData?: string;
  programFiles?: string;
  programFilesX86?: string;
}

export async function findJianyingExecutable(options: JianyingExecutableSearchOptions = {}): Promise<string | null> {
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA ?? '';
  const programFiles = options.programFiles ?? process.env.ProgramFiles ?? '';
  const programFilesX86 = options.programFilesX86 ?? process.env['ProgramFiles(x86)'] ?? '';
  const candidates: string[] = [];

  if (localAppData) {
    const appRoot = join(localAppData, 'JianyingPro');
    const appsRoot = join(appRoot, 'Apps');
    candidates.push(join(appsRoot, 'JianyingPro.exe'));
    const versions = await readdir(appsRoot, { withFileTypes: true })
      .then((entries) => entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true })))
      .catch(() => [] as string[]);
    candidates.push(...versions.map((version) => join(appsRoot, version, 'JianyingPro.exe')));
    candidates.push(join(appRoot, 'JianyingPro.exe'));
  }

  for (const root of [programFiles, programFilesX86].filter(Boolean)) {
    candidates.push(join(root, 'JianyingPro', 'Apps', 'JianyingPro.exe'));
    candidates.push(join(root, 'JianyingPro', 'JianyingPro.exe'));
  }

  for (const candidate of [...new Set(candidates)]) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  return null;
}
