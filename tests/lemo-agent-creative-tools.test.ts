import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, link, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLemoCreativeTools, type LemoCreativeToolEvent } from '../services/lemo-agent-worker/creative-tools';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(extra: Partial<Parameters<typeof createLemoCreativeTools>[0]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lemo-tools-')); cleanup.push(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'project'); await mkdir(workspace);
  const events: LemoCreativeToolEvent[] = [];
  const tools = await createLemoCreativeTools({ workspaceRoot: workspace, onToolEvent: async event => { events.push(event); }, ...extra });
  const client = new Client({ name: 'lemo-tool-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await tools.server.instance.connect(serverTransport); await client.connect(clientTransport);
  cleanup.push(async () => { await client.close(); await tools.server.instance.close(); });
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  return { root, workspace, events, client, call };
}
describe('audited official SDK creative tools', () => {
  it('exposes only the four host file capabilities', async () => {
    const f = await fixture(); expect((await f.client.listTools()).tools.map(t => t.name)).toEqual(['list_directory','read_text','write_text','read_image']);
  });
  it('writes and reads Chinese content and durably orders operation receipts', async () => {
    const f = await fixture(); const content = '# 原创动画\n图文生成与故事镜头。';
    expect((await f.call('write_text', { path: 'scenes/TREATMENT.md', content })).isError).not.toBe(true);
    expect(await readFile(join(f.workspace, 'scenes/TREATMENT.md'), 'utf8')).toBe(content);
    const result = await f.call('read_text', { path: 'scenes/TREATMENT.md' });
    expect(result.content).toEqual([{ type: 'text', text: content }]);
    expect(f.events.map(e => e.phase)).toEqual(['started','completed','started','completed']);
    expect(f.events[1]).toMatchObject({ operationId: f.events[0].operationId, sideEffectApplied: true, resultBytes: Buffer.byteLength(content) });
  });
  it.each(['../outside.md','/outside.md','C:\\outside.md','.env','credentials.json','vendor/a.md','node_modules/a.js','config.toml','secret.key'])('rejects unsafe write %s without a file side effect', async path => {
    const f = await fixture(); expect((await f.call('write_text', { path, content: 'bad' })).isError).toBe(true);
    expect(f.events.at(-1)).toMatchObject({ phase: 'failed', sideEffectApplied: false });
  });
  it('refuses mutation when the started audit cannot persist', async () => {
    const f = await fixture({ onToolEvent: async () => { throw new Error('disk full'); } });
    expect((await f.call('write_text', { path: 'TREATMENT.md', content: 'blocked' })).isError).toBe(true);
    await expect(readFile(join(f.workspace, 'TREATMENT.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('reports an applied write when the completion audit fails and never rolls it back silently', async () => {
    const events: LemoCreativeToolEvent[] = [];
    const f = await fixture({ onToolEvent: async event => { if (event.phase === 'completed') throw new Error('disk full'); events.push(event); } });
    expect((await f.call('write_text', { path: 'TREATMENT.md', content: 'saved once' })).isError).toBe(true);
    expect(await readFile(join(f.workspace, 'TREATMENT.md'), 'utf8')).toBe('saved once');
    expect(events.at(-1)).toMatchObject({ phase: 'failed', sideEffectApplied: true, resultBytes: 10 });
  });
  it('blocks links and hardlinks to files outside the project', async () => {
    const f = await fixture(); const outside = join(f.root, 'outside.md'); await writeFile(outside, 'private');
    await link(outside, join(f.workspace, 'hard.md'));
    expect((await f.call('read_text', { path: 'hard.md' })).isError).toBe(true);
    const other = join(f.root, 'other'); await mkdir(other); await writeFile(join(other,'a.md'),'private');
    await symlink(other,join(f.workspace,'linked'),process.platform === 'win32' ? 'junction' : 'dir');
    expect((await f.call('read_text', { path: 'linked/a.md' })).isError).toBe(true);
  });
  it('keeps existing bytes when content exceeds the configured limit', async () => {
    const f = await fixture({ maxTextBytes: 8 }); await writeFile(join(f.workspace,'a.md'),'old');
    expect((await f.call('write_text', { path: 'a.md', content: '中文中文' })).isError).toBe(true);
    expect(await readFile(join(f.workspace,'a.md'),'utf8')).toBe('old');
  });
  it('reads a real PNG as an image and rejects a text file with a PNG extension', async () => {
    const f = await fixture(); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP8zwACTGCSAQANHQEDgslx/wAAAABJRU5ErkJggg==','base64');
    await writeFile(join(f.workspace,'frame.png'),png);
    const result = await f.call('read_image', { path: 'frame.png' }); expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type:'image', mimeType:'image/png', data:png.toString('base64') }]);
    await writeFile(join(f.workspace,'fake.png'),'not an image'); expect((await f.call('read_image',{path:'fake.png'})).isError).toBe(true);
  });
  it('does not start a write after cancellation', async () => {
    const controller = new AbortController(); const f = await fixture({ signal: controller.signal }); controller.abort();
    expect((await f.call('write_text',{path:'a.md',content:'new'})).isError).toBe(true);
    expect(f.events.some(e=>e.phase==='started')).toBe(false);
    await expect(readFile(join(f.workspace,'a.md'))).rejects.toMatchObject({code:'ENOENT'});
  });
});
