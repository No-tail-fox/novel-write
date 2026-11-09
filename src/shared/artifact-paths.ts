import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const ARTIFACT_STORAGE_DIRECTORIES = Object.freeze([
  'tasks', 'viral-analyses', 'image-lab', 'voice-lab', 'pending-task-covers',
  'video-lab', 'music-lab', 'music-voices', 'music-enhanced', 'bgm',
  'person-assets', 'scene-video-library', 'asset-library', 'vox-templates',
  'motion-comic-planning', 'custom-style-previews',
] as const);

/** Rebase managed paths only; configuration, external imports and relative paths stay intact. */
export function rebaseArtifactPathText(text: string, sources: readonly string[], target: string): string {
  if (isAbsolute(text)) {
    for (const source of sources) {
      const suffix = relative(resolve(source), resolve(text));
      if (!suffix || suffix === '..' || suffix.startsWith('..' + sep) || isAbsolute(suffix)) continue;
      if (!(ARTIFACT_STORAGE_DIRECTORIES as readonly string[]).includes(suffix.split(sep)[0])) continue;
      return join(target, suffix);
    }
  }
  // Persisted task documents can themselves contain serialized JSON documents.
  if (!/^[\s]*[\[{]/u.test(text)) return text;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return text; }
  let changed = false;
  const visit = (input: unknown): unknown => {
    if (typeof input === 'string') {
      const next = rebaseArtifactPathText(input, sources, target);
      if (next !== input) changed = true;
      return next;
    }
    if (Array.isArray(input)) return input.map(visit);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, visit(item)]));
    return input;
  };
  const next = visit(value);
  return changed ? JSON.stringify(next) : text;
}
