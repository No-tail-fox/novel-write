import { afterEach, describe, expect, it } from 'vitest';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertLemoSdkProviderProtocol, LEMO_AGENT_PLUGIN_NAME, LEMO_AGENT_SKILL_NAME, LEMO_AGENT_SDK_VERSION } from '../src/shared/lemo-agent-sdk';
import { lemoWorkerEnvironment } from '../services/lemo-agent-worker/environment';
import { verifyLoadedLemoPlugin, verifyPinnedLemoPlugin } from '../services/lemo-agent-worker/policy';
import { prepareLemoStateDirectory, validateProbeRequest } from '../services/lemo-agent-worker/paths';
import { probeOfficialLemoAgentRuntime } from '../electron/lemo-agent-runtime';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lemo-sdk-')); roots.push(root); return root;
}
describe('official Lemo SDK boundary', () => {
  it.each(['openai', 'responses', undefined, 'anthropic-maybe'])('rejects unsupported or inferred provider protocol %s', protocol => {
    expect(() => assertLemoSdkProviderProtocol(protocol)).toThrow('LEMO_SDK_PROTOCOL');
  });
  it('accepts explicit Anthropic without claiming provider compatibility', () => expect(() => assertLemoSdkProviderProtocol('anthropic')).not.toThrow());
  it('strips API keys, OAuth, proxy, plugin and shell overrides from the worker environment', () => {
    const env = lemoWorkerEnvironment({ SystemRoot: 'C:\\Windows', Path: 'trusted-path', GEEKAI_API_KEY: 'secret',
      ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'secret', NODE_OPTIONS: 'unsafe',
      ANTHROPIC_BASE_URL: 'https://wrong.example', HTTP_PROXY: 'bad', HTTPS_PROXY: 'bad',
      CLAUDE_CODE_GIT_BASH_PATH: 'unsafe', CLAUDE_CONFIG_DIR: 'outside', USERPROFILE: 'outside',
    }, resolve('isolated'));
    expect(env.SystemRoot).toBe('C:\\Windows'); expect(env.Path).toBe('trusted-path');
    for (const key of ['GEEKAI_API_KEY','ANTHROPIC_API_KEY','CLAUDE_CODE_OAUTH_TOKEN','NODE_OPTIONS','ANTHROPIC_BASE_URL','HTTP_PROXY','HTTPS_PROXY','CLAUDE_CODE_GIT_BASH_PATH']) expect(env[key]).toBeUndefined();
    expect(env.CLAUDE_CONFIG_DIR).toBe(join(resolve('isolated'), 'claude'));
    expect(env.USERPROFILE).toBe(join(resolve('isolated'), 'home'));
  });
  const valid = () => ({ version: 1, action: 'probe', runRoot: resolve('.artifacts/agent-test'), upstreamRoot: resolve('vendor/lemo-upstream') });
  it('accepts only a bounded readiness request, not generation credentials', () => {
    expect(validateProbeRequest(valid())).toEqual(valid());
    expect(() => validateProbeRequest({ ...valid(), apiKey: 'secret' })).toThrow('LEMO_SDK_REQUEST');
    expect(() => validateProbeRequest({ ...valid(), action: 'generate' })).toThrow('LEMO_SDK_REQUEST');
  });
  it.each(['relative', '', 'bad\u0000path'])('rejects unsafe state path %s', runRoot => expect(() => validateProbeRequest({ ...valid(), runRoot })).toThrow('LEMO_SDK_REQUEST'));
  it('cannot write worker state inside the pinned library', () => expect(() => validateProbeRequest({ ...valid(), runRoot: resolve('vendor/lemo-upstream/state') })).toThrow('LEMO_SDK_REQUEST'));
  it('does not create state in the upstream checkout before request rejection', async () => {
    const root = await fixture(); const target = join(root, 'uncreated');
    await expect(prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: target, upstreamRoot: root }, 'worker-state')).rejects.toThrow('LEMO_SDK_REQUEST');
    await expect(readFile(join(target, 'worker-state'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a junction redirecting state outside the request directory', async () => {
    const root = await fixture(); const target = join(root, 'outside'); await mkdir(target);
    const run = join(root, 'run'); await mkdir(run);
    await symlink(target, join(run, 'worker-state'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(prepareLemoStateDirectory({ version: 1, action: 'probe', runRoot: run, upstreamRoot: resolve('vendor/lemo-upstream') }, 'worker-state')).rejects.toThrow('LEMO_SDK_STATE_LINK');
    await expect(readFile(join(target, 'home'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('verifies all three actual upstream plugin hashes', async () => expect(await verifyPinnedLemoPlugin(resolve('vendor/lemo-upstream'))).toBe(resolve('vendor/lemo-upstream/plugin')));
  it('rejects additional plugin hooks rather than executing them', async () => {
    const root = await fixture();
    await cp(resolve('vendor/lemo-upstream/plugin'), join(root, 'plugin'), { recursive: true });
    await cp(resolve('vendor/lemo-upstream/storydream-upstream.json'), join(root, 'storydream-upstream.json'));
    await writeFile(join(root, 'plugin/hooks.json'), '{"hooks":{}}', 'utf8');
    await expect(verifyPinnedLemoPlugin(root)).rejects.toThrow('LEMO_SDK_PLUGIN_UNEXPECTED_FILE');
  });
  it('rejects mutated plugin content even if a copied manifest is edited', async () => {
    const root = await fixture();
    await cp(resolve('vendor/lemo-upstream/plugin'), join(root, 'plugin'), { recursive: true });
    await cp(resolve('vendor/lemo-upstream/storydream-upstream.json'), join(root, 'storydream-upstream.json'));
    await writeFile(join(root, 'plugin/skills/lemo-opuscar/SKILL.md'), 'altered', 'utf8');
    await expect(verifyPinnedLemoPlugin(root)).rejects.toThrow('LEMO_SDK_PLUGIN_CHANGED');
  });
  const snapshot = () => ({ plugins: [{ name: LEMO_AGENT_PLUGIN_NAME, path: resolve('plugin') }], commands: [{ name: LEMO_AGENT_SKILL_NAME }], error_count: 0 });
  it('requires both loaded plugin path and namespaced skill', () => {
    expect(verifyLoadedLemoPlugin(snapshot(), resolve('plugin')).name).toBe(LEMO_AGENT_PLUGIN_NAME);
    expect(() => verifyLoadedLemoPlugin({ ...snapshot(), commands: [] }, resolve('plugin'))).toThrow('NOT_LOADED');
    expect(() => verifyLoadedLemoPlugin({ ...snapshot(), plugins: [] }, resolve('plugin'))).toThrow('NOT_LOADED');
    expect(() => verifyLoadedLemoPlugin(snapshot(), resolve('other-plugin'))).toThrow('NOT_LOADED');
    expect(() => verifyLoadedLemoPlugin({ ...snapshot(), error_count: 1 }, resolve('plugin'))).toThrow('LOAD_ERRORS');
  });
  it('does not treat unqualified skill metadata as plugin activation', () => expect(() => verifyLoadedLemoPlugin({ ...snapshot(), commands: [{ name: 'lemo-opuscar' }] }, resolve('plugin'))).toThrow('NOT_LOADED'));
});

describe('isolated SDK worker transport', () => {
  async function fakeWorker(source: string) {
    const root = await fixture(); const path = join(root, 'worker.mjs');
    await writeFile(path, source, 'utf8');
    return { root, options: { nodeExecutable: process.execPath, workerPath: path, runRoot: join(root, 'run'), upstreamRoot: resolve('vendor/lemo-upstream') } };
  }
  it('does not start a cancelled request', async () => {
    const { options } = await fakeWorker('process.exit(9)'); const c = new AbortController(); c.abort();
    await expect(probeOfficialLemoAgentRuntime({ ...options, signal: c.signal })).rejects.toThrow('CANCELLED');
  });
  it('transports no inherited credentials to the worker', async () => {
    const { root, options } = await fakeWorker("import fs from 'node:fs'; process.stdin.resume(); process.stdin.on('end',()=>{ fs.writeFileSync('../environment.json',JSON.stringify(process.env)); console.log(JSON.stringify({ok:false,code:'LEMO_SDK_TEST_STOP'})) })");
    const before = process.env.STORYDREAM_TEST_SECRET; process.env.STORYDREAM_TEST_SECRET = 'not-for-child';
    try { await expect(probeOfficialLemoAgentRuntime(options)).rejects.toThrow('TEST_STOP'); }
    finally { if (before === undefined) delete process.env.STORYDREAM_TEST_SECRET; else process.env.STORYDREAM_TEST_SECRET = before; }
    const env = JSON.parse(await readFile(join(root, 'environment.json'), 'utf8'));
    expect(env.STORYDREAM_TEST_SECRET).toBeUndefined();
    expect(env.USERPROFILE).toContain(join('run','worker-state','home'));
  });
  it('rejects non-JSON or injected successful output', async () => {
    const { options } = await fakeWorker("process.stdin.resume(); process.stdin.on('end',()=>console.log('secret raw stderr must not leak'))");
    await expect(probeOfficialLemoAgentRuntime(options)).rejects.toThrow('INVALID_RECEIPT');
  });
  it('rejects a claim that initialization proves production readiness', async () => {
    const { options } = await fakeWorker("process.stdin.resume(); process.stdin.on('end',()=>console.log(JSON.stringify({ok:true,result:{version:1,status:'runtime-ready',productionReady:true,paidRequests:0}})))");
    await expect(probeOfficialLemoAgentRuntime(options)).rejects.toThrow('INVALID_RECEIPT');
  });
  it('limits worker stdout and does not return raw content', async () => {
    const { options } = await fakeWorker("process.stdin.resume(); process.stdin.on('end',()=>{process.stdout.write('a'.repeat(70000));setInterval(()=>{},1000)})");
    await expect(probeOfficialLemoAgentRuntime(options)).rejects.toThrow('OUTPUT_LIMIT');
  });
  it('terminates a hanging worker at its deadline', async () => {
    const { options } = await fakeWorker('setInterval(()=>{},1000)');
    await expect(probeOfficialLemoAgentRuntime({ ...options, timeoutMs: 500 })).rejects.toThrow('WORKER_TIMEOUT');
  });
  it('cancels only its own worker tree, including a running descendant', async () => {
    const { root, options } = await fakeWorker("import {spawn} from 'node:child_process'; import fs from 'node:fs'; const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'}); fs.writeFileSync('../child-pid.txt',String(c.pid)); setInterval(()=>{},1000);");
    const c = new AbortController(); const pending = probeOfficialLemoAgentRuntime({ ...options, signal: c.signal });
    const assertion = expect(pending).rejects.toThrow('CANCELLED');
    let pid = 0;
    try {
      for (let i = 0; i < 80 && !pid; i++) {
        try { pid = Number(await readFile(join(root, 'child-pid.txt'), 'utf8')); } catch { await new Promise(r => setTimeout(r, 50)); }
      }
      expect(pid).toBeGreaterThan(0);
    } finally { c.abort(); await assertion; }
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('supports cancellation after worker launch', async () => {
    const { options } = await fakeWorker('setInterval(()=>{},1000)'); const c = new AbortController();
    const pending = probeOfficialLemoAgentRuntime({ ...options, signal: c.signal });
    setTimeout(() => c.abort(), 200);
    await expect(pending).rejects.toThrow('CANCELLED');
  });
  it('accepts only a versioned readiness receipt from the expected plugin', async () => {
    const result = { version: 1, status: 'runtime-ready', sdkVersion: LEMO_AGENT_SDK_VERSION, cliVersion: '2.1.314',
      plugin: { name: LEMO_AGENT_PLUGIN_NAME, path: resolve('vendor/lemo-upstream/plugin') },
      skills: [LEMO_AGENT_SKILL_NAME], productionReady: false, paidRequests: 0, outboundRequestsBlocked: 0, limitations: ['not generation'] };
    const { options } = await fakeWorker(`process.stdin.resume(); process.stdin.on('end',()=>console.log(${JSON.stringify(JSON.stringify({ok:true,result}))}))`);
    expect(await probeOfficialLemoAgentRuntime(options)).toMatchObject(result);
  });
});
