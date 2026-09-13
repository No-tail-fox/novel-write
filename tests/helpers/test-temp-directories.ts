import { lstat, mkdtemp, realpath, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

interface OwnedDirectory {
  path: string;
  canonicalPath: string;
  device: bigint;
  inode: bigint;
}

interface OwnedLink {
  path: string;
  target: string;
  owner: OwnedDirectory;
}

const directories = new Map<string, OwnedDirectory>();
const links = new Map<string, OwnedLink>();
let cleanupTail: Promise<void> = Promise.resolve();

/** Register only fresh, direct children of the OS temporary directory for disposal. */
export async function createTestTempDirectory(prefix: string): Promise<string> {
  const temporaryRoot = await realpath(tmpdir());
  if (await realpath(dirname(resolve(prefix))) !== temporaryRoot) {
    throw new Error('Test temporary directories must be created directly in the OS temporary directory.');
  }
  const path = await mkdtemp(prefix);
  const canonicalPath = await realpath(path);
  const value = await lstat(canonicalPath, { bigint: true });
  directories.set(resolve(path), { path, canonicalPath, device: value.dev, inode: value.ino });
  return path;
}

/** Windows may report ENOENT for a dangling junction and then leave it behind during recursive rm. */
export async function createTestDirectoryLink(
  target: string,
  path: string,
  type: 'dir' | 'junction',
): Promise<void> {
  const parent = await realpath(dirname(path));
  const owner = [...directories.values()].find((root) => isWithin(root.canonicalPath, parent));
  const canonicalTarget = await realpath(target);
  if (!owner || ![...directories.values()].some((root) => isWithin(root.canonicalPath, canonicalTarget))) {
    throw new Error('Test directory links and their targets must belong to registered temporary directories.');
  }
  await symlink(canonicalTarget, path, type);
  links.set(resolve(path), { path, target: canonicalTarget, owner });
}

/** Remove links before either endpoint, including calls made from nested finally blocks. */
export function removeTestTempDirectories(...paths: string[]): Promise<void> {
  const owned = paths.map((path) => {
    const directory = directories.get(resolve(path));
    if (!directory) throw new Error(`Refusing to remove an unregistered test directory: ${path}`);
    return directory;
  });
  const cleanup = cleanupTail.then(async () => {
    for (const root of owned) {
      const value = await lstat(root.canonicalPath, { bigint: true });
      if (!value.isDirectory() || value.isSymbolicLink() || value.dev !== root.device || value.ino !== root.inode) {
        throw new Error(`Test temporary directory identity changed before cleanup: ${root.path}`);
      }
      for (const [key, link] of links) {
        if (link.owner !== root && !isWithin(root.canonicalPath, link.target)) continue;
        const parent = await realpath(dirname(link.path)).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (parent && !isWithin(link.owner.canonicalPath, parent)) {
          throw new Error(`Test directory link parent moved outside its owned root: ${link.path}`);
        }
        const linkValue = await lstat(link.path).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return undefined;
          throw error;
        });
        if (linkValue?.isSymbolicLink()) await unlink(link.path);
        links.delete(key);
      }
      // Windows can briefly hold a deleted file open. Retry only disposal, never test operations.
      // Electron/Chromium can keep a staged script handle open briefly after a
      // render promise resolves. Give Windows a wider disposal window so a
      // transient EPERM does not turn an otherwise successful test into a
      // teardown failure.
      await rm(root.canonicalPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      directories.delete(resolve(root.path));
    }
  });
  cleanupTail = cleanup.catch(() => undefined);
  return cleanup;
}

function isWithin(root: string, path: string): boolean {
  const segment = relative(root, path);
  return segment === '' || (!isAbsolute(segment) && segment !== '..' && !segment.startsWith(`..${sep}`));
}
