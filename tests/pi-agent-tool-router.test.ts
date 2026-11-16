import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createPiToolRouter } from '../electron/pi-agent-tool-router';
const roots: string[] = [];
it('freezes queued source writes after finish in the same tool batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-router-finish-')); roots.push(root);
  const projectRoot = join(root, 'project'), libraryRoot = join(root, 'library');
  await mkdir(projectRoot); await mkdir(libraryRoot);
  let accepted = false;
  const router = createPiToolRouter({ projectRoot, libraryRoot, styleSlug: 'impasto', receiptDirectory: join(root, 'receipts'),
    beforeTool: () => { if (accepted) throw new Error('PI_FINISH_ACCEPTED'); },
    operations: { finish: { description: 'finish', parameters: {}, mutates: true, execute: async () => { accepted = true; return { accepted }; } } } });
  const outcomes = await Promise.allSettled([router.execute('finish', {}, 'finish'), router.execute('write_file', { path: 'index.html', text: 'late edit' }, 'late')]);
  expect(outcomes[0].status).toBe('fulfilled');
  expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { message: 'PI_FINISH_ACCEPTED' } });
  await expect(readFile(join(projectRoot, 'index.html'))).rejects.toMatchObject({ code: 'ENOENT' });
});
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('executes only registered host operations and journals source mutations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-router-')); roots.push(root);
  const projectRoot = join(root, 'project'), libraryRoot = join(root, 'library');
  await mkdir(projectRoot); await mkdir(libraryRoot);
  const options = { projectRoot, libraryRoot, styleSlug: 'impasto', receiptDirectory: join(root, 'receipts'), operations: {} };
  const router = createPiToolRouter(options);
  await expect(router.execute('bash', { command: 'whoami' }, 'x')).rejects.toThrow('NOT_AVAILABLE');
  await router.execute('write_file', { path: 'index.html', text: 'original' }, 'write1');
  await router.execute('write_file', { path: 'index.html', text: 'new' }, 'write2');
  await createPiToolRouter(options).execute('write_file', { path: 'index.html', text: 'original' }, 'write1');
  expect(await readFile(join(projectRoot, 'index.html'), 'utf8')).toBe('new');
  await expect(router.execute('read_file', { scope: 'project', path: 'index.html', unexpected: true }, 'read1')).rejects.toThrow();
  expect(router.tools.map(tool => tool.name)).toEqual(['list_files', 'read_file', 'write_file']);
  expect(router.tools.find(tool => tool.name === 'read_file')!.description).toContain('styles/impasto/STYLE.md');
  expect(router.tools.find(tool => tool.name === 'read_file')!.description).toContain('core/README.md');
  expect(router.tools.find(tool => tool.name === 'read_file')!.description).toContain('styles/impasto/demo/');
  expect(router.tools.find(tool => tool.name === 'read_file')!.description).toContain('Read STYLE.md before treatment');
  expect(router.tools.find(tool => tool.name === 'list_files')!.description).toContain('styles/impasto');
  expect(await router.execute('list_files', { scope: 'project', path: '.' }, 'list')).toEqual([{ name: 'index.html', directory: false }]);
});
