import { lstat, mkdir, readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const sourceExtension = /\.(?:html|m?js|css|json|md|txt|svg|py)$/i;
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
function inside(root: string, candidate: string) {
  const rel = relative(root, candidate);
  return !rel || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
}
function components(path: string) {
  if (!path || path.includes('\\') || path.includes(':') || path.startsWith('/')) throw new Error('PI_FILE_PATH');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f<>"|?*]/u.test(part) || /[. ]$/.test(part) || reserved.test(part))) throw new Error('PI_FILE_PATH');
  return parts;
}
async function checkedPath(root: string, path: string) {
  const parts = components(path);
  // Reject links in the root ancestry too, not just in the user-provided suffix.
  let ancestor = resolve(root);
  while (true) {
    const info = await lstat(ancestor);
    if (info.isSymbolicLink()) throw new Error('PI_FILE_LINK');
    const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
  }
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const part of parts) {
    current = join(current, part);
    try { const info = await lstat(current); if (info.isSymbolicLink() || info.isFile() && info.nlink !== 1) throw new Error('PI_FILE_LINK'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  if (!inside(canonicalRoot, current)) throw new Error('PI_FILE_PATH');
  return current;
}
async function sourceBytes(root: string, topLevel = true): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('PI_FILE_LINK');
    if (topLevel && (entry.name.toLowerCase() === 'out' || entry.name.toLowerCase() === 'material')) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await sourceBytes(path, false);
    else total += (await lstat(path)).size;
  }
  return total;
}

/** Trusted host only. The worker gets relative paths, never unrestricted SDK file tools. */
export function createPiAgentFiles(options: { projectRoot: string; libraryRoot: string; styleSlug: string }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.styleSlug)) throw new Error('PI_STYLE_SLUG');
  let mutations: Promise<unknown> = Promise.resolve();
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const next = mutations.then(work); mutations = next.catch(() => {}); return next;
  };
  const libraryAllowed = (path: string) => ['AGENTS.md', 'DIRECTOR.md', 'TECHNIQUE.md'].includes(path)
    || path.startsWith('core/') || path.startsWith(`styles/${options.styleSlug}/`);
  return {
    async list(scope: 'project' | 'library', path: string) {
      if (scope !== 'project' && scope !== 'library') throw new Error('PI_FILE_SCOPE');
      if (scope === 'library' && !libraryAllowed(path + '/')) throw new Error('PI_LIBRARY_SCOPE');
      if (scope === 'library' && (path.includes('/demo') || path.endsWith('/DEMO.md'))) throw new Error('PI_LIBRARY_DEMO_LIST_DISABLED');
      const directory = path === '.' && scope === 'project' ? await realpath(options.projectRoot) : await checkedPath(scope === 'project' ? options.projectRoot : options.libraryRoot, path);
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter(entry => !entry.isSymbolicLink()).slice(0, 500).map(entry => ({ name: entry.name, directory: entry.isDirectory() }));
    },
    async read(scope: 'project' | 'library', path: string, offset = 0, limit = 60000) {
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 60000) throw new Error('PI_FILE_READ_RANGE');
      if (scope !== 'project' && scope !== 'library') throw new Error('PI_FILE_SCOPE');
      if (scope === 'library' && !libraryAllowed(path)) throw new Error('PI_LIBRARY_SCOPE');
      if (scope === 'library' && (path.includes('/demo/') || path.endsWith('/DEMO.md'))) {
        const treatment = await checkedPath(options.projectRoot, 'TREATMENT.md');
        let text = '';
        try { const info = await lstat(treatment); if (info.isFile() && info.size <= MAX_FILE_BYTES) text = await readFile(treatment, 'utf8'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (!text.trim()) throw new Error('PI_TREATMENT_REQUIRED');
      }
      const target = await checkedPath(scope === 'project' ? options.projectRoot : options.libraryRoot, path);
      const info = await lstat(target);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error('PI_FILE_READ_SIZE');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(target));
      return { text: text.slice(offset, offset + limit), nextOffset: Math.min(text.length, offset + limit), totalCharacters: text.length };
    },
    write(path: string, text: string) {
      return serialize(async () => {
        const parts = components(path);
        if (['material', 'assets', 'out', '.pi'].includes(parts[0].toLowerCase()) || !sourceExtension.test(path)) throw new Error('PI_FILE_WRITE_SCOPE');
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > MAX_FILE_BYTES) throw new Error('PI_FILE_WRITE_SIZE');
        const target = await checkedPath(options.projectRoot, path);
        let previous = 0;
        try { const info = await lstat(target); if (!info.isFile()) throw new Error('PI_FILE_NOT_REGULAR'); previous = info.size; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        if (await sourceBytes(options.projectRoot) - previous + bytes > MAX_SOURCE_BYTES) throw new Error('PI_PROJECT_SOURCE_LIMIT');
        await mkdir(dirname(target), { recursive: true });
        await checkedPath(options.projectRoot, path);
        await writeFile(target, text, 'utf8');
        return { path, bytes };
      });
    },
  };
}
