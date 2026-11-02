import { spawn } from 'node:child_process';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';
import { LEMO_AGENT_PLUGIN_NAME, LEMO_AGENT_SDK_VERSION, LEMO_AGENT_SKILL_NAME, type LemoAgentSdkProbeReceipt, type LemoAgentSdkProbeRequest } from '../src/shared/lemo-agent-sdk';
import { prepareLemoStateDirectory } from '../services/lemo-agent-worker/paths';
import { lemoWorkerEnvironment } from '../services/lemo-agent-worker/environment';

/** Stop only the process tree spawned for this request, never unrelated Python/Electron tasks. */
export function stopWorkerTree(child: ReturnType<typeof spawn>): Promise<void> {
  const pid = child.pid;
  if (!pid) return Promise.resolve();
  if (process.platform === 'win32') {
    return new Promise(done => {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
      killer.once('error', () => { child.kill(); done(); });
      killer.once('close', () => done());
    });
  }
  try { process.kill(-pid, 'SIGKILL'); } catch { child.kill(); }
  return Promise.resolve();
}

export async function probeOfficialLemoAgentRuntime(options: {
  nodeExecutable: string; workerPath: string; runRoot: string; upstreamRoot: string;
  signal?: AbortSignal; timeoutMs?: number;
}): Promise<LemoAgentSdkProbeReceipt> {
  for (const value of [options.nodeExecutable, options.workerPath, options.runRoot, options.upstreamRoot]) {
    if (!isAbsolute(value)) throw new Error('LEMO_SDK_ABSOLUTE_PATH_REQUIRED');
  }
  if (options.signal?.aborted) throw new Error('LEMO_SDK_CANCELLED');
  const request: LemoAgentSdkProbeRequest = { version: 1, action: 'probe', runRoot: options.runRoot, upstreamRoot: options.upstreamRoot };
  const stateRoot = await prepareLemoStateDirectory(request, 'worker-state');
  const env = lemoWorkerEnvironment(process.env, stateRoot);
  return new Promise((resolve, reject) => {
    const child = spawn(options.nodeExecutable, [options.workerPath], { cwd: options.runRoot, env,
      windowsHide: true, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', stderrBytes = 0, settled = false;
    const finish = (error?: Error, result?: LemoAgentSdkProbeReceipt) => {
      if (settled) return;
      settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', cancel);
      if (error) { void stopWorkerTree(child).finally(() => reject(error)); } else resolve(result!);
    };
    const cancel = () => finish(new Error('LEMO_SDK_CANCELLED'));
    const timer = setTimeout(() => finish(new Error('LEMO_SDK_WORKER_TIMEOUT')), options.timeoutMs ?? 60000);
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.on('error', () => finish(new Error('LEMO_SDK_WORKER_START_FAILED')));
    child.stdin.on('error', () => finish(new Error('LEMO_SDK_WORKER_INPUT_FAILED')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      out += chunk;
      if (Buffer.byteLength(out) > 65536) finish(new Error('LEMO_SDK_WORKER_OUTPUT_LIMIT'));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 65536) finish(new Error('LEMO_SDK_WORKER_OUTPUT_LIMIT'));
    });
    child.on('close', code => {
      if (settled) return;
      try {
        const message = JSON.parse(out.trim());
        if (message.ok !== true) {
          const errorCode = typeof message.code === 'string' && /^LEMO_SDK_[A-Z_]+$/.test(message.code) ? message.code : 'LEMO_SDK_WORKER_FAILED';
          return finish(new Error(errorCode));
        }
        const r = message.result as LemoAgentSdkProbeReceipt;
        if (code !== 0 || r.version !== 1 || r.status !== 'runtime-ready' || r.productionReady !== false || r.paidRequests !== 0
          || r.sdkVersion !== LEMO_AGENT_SDK_VERSION || typeof r.cliVersion !== 'string' || !r.cliVersion
          || r.plugin?.name !== LEMO_AGENT_PLUGIN_NAME || typeof r.plugin.path !== 'string'
          || resolvePath(r.plugin.path) !== resolvePath(options.upstreamRoot, 'plugin')
          || !Array.isArray(r.skills) || !r.skills.includes(LEMO_AGENT_SKILL_NAME)
          || r.outboundRequestsBlocked !== 0 || !Array.isArray(r.limitations)) return finish(new Error('LEMO_SDK_WORKER_INVALID_RECEIPT'));
        finish(undefined, r);
      } catch { finish(new Error('LEMO_SDK_WORKER_INVALID_RECEIPT')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
