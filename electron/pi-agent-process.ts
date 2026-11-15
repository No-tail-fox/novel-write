import { utilityProcess, type UtilityProcess } from 'electron';
import { randomUUID } from 'node:crypto';

export interface PiAgentProcessOptions {
  workerPath: string;
  cwd: string;
  /** Host-owned private paths; never inside writable film source. */
  home: string; temp: string;
  executeTool(name: string, input: unknown, callId: string): Promise<unknown>;
  onEvent?(event: unknown): void;
}
/** Desktop process transport; model credentials are never placed in the worker environment. */
export function startPiAgentProcess(options: PiAgentProcessOptions) {
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    HOME: options.home, USERPROFILE: options.home, APPDATA: options.home, LOCALAPPDATA: options.home,
    TEMP: options.temp, TMP: options.temp,
    PI_CODING_AGENT_DIR: options.home, NO_COLOR: '1',
  };
  const child: UtilityProcess = utilityProcess.fork(options.workerPath, [], { cwd: options.cwd, env, stdio: 'ignore', serviceName: 'StoryDream Pi film agent' });
  let closed = false;
  const pending = new Map<string, { resolve(value: any): void; reject(reason: Error): void; timer: ReturnType<typeof setTimeout> }>();
  child.on('message', (message: any) => {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'tool') {
      if (typeof message.name !== 'string' || typeof message.toolCallId !== 'string') return;
      void options.executeTool(message.name, message.params, message.toolCallId).then(
        result => { if (!closed) child.postMessage({ type: 'tool_result', toolCallId: message.toolCallId, result }); },
        error => { if (!closed) child.postMessage({ type: 'tool_result', toolCallId: message.toolCallId, error: error instanceof Error ? error.message : String(error) }); },
      );
      return;
    }
    if (message.type === 'event') { options.onEvent?.(message.event); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.type === 'error') request.reject(new Error(String(message.error)));
    else request.resolve(message);
  });
  child.on('exit', code => {
    closed = true;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`PI_WORKER_EXIT: ${code}`)); }
    pending.clear();
  });
  const send = (type: string, data: Record<string, unknown> = {}, timeoutMs = 300_000): Promise<any> => {
    if (closed) return Promise.reject(new Error('PI_WORKER_CLOSED'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('PI_WORKER_TIMEOUT')); child.kill(); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      try { child.postMessage({ ...data, id, type }); }
      catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
    });
  };
  return {
    start: (config: Record<string, unknown>, restore = false) => send('start', { config, restore }),
    prompt: (text: string, timeoutMs: number) => send('prompt', { text }, timeoutMs),
    compact: (instructions?: string) => send('compact', { instructions }),
    abort: () => send('abort', {}, 15_000),
    close: async () => { if (!closed) { try { await send('shutdown', {}, 10_000); } finally { child.kill(); } } },
    kill: () => child.kill(),
  };
}
