import { mkdtemp, mkdir, readFile, realpath, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ArtifactStorage, ARTIFACT_STORAGE_DIRECTORIES } from '../electron/artifact-storage';
import { rebaseArtifactPathText } from '../src/shared/artifact-paths';
import { FileDatabase } from '../src/shared/storage';
import { ensureHtmlVideoTaskWorkDir, resolveExistingHtmlVideoTaskWorkDir } from '../electron/html-video-runtime';

const roots: string[] = [];
const links: string[] = [];
afterEach(async () => {
  for (const link of links.splice(0)) await unlink(link);
  for (const directory of roots.splice(0)) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'storydream-artifact-storage-')));
  roots.push(root);
  const userData = join(root, 'app');
  const original = join(userData, 'storydream');
  const target = join(root, '创作产物');
  const storage = new ArtifactStorage(userData, original);
  await storage.initialize();
  return { root, userData, original, target, storage };
}
async function put(file: string, content: string) {
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, content, 'utf8');
}

describe('artifact storage switching', () => {
  it('keeps the existing default and journals a choice until the next startup', async () => {
    const { userData, original, target, storage } = await fixture();
    expect(storage.location()).toEqual({ directory: original, defaultDirectory: original, pendingDirectory: null, migrationError: null });
    await storage.requestDirectory(target);
    expect(storage.directory).toBe(original);
    expect(storage.location().pendingDirectory).toBe(target);
    expect(JSON.parse(await readFile(join(userData, 'artifact-storage.v1.json'), 'utf8')).directory).toBe(original);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    expect(restarted.directory).toBe(target);
    expect(restarted.location().pendingDirectory).toBeNull();
  });

  it('compares physical roots while migrating references saved through path aliases', async () => {
    const aliasRoot = await mkdtemp(join(tmpdir(), 'storydream-artifact-storage-'));
    const physicalRoot = await realpath(aliasRoot);
    roots.push(physicalRoot);
    const userData = join(aliasRoot, 'app');
    const original = join(userData, 'storydream');
    const target = join(physicalRoot, 'products');
    const storage = new ArtifactStorage(userData, original);
    await storage.initialize();
    await expect(storage.requestDirectory(physicalRoot)).rejects.toThrow('应用配置目录');
    expect((await storage.requestDirectory(original)).pendingDirectory).toBeNull();
    await put(join(original, 'tasks', 'state.json'), JSON.stringify({ image: join(original, 'tasks', 'image.png') }));
    await storage.requestDirectory(target);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    expect(JSON.parse(await readFile(join(target, 'tasks', 'state.json'), 'utf8')).image).toBe(join(target, 'tasks', 'image.png'));
    expect(restarted.databaseSources).toContain(original);
    expect((await restarted.requestDirectory(target)).pendingDirectory).toBeNull();
  });

  it('copies every managed product family while leaving database, keys and runtime state in place', async () => {
    const { userData, original, target, storage } = await fixture();
    for (const name of ARTIFACT_STORAGE_DIRECTORIES) await put(join(original, name, '样例.txt'), name);
    for (const name of ['data.db', 'secrets.v1.json', 'machine-license.v1.bin', 'models/model.onnx', 'agent-search/state.json', 'benchmark-cookies/session.txt']) await put(join(original, name), 'private');
    await storage.requestDirectory(target);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    for (const name of ARTIFACT_STORAGE_DIRECTORIES) {
      expect(await readFile(join(target, name, '样例.txt'), 'utf8')).toBe(name);
      expect(await readFile(join(original, name, '样例.txt'), 'utf8')).toBe(name);
    }
    for (const name of ['data.db', 'secrets.v1.json', 'machine-license.v1.bin', 'models/model.onnx', 'agent-search/state.json', 'benchmark-cookies/session.txt']) {
      await expect(readFile(join(target, name))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(join(original, name), 'utf8')).toBe('private');
    }
  });

  it('cancels a pending change and permits choosing the current custom location', async () => {
    const { root, userData, original, target, storage } = await fixture();
    await storage.requestDirectory(target);
    expect((await storage.cancelPendingDirectory()).pendingDirectory).toBeNull();
    await storage.requestDirectory(target);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    await restarted.requestDirectory(join(root, 'another'));
    expect((await restarted.requestDirectory(target)).pendingDirectory).toBeNull();
    expect(restarted.directory).toBe(target);
    expect((await restarted.requestDirectory(original)).pendingDirectory).toBe(original);
  });

  it('rejects relative, nested, ancestor, config and linked destinations', async () => {
    const { root, userData, original, target, storage } = await fixture();
    for (const bad of ['relative-folder', '', root, userData, join(userData, 'other'), join(original, 'nested')]) {
      await expect(storage.requestDirectory(bad)).rejects.toThrow();
    }
    await storage.requestDirectory(target);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    await expect(restarted.requestDirectory(join(target, 'nested'))).rejects.toThrow('父目录或子目录');
    const linked = join(root, 'linked');
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
    links.push(linked);
    await expect(restarted.requestDirectory(linked)).rejects.toThrow('符号链接');
  });

  it('preserves a conflicting target and retries an interrupted copy after the conflict is resolved', async () => {
    const { userData, original, target, storage } = await fixture();
    await put(join(original, 'tasks', 'a.txt'), 'first');
    await put(join(original, 'tasks', 'b.txt'), 'source');
    await put(join(target, 'tasks', 'b.txt'), 'target');
    await storage.requestDirectory(target);
    const failed = new ArtifactStorage(userData, original);
    await failed.initialize();
    expect(failed.directory).toBe(original);
    expect(failed.location().migrationError).toContain('未覆盖文件');
    expect(await readFile(join(target, 'tasks', 'b.txt'), 'utf8')).toBe('target');
    expect(await readFile(join(target, 'tasks', 'a.txt'), 'utf8')).toBe('first');
    await rename(join(target, 'tasks', 'b.txt'), join(target, 'tasks', 'b-backup.txt'));
    const retry = new ArtifactStorage(userData, original);
    await retry.initialize();
    expect(retry.directory).toBe(target);
    expect(await readFile(join(target, 'tasks', 'b.txt'), 'utf8')).toBe('source');
    expect(await readFile(join(target, 'tasks', 'b-backup.txt'), 'utf8')).toBe('target');
  });

  it('does not follow links inside a source artifact directory', async () => {
    const { root, userData, original, target, storage } = await fixture();
    const outside = join(root, 'outside');
    await mkdir(outside);
    await put(join(outside, 'secret.txt'), 'keep');
    await mkdir(join(original, 'tasks'));
    await symlink(outside, join(original, 'tasks', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    links.push(join(original, 'tasks', 'linked'));
    await storage.requestDirectory(target);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    expect(restarted.location().migrationError).toContain('目录链接');
    expect(restarted.directory).toBe(original);
    await expect(readFile(join(target, 'tasks', 'linked', 'secret.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('updates copied JSON references and keeps a durable database migration journal', async () => {
    const { userData, original, target, storage } = await fixture();
    const sourceImage = join(original, 'image-lab', 'one.png');
    await put(sourceImage, 'image');
    await put(join(original, 'tasks', 'state.json'), JSON.stringify({ image: sourceImage, nested: JSON.stringify({ video: join(original, 'tasks', 'one.mp4') }), external: join(userData, 'external.png') }));
    await storage.requestDirectory(target);
    const restarted = new ArtifactStorage(userData, original);
    await restarted.initialize();
    const state = JSON.parse(await readFile(join(target, 'tasks', 'state.json'), 'utf8'));
    expect(state.image).toBe(join(target, 'image-lab', 'one.png'));
    expect(JSON.parse(state.nested).video).toBe(join(target, 'tasks', 'one.mp4'));
    expect(state.external).toBe(join(userData, 'external.png'));
    expect(restarted.databaseSources).toEqual([original]);
    const interrupted = new ArtifactStorage(userData, original);
    await interrupted.initialize();
    expect(interrupted.databaseSources).toEqual([original]);
    await interrupted.completeDatabaseMigration();
    const completed = new ArtifactStorage(userData, original);
    await completed.initialize();
    expect(completed.databaseSources).toEqual([]);
  });

  it('supports a second switch without depending on the original media folder', async () => {
    const { root, userData, original, target, storage } = await fixture();
    await put(join(original, 'tasks', 'state.json'), JSON.stringify({ path: join(original, 'tasks', 'image.png') }));
    await storage.requestDirectory(target);
    const second = new ArtifactStorage(userData, original);
    await second.initialize();
    const final = join(root, 'final');
    await second.requestDirectory(final);
    const third = new ArtifactStorage(userData, original);
    await third.initialize();
    expect(JSON.parse(await readFile(join(final, 'tasks', 'state.json'), 'utf8')).path).toBe(join(final, 'tasks', 'image.png'));
    expect(third.databaseSources).toEqual([original, target]);
  });

  it('loads the original manifest format and reports malformed storage configuration', async () => {
    const { userData, original } = await fixture();
    const manifest = join(userData, 'artifact-storage.v1.json');
    await writeFile(manifest, JSON.stringify({ version: 1, directory: original, pendingDirectory: null }), 'utf8');
    await expect(new ArtifactStorage(userData, original).initialize()).resolves.toBeUndefined();
    await writeFile(manifest, JSON.stringify({ version: 1, directory: '../escape', pendingDirectory: null }), 'utf8');
    await expect(new ArtifactStorage(userData, original).initialize()).rejects.toThrow('绝对');
  });
});

describe('managed media path migration', () => {
  it('changes only whole managed path prefixes, including nested serialized documents', () => {
    const source = resolve('old');
    const target = resolve('new');
    const text = JSON.stringify({ media: join(source, 'tasks', 'image.png'), similar: join(source + '-other', 'tasks', 'image.png'), config: join(source, 'secrets.v1.json'), relative: 'tasks/image.png', url: 'https://example.com/tasks/image.png' });
    const next = JSON.parse(rebaseArtifactPathText(text, [source], target));
    expect(next.media).toBe(join(target, 'tasks', 'image.png'));
    expect(next.similar).toBe(join(source + '-other', 'tasks', 'image.png'));
    expect(next.config).toBe(join(source, 'secrets.v1.json'));
    expect(next.relative).toBe('tasks/image.png');
    expect(next.url).toBe('https://example.com/tasks/image.png');
    expect(rebaseArtifactPathText('not json', [source], target)).toBe('not json');
  });

  it('keeps SQLite in the app directory while task documents and covers resolve from the new root', async () => {
    const { userData, original, target, storage } = await fixture();
    const databaseFile = join(original, 'data.db');
    let db = await FileDatabase.open(databaseFile);
    try {
      const task = await db.createTask({ title: '迁移测试', inputText: 'test', taskType: 'editorial-collage' });
      const key = task.managedStorageKey!;
      const oldImage = join(original, 'tasks', key, 'image.png');
      await put(oldImage, 'image');
      await db.updateTask(task.id, { artifactStatePath: join(original, 'tasks', key, 'state.json'), pipelineData: JSON.stringify({ assets: [{ id: 'one', kind: 'image', localPath: oldImage }] }) });
      await put(join(original, 'tasks', key, 'state.json'), JSON.stringify({ image: oldImage }));
      await db.close();
      await storage.requestDirectory(target);
      const restarted = new ArtifactStorage(userData, original);
      await restarted.initialize();
      db = await FileDatabase.open(databaseFile, undefined, restarted.directory);
      await db.rebaseArtifactPaths(restarted.databaseSources);
      await restarted.completeDatabaseMigration();
      const migrated = await db.getTaskDetail(task.id);
      expect(migrated?.artifactStatePath).toBe(join(target, 'tasks', key, 'state.json'));
      expect(JSON.parse(migrated!.pipelineData!).assets[0].localPath).toBe(join(target, 'tasks', key, 'image.png'));
      await db.setProjectCover(task.id, join(target, 'tasks', key, 'image.png'));
      expect((await db.getTaskSummary(task.id))?.projectCover?.path).toBe(join(target, 'tasks', key, 'image.png'));
      const identity = await resolveExistingHtmlVideoTaskWorkDir(target, key);
      expect(identity.workDir.canonicalPath).toBe(join(target, 'tasks', key));
      const created = await ensureHtmlVideoTaskWorkDir(target, 'a'.repeat(64));
      expect(created.workDir.canonicalPath).toBe(join(target, 'tasks', 'a'.repeat(64)));
      await expect(readFile(join(target, 'data.db'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally { await db.close(); }
  });
});
