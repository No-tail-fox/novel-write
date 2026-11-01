/** Official SDK readiness is distinct from provider and film-production readiness. */
export const LEMO_AGENT_SDK_VERSION = '0.3.314';
export const LEMO_AGENT_PLUGIN_NAME = 'lemo-opuscar';
export const LEMO_AGENT_SKILL_NAME = 'lemo-opuscar:lemo-opuscar';
export const LEMO_AGENT_SDK_PROTOCOL_VERSION = 1;
export interface LemoAgentSdkProbeRequest {
  version: 1;
  action: 'probe';
  runRoot: string;
  upstreamRoot: string;
}
export interface LemoAgentSdkProbeReceipt {
  version: 1;
  status: 'runtime-ready';
  sdkVersion: string;
  cliVersion: string;
  upstreamRevision: string;
  plugin: { name: string; path: string };
  skills: string[];
  paidRequests: 0;
  outboundRequestsBlocked: number;
  productionReady: false;
  limitations: string[];
}
export function assertLemoSdkProviderProtocol(protocol: string | undefined): void {
  if (protocol !== 'anthropic') {
    throw new Error('LEMO_SDK_PROTOCOL: 官方 Agent SDK 需要 Anthropic Messages 协议；不能把 OpenAI Chat/Responses 地址直接传入，也不能关闭工具调用假装兼容。');
  }
}
