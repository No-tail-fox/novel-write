import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { JianyingEffectCatalog } from './types';

const execFileAsync = promisify(execFile);

export const fallbackJianyingEffectCatalog: Pick<JianyingEffectCatalog, 'transitions' | 'filters' | 'videoEffects' | 'audioEffects'> = {
  transitions: ['叠化'],
  filters: [],
  videoEffects: [],
  audioEffects: [],
};

export interface LoadJianyingEffectCatalogOptions {
  pythonCommand?: string;
  execute?: (
    command: string,
    args: string[],
    options: { cwd?: string },
  ) => Promise<{
    stdout: string;
    stderr: string;
  }>;
}

export async function loadJianyingEffectCatalog(options: LoadJianyingEffectCatalogOptions = {}): Promise<JianyingEffectCatalog> {
  const execute = options.execute ?? ((command, args, execOptions) => execFileAsync(command, args, execOptions));
  try {
    const { stdout } = await execute(options.pythonCommand ?? 'python', ['-c', effectCatalogPythonScript], {});
    const payload = parseCatalog(stdout);
    return {
      status: 'pass',
      detail: 'pyJianYingDraft effect catalog loaded.',
      transitions: normalizeNames(payload.transitions, fallbackJianyingEffectCatalog.transitions),
      filters: normalizeNames(payload.filters, []),
      videoEffects: normalizeNames(payload.videoEffects, []),
      audioEffects: normalizeNames(payload.audioEffects, []),
    };
  } catch (error) {
    return {
      status: 'warn',
      detail: `Using fallback Jianying effect catalog: ${error instanceof Error ? error.message : String(error)}`,
      ...fallbackJianyingEffectCatalog,
    };
  }
}

function parseCatalog(stdout: string): Partial<JianyingEffectCatalog> {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.startsWith('{') && line.endsWith('}'));
  if (!jsonLine) throw new Error('pyJianYingDraft effect catalog did not return JSON output.');
  return JSON.parse(jsonLine) as Partial<JianyingEffectCatalog>;
}

function normalizeNames(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const names = value.map((item) => String(item ?? '').trim()).filter(Boolean);
  return names.length ? [...new Set(names)] : fallback;
}

const effectCatalogPythonScript = String.raw`import json

import pyJianYingDraft as draft


def enum_names(enum_name):
    enum_cls = getattr(draft, enum_name, None)
    if enum_cls is None:
        return []
    try:
        return [item.name for item in enum_cls]
    except TypeError:
        return [
            name
            for name in dir(enum_cls)
            if not name.startswith("_") and hasattr(getattr(enum_cls, name), "name")
        ]


print(json.dumps({
    "transitions": enum_names("TransitionType"),
    "filters": enum_names("FilterType"),
    "videoEffects": enum_names("VideoSceneEffectType"),
    "audioEffects": enum_names("AudioSceneEffectType"),
}, ensure_ascii=False))
`;
