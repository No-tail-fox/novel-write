import { lstat, mkdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { LemoAgentSdkProbeRequest } from '../../src/shared/lemo-agent-sdk';

function inside(root: string, file: string): boolean {
  const part = relative(root, file);
  return !part || (!isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep));
}
export function validateProbeRequest(value: unknown): LemoAgentSdkProbeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LEMO_SDK_REQUEST');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).sort().join(',') !== 'action,runRoot,upstreamRoot,version'
    || v.version !== 1 || v.action !== 'probe'
    || typeof v.runRoot !== 'string' || typeof v.upstreamRoot !== 'string'
    || !isAbsolute(v.runRoot) || !isAbsolute(v.upstreamRoot)
    || /[\x00-\x1f]/.test(v.runRoot + v.upstreamRoot)
    || inside(resolve(v.upstreamRoot), resolve(v.runRoot))) throw new Error('LEMO_SDK_REQUEST');
  return v as unknown as LemoAgentSdkProbeRequest;
}
async function assertNoLinkedParents(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('LEMO_SDK_STATE_LINK'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(current); if (parent === current) return; current = parent;
  }
}
/** Check before mkdir so rejected probes never mutate the upstream library. */
export async function prepareLemoStateDirectory(request: LemoAgentSdkProbeRequest, child: 'sdk-state' | 'worker-state') {
  validateProbeRequest(request);
  await assertNoLinkedParents(request.runRoot);
  const library = await realpath(request.upstreamRoot);
  if (inside(library, resolve(request.runRoot))) throw new Error('LEMO_SDK_UNSAFE_STATE_ROOT');
  const state = join(request.runRoot, child);
  await assertNoLinkedParents(state);
  for (const name of ['home', 'appdata', 'localappdata', 'temp', 'claude', 'project']) {
    const path = join(state, name);
    await assertNoLinkedParents(path);
    await mkdir(path, { recursive: true });
  }
  return realpath(state);
}
