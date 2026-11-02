/** Host-owned SDK execution contract. Credentials here authenticate loopback only. */
export interface LemoAgentSessionRequest {
  version: 1;
  action: 'start' | 'resume';
  runRoot: string;
  upstreamRoot: string;
  runId: string;
  stageId: string;
  inputFingerprint: string;
  configFingerprint: string;
  prompt: string;
  gateway: { baseUrl: string; token: string };
  model: string;
  maxOutputTokens: number;
  maxTurns: number;
  maxBudgetUsd?: number;
  capability?: 'film-authoring-v1';
}
export const LEMO_AGENT_HOST_TOOL_MAX_BYTES = 16 * 1024 * 1024;
export interface LemoAgentHostToolRequest {
  version: 1; action: 'host-tool'; runId: string; stageId: string; operationId: string;
  tool: 'review_film' | 'finish_film'; input: { notes?: string };
}
export interface LemoAgentHostToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' | 'image/jpeg' }>;
  isError?: boolean; sideEffectApplied?: boolean;
}
export interface LemoAgentHostToolResultMessage {
  version: 1; action: 'host-tool-result'; runId: string; stageId: string; operationId: string; result: LemoAgentHostToolResult;
}
/** Shared wire validation; the worker additionally verifies actual image bytes. */
export function validateLemoAgentHostToolResult(raw: unknown): LemoAgentHostToolResult {
  const fail = (): never => { throw new Error('LEMO_FILM_HOST_RESULT'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some(key => !['content', 'isError', 'sideEffectApplied'].includes(key))
    || !Array.isArray(value.content) || value.content.length < 1 || value.content.length > 8
    || (value.isError !== undefined && typeof value.isError !== 'boolean')
    || (value.sideEffectApplied !== undefined && typeof value.sideEffectApplied !== 'boolean')) return fail();
  let images = 0; let textBytes = 0;
  for (const rawPart of value.content) {
    if (!rawPart || typeof rawPart !== 'object' || Array.isArray(rawPart)) return fail();
    const part = rawPart as Record<string, unknown>;
    if (part.type === 'text') {
      if (Object.keys(part).sort().join(',') !== 'text,type' || typeof part.text !== 'string') return fail();
      textBytes += new TextEncoder().encode(part.text).length;
      if (textBytes > 262144) return fail();
    } else if (part.type === 'image') {
      if (++images > 3 || Object.keys(part).sort().join(',') !== 'data,mimeType,type'
        || !['image/png', 'image/jpeg'].includes(String(part.mimeType)) || typeof part.data !== 'string'
        || part.data.length < 8 || part.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(part.data)) return fail();
    } else return fail();
  }
  // Reserve bounded space for the routing envelope around the result.
  if (new TextEncoder().encode(JSON.stringify(value)).length > LEMO_AGENT_HOST_TOOL_MAX_BYTES - 4096) return fail();
  return structuredClone(value) as unknown as LemoAgentHostToolResult;
}
export interface LemoAgentSessionCancel {
  version: 1;
  action: 'cancel';
  runId: string;
  stageId: string;
}
export interface LemoAgentSessionReceipt {
  version: 1;
  runId: string;
  stageId: string;
  sessionId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'unknown';
  resultSubtype?: string;
  estimatedCostUsd?: number;
  sdkVersion: string;
  cliVersion: string;
  /** A model result is not a verified rendered deliverable. */
  deliveryStatus: 'unverified';
  artifacts: Array<{ path: string; sha256: string; byteLength: number }>;
}
export type LemoAgentSessionEvent =
  | { type: 'session'; runId: string; stageId: string; sessionId: string }
  | { type: 'tool'; runId: string; stageId: string; operationId: string; tool: string; phase: 'started' | 'completed' | 'failed' }
  | { type: 'result'; runId: string; stageId: string; status: LemoAgentSessionReceipt['status'] };
