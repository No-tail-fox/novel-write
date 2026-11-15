import { mkdtemp, mkdir, readFile, rm, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPiAgentFiles } from '../electron/pi-agent-files';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'pi-files-')); roots.push(root);
  const projectRoot = join(root, 'project'), libraryRoot = join(root, 'library');
  await mkdir(projectRoot); await mkdir(join(libraryRoot, 'styles', 'impasto', 'demo'), { recursive: true });
  await writeFile(join(libraryRoot, 'styles', 'impasto', 'demo', 'index.html'), 'demo');
  await writeFile(join(libraryRoot, 'AGENTS.md'), 'guide');
  return { projectRoot, files: createPiAgentFiles({ projectRoot, libraryRoot, styleSlug: 'impasto' }) };
}
describe('Pi host file bridge', () => {
  it('writes UTF-8 source and reads bounded text', async () => {
    const { files, projectRoot } = await setup();
    await files.write('audio/score.py', '# 音乐\n');
    expect(await readFile(join(projectRoot, 'audio', 'score.py'), 'utf8')).toBe('# 音乐\n');
    expect(await files.read('project', 'audio/score.py', 2, 2)).toMatchObject({ text: '音乐', nextOffset: 4 });
    expect(await files.read('library', 'AGENTS.md')).toMatchObject({ text: 'guide' });
  });
  it('rejects path escapes, device names, streams and host-owned directories', async () => {
    const { files } = await setup();
    for (const path of ['../bad.py', 'C:/bad.py', '/bad.py', 'a\\bad.py', 'nul.txt', 'audio/COM1.py', 'a.py:secret', 'material/cues.json', 'out/claims.json', '.pi/settings.json']) {
      await expect(Promise.resolve().then(() => files.write(path, 'bad'))).rejects.toThrow();
    }
    await expect(files.read('library', 'styles/other/STYLE.md')).rejects.toThrow('SCOPE');
    await expect(files.write('huge.py', 'x'.repeat(2 * 1024 * 1024 + 1))).rejects.toThrow('SIZE');
  });
  it('rejects hard-linked source files instead of overwriting their other targets', async () => {
    const { files, projectRoot } = await setup();
    const original = join(projectRoot, '..', 'original.py');
    await writeFile(original, 'keep');
    await link(original, join(projectRoot, 'linked.py'));
    await expect(files.write('linked.py', 'changed')).rejects.toThrow('LINK');
    await expect(files.read('project', 'linked.py')).rejects.toThrow('LINK');
    expect(await readFile(original, 'utf8')).toBe('keep');
  });
  it('keeps library reads inside the active style and host-only references', async () => {
    const { files } = await setup();
    for (const path of ['styles/impasto-x/STYLE.md', 'styleboard/opuscar98_styles.json', 'styles/other/STYLE.md']) {
      await expect(files.read('library', path)).rejects.toThrow('PI_LIBRARY_SCOPE');
    }
    for (const path of ['core/../AGENTS.md', 'styles/impasto/../other/STYLE.md', 'core/..\\AGENTS.md']) {
      await expect(files.read('library', path)).rejects.toThrow('PI_FILE_PATH');
    }
    for (const path of ['styleboard', 'styles/impasto-x', 'styles']) {
      await expect(files.list('library', path)).rejects.toThrow('PI_LIBRARY_SCOPE');
    }
  });
  it('requires treatment before demo access', async () => {
    const { files } = await setup();
    await expect(files.read('library', 'styles/impasto/demo/index.html')).rejects.toThrow('TREATMENT');
    await files.write('TREATMENT.md', '# Treatment\nOriginal story');
    expect(await files.read('library', 'styles/impasto/demo/index.html')).toMatchObject({ text: 'demo' });
  });
});
