import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LEMO_AGENT_PLUGIN_NAME, LEMO_AGENT_SKILL_NAME } from '../../src/shared/lemo-agent-sdk';

export const LEMO_SDK_UPSTREAM_REVISION = 'f17136060781a0068a7951245a3aa7835a7230de';
const PINNED_PLUGIN: Record<string, string> = {
  '.claude-plugin/plugin.json': 'bb46d57ec776e383bec7f946a090391460a579e02e393f32539f27882cf6a116',
  'skills/lemo-opuscar/SKILL.md': '9036c5fd58ac3c3acc30b9183ed3a415829755a59d66b259a2b13a9fde5dd7c4',
  'skills/lemo-opuscar/scripts/setup.sh': 'dd42059e5d143bc236ffc2f3a71261dbc8903c4899019a206cc211505634a697',
};
export async function verifyPinnedLemoPlugin(upstreamRoot: string): Promise<string> {
  const root = await realpath(upstreamRoot);
  const manifest = JSON.parse(await readFile(join(root, 'storydream-upstream.json'), 'utf8'));
  if (manifest.revision !== LEMO_SDK_UPSTREAM_REVISION) throw new Error('LEMO_SDK_UPSTREAM_VERSION');
  const plugin = join(root, 'plugin');
  const found = new Set<string>();
  async function walk(dir: string, prefix = ''): Promise<void> {
    if ((await lstat(dir)).isSymbolicLink()) throw new Error('LEMO_SDK_PLUGIN_LINK');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('LEMO_SDK_PLUGIN_LINK');
      if (entry.isDirectory()) { await walk(join(dir, entry.name), name + '/'); continue; }
      if (!entry.isFile() || !Object.hasOwn(PINNED_PLUGIN, name)) throw new Error('LEMO_SDK_PLUGIN_UNEXPECTED_FILE');
      const hash = createHash('sha256').update(await readFile(join(dir, entry.name))).digest('hex');
      if (hash !== PINNED_PLUGIN[name]) throw new Error('LEMO_SDK_PLUGIN_CHANGED: ' + name);
      found.add(name);
    }
  }
  await walk(plugin);
  if (found.size !== Object.keys(PINNED_PLUGIN).length) throw new Error('LEMO_SDK_PLUGIN_INCOMPLETE');
  return plugin;
}
export function verifyLoadedLemoPlugin(snapshot: {
  plugins: Array<{ name: string; path: string }>; commands: Array<{ name: string }>; error_count: number;
}, pluginPath: string) {
  if (snapshot.error_count) throw new Error('LEMO_SDK_PLUGIN_LOAD_ERRORS');
  const plugin = snapshot.plugins.find(p => p.name === LEMO_AGENT_PLUGIN_NAME && resolve(p.path) === resolve(pluginPath));
  if (!plugin || !snapshot.commands.some(c => c.name === LEMO_AGENT_SKILL_NAME)) {
    throw new Error('LEMO_SDK_PLUGIN_NOT_LOADED: 未确认原版插件和命名空间技能，禁止进入生成。');
  }
  return { name: plugin.name, path: plugin.path };
}
