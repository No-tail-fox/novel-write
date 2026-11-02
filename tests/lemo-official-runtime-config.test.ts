import { describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { lemoOfficialSessionLimits, resolveLemoOfficialRuntimeConfig, type LemoOfficialRuntimeDependencies, type LemoOfficialRuntimeLocation } from '../electron/lemo-official-runtime-config';
import type { VerifiedLemoRelease } from '../electron/lemo-official-release';

const root = resolve('.artifacts/official-runtime-fixture');
function fixture(patch: Partial<LemoOfficialRuntimeLocation> = {}) {
  const input: LemoOfficialRuntimeLocation = { isPackaged: false, appPath: join(root, 'app'), resourcesPath: join(root, 'resources'),
    electronExecutable: join(root, 'electron.exe'), environment: {}, platform: process.platform, ...patch };
  const nodeName = input.platform === 'win32' ? 'node.exe' : 'node';
  const worker = input.isPackaged ? join(input.resourcesPath, 'lemo-agent-worker', 'dist', 'worker.mjs') : join(input.appPath, 'services', 'lemo-agent-worker', 'dist', 'worker.mjs');
  const node = join(root, 'external', nodeName);
  input.environment = { STORYDREAM_NODE_EXECUTABLE: node, ...input.environment };
  const files = new Set([worker, node]);
  const execute = vi.fn<LemoOfficialRuntimeDependencies['execute']>(async (_path, args) => args[0] === '--version' ? 'v22.14.0\n' : JSON.stringify({ name: 'node', node: '22.14.0', electron: null }));
  const realpath = vi.fn(async (path: string) => path);
  const isFile = vi.fn(async (path: string) => files.has(path));
  const packagedRoot = join(input.resourcesPath, 'lemo-official', 'releases', 'a'.repeat(64));
  const packaged = { nodeExecutable: join(packagedRoot, 'node/node.exe'), workerPath: join(packagedRoot, 'lemo-agent-worker/dist/worker.mjs'), nodeVersion: 'v22.20.0' } as VerifiedLemoRelease;
  const resolvePackagedRelease = vi.fn(async () => packaged), probePackagedRelease = vi.fn(async () => {});
  return { input, node, nodeName, worker, files, execute, realpath, isFile, packaged, resolvePackagedRelease, probePackagedRelease,
    run: () => resolveLemoOfficialRuntimeConfig(input, { isFile, realpath, execute, resolvePackagedRelease, probePackagedRelease }) };
}

describe('official worker external Node locator', () => {
  it('locates the development worker and verifies a genuine external Node 22+', async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual({ nodeExecutable: f.node, workerPath: f.worker, nodeVersion: 'v22.14.0' });
    expect(f.execute.mock.calls.map(call => call[1][0])).toEqual(['--version', '-p']);
  });
  it('fails early for a missing development worker without executing Node', async () => {
    const f = fixture(); f.files.delete(f.worker);
    await expect(f.run()).rejects.toThrow('LEMO_OFFICIAL_WORKER_MISSING');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('validates the packaged release and ignores global Node and developer overrides', async () => {
    const f = fixture({ isPackaged: true });
    await expect(f.run()).resolves.toEqual(f.packaged);
    expect(f.resolvePackagedRelease).toHaveBeenCalledWith(f.input.resourcesPath);
    expect(f.probePackagedRelease).toHaveBeenCalledWith(f.packaged);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.isFile).not.toHaveBeenCalled();
  });
  it('fails closed on damaged installed resources despite an available global Node', async () => {
    const f = fixture({ isPackaged: true }); f.resolvePackagedRelease.mockRejectedValue(new Error('LEMO_RELEASE_FILE_CHANGED'));
    await expect(f.run()).rejects.toThrow('LEMO_RELEASE_FILE_CHANGED');
    expect(f.probePackagedRelease).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
  });
  it('reports installed runtime preparation failures without trying another executable', async () => {
    const f = fixture({ isPackaged: true }); f.probePackagedRelease.mockRejectedValue(new Error('LEMO_RELEASE_SDK_PREPARATION_FAILED'));
    await expect(f.run()).rejects.toThrow('LEMO_RELEASE_SDK_PREPARATION_FAILED');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each(['v18.20.0', 'v20.19.0', '20.0.0', 'v20.invalid'])('rejects an unsupported version %s', async version => {
    const f = fixture(); f.execute.mockResolvedValue(version);
    await expect(f.run()).rejects.toThrow('LEMO_OFFICIAL_NODE_REQUIRED');
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it.each(['exact', 'symlink'] as const)('never probes Electron through its %s path', async kind => {
    const f = fixture();
    if (kind === 'exact') { f.input.environment!.STORYDREAM_NODE_EXECUTABLE = f.input.electronExecutable; f.files.add(f.input.electronExecutable); }
    else f.realpath.mockImplementation(async path => path === f.node ? f.input.electronExecutable : path);
    await expect(f.run()).rejects.toThrow('LEMO_OFFICIAL_NODE_REQUIRED');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it.each([{ name: 'electron', node: '22.14.0', electron: null }, { name: 'node', node: '22.14.0', electron: '38.0.0' }, { name: 'node', node: '20.0.0', electron: null }])('rejects a disguised or inconsistent runtime %j', async runtime => {
    const f = fixture(); f.execute.mockImplementation(async (_path, args) => args[0] === '--version' ? 'v22.14.0' : JSON.stringify(runtime));
    await expect(f.run()).rejects.toThrow('LEMO_OFFICIAL_NODE_REQUIRED');
  });
  it('strips Node injection environment options without mutating the host environment', async () => {
    const f = fixture({ environment: { NODE_OPTIONS: '--require private-hook', node_path: 'private-modules', Electron_Run_As_Node: '1', KEEP_ME: 'retained' } });
    await f.run();
    const env = f.execute.mock.calls[0][2];
    expect(Object.keys(env).map(key => key.toUpperCase())).not.toEqual(expect.arrayContaining(['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']));
    expect(env).toMatchObject({ KEEP_ME: 'retained' });
    expect(f.input.environment!.NODE_OPTIONS).toBe('--require private-hook');
  });
  it('falls back to a genuine Node on PATH after an unusable explicit executable', async () => {
    const f = fixture(); const pathNode = join(root, 'path-node', f.nodeName); f.files.add(pathNode);
    f.input.environment!.PATH = join(root, 'path-node');
    f.execute.mockImplementation(async (path, args) => path === f.node ? 'v18.20.0' : args[0] === '--version' ? 'v22.14.0' : JSON.stringify({ name: 'node', node: '22.14.0', electron: null }));
    expect((await f.run()).nodeExecutable).toBe(pathNode);
  });
  it('rejects relative input paths before a worker probe', async () => {
    const f = fixture({ appPath: 'relative-app' });
    await expect(f.run()).rejects.toThrow('LEMO_OFFICIAL_RUNTIME_PATH');
    expect(f.isFile).not.toHaveBeenCalled();
  });
});

describe('official session limits', () => {
  it('uses explicit max_tokens and provider timeout while bounding the session', () => {
    expect(lemoOfficialSessionLimits({ requestParamsJson: '{"max_tokens":4096}', timeoutMs: 45000 })).toEqual({ maxOutputTokens: 4096, requestTimeoutMs: 45000, maxRequests: 64, maxTurns: 64, timeoutMs: 1800000 });
    expect(lemoOfficialSessionLimits({})).toMatchObject({ maxOutputTokens: 16384, requestTimeoutMs: 180000 });
  });
  it.each(['{', '[]', 'null', '1'])('rejects invalid request parameters %s', value => {
    expect(() => lemoOfficialSessionLimits({ requestParamsJson: value })).toThrow('LEMO_OFFICIAL_REQUEST_PARAMS');
  });
  it.each([0, -1, 1.5, 1000001, '4096'])('rejects invalid output-token limit %s', value => {
    expect(() => lemoOfficialSessionLimits({ requestParamsJson: JSON.stringify({ max_tokens: value }) })).toThrow('LEMO_OFFICIAL_TOKEN_LIMIT');
  });
  it.each([0, -1, 1.5, NaN])('rejects invalid request timeout %s', value => {
    expect(() => lemoOfficialSessionLimits({ timeoutMs: value })).toThrow('LEMO_OFFICIAL_TIMEOUT');
  });
});
