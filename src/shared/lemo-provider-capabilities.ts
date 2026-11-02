import { z } from 'zod';
import { LLM_PROTOCOLS, type LlmProtocol } from './llm-protocol';

/** Capability evidence is separate from SDK installation and connection tests. */
export const LEMO_CAPABILITY_VERSION = 1 as const;
export const LEMO_PROVIDER_CAPABILITIES = ['tool-roundtrip', 'image-input', 'sse', 'client-cancel', 'output-budget'] as const;
export type LemoProviderCapability = typeof LEMO_PROVIDER_CAPABILITIES[number];
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const evidence = z.object({
  status: z.enum(['not-tested', 'pass', 'fail', 'unknown']),
  code: z.string().regex(/^[A-Z0-9_]{1,100}$/),
  requestIndexes: z.array(z.number().int().nonnegative()).max(6),
}).strict();
export const lemoCapabilityProfileSchema = z.object({
  version: z.literal(1), fingerprint: hash, endpoint: z.string().url(), model: z.string().min(1).max(256),
  protocol: z.enum(LLM_PROTOCOLS), configurationHash: hash,
  testId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  evidenceSource: z.enum(['live-provider', 'local-fixture']),
  startedAt: z.string().datetime(), updatedAt: z.string().datetime(),
  status: z.enum(['running', 'complete', 'interrupted']),
  acceptedMaxOutputTokens: z.number().int().nonnegative(),
  approvedMaxRequests: z.number().int().min(1).max(6),
  approvedMaxOutputTokens: z.number().int().positive(),
  reservedOutputTokens: z.number().int().nonnegative(),
  requests: z.array(z.object({
    index: z.number().int().nonnegative(), capability: z.enum(LEMO_PROVIDER_CAPABILITIES),
    state: z.enum(['sent', 'received', 'rejected', 'cancelled-locally', 'unknown']),
    maxOutputTokens: z.number().int().positive(), requestHash: hash,
    responseHash: hash.optional(), httpStatus: z.number().int().min(100).max(599).optional(),
    messageId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/).optional(),
    stopReason: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
    inputTokens: z.number().int().nonnegative().optional(), outputTokens: z.number().int().nonnegative().optional(),
  }).strict()).max(6),
  checks: z.object({ 'tool-roundtrip': evidence, 'image-input': evidence, sse: evidence, 'client-cancel': evidence, 'output-budget': evidence }).strict(),
}).strict();
export type LemoCapabilityProfile = z.infer<typeof lemoCapabilityProfileSchema>;
export const lemoCapabilityTestRequestSchema = z.object({
  profileId: z.string().min(1).max(256), testId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
  expectedFingerprint: hash,
  acknowledgePotentialCharges: z.literal(true),
  maxRequests: z.number().int().min(1).max(6),
  maxOutputTokensTotal: z.number().int().min(1).max(1001000),
  outputBudget: z.number().int().min(1).max(1000000),
}).strict();
export type LemoCapabilityTestRequest = z.infer<typeof lemoCapabilityTestRequestSchema>;
export interface LemoCapabilityApi {
  preflightLemoProvider(input: { profileId: string; maxOutputTokens: number }): Promise<LemoCapabilityPreflight>;
  testLemoProvider(input: LemoCapabilityTestRequest): Promise<LemoCapabilityProfile>;
  cancelLemoProviderTest(input: { testId: string }): Promise<void>;
}

export interface LemoCapabilityPreflight {
  protocol?: LlmProtocol;
  fingerprint: string; endpoint: string; model: string;
  staticReady: boolean; blockers: string[]; profile: LemoCapabilityProfile | null;
  testPlan: { maxRequests: 6; maxOutputTokensTotal: number; outputBudget: number };
}
export interface LemoCapabilityDecision {
  ready: boolean; protocol: string; blockers: string[];
  /** Never silently lower the configured budget or switch channels. */
  maxOutputTokens: number; fingerprint: string;
}
export function lemoCapabilityTestPlan(outputBudget: number) {
  if (!Number.isSafeInteger(outputBudget) || outputBudget < 1 || outputBudget > 1000000) throw new Error('LEMO_CAPABILITY_BUDGET');
  return { maxRequests: 6 as const, maxOutputTokensTotal: outputBudget + 448, outputBudget };
}
export function decideLemoProviderCapability(input: {
  fingerprint: string; protocol: string; maxOutputTokens: number;
  profile: LemoCapabilityProfile | null; now?: number; maxAgeMs?: number;
}): LemoCapabilityDecision {
  const blockers: string[] = [];
  const profile = input.profile;
  if (!LLM_PROTOCOLS.includes(input.protocol as LlmProtocol)) blockers.push('LEMO_CAPABILITY_PROTOCOL_UNSUPPORTED');
  if (!profile || profile.fingerprint !== input.fingerprint) blockers.push('LEMO_CAPABILITY_NOT_TESTED');
  else {
    if (profile.protocol !== input.protocol) blockers.push('LEMO_CAPABILITY_PROTOCOL_MISMATCH');
    if (profile.status !== 'complete') blockers.push('LEMO_CAPABILITY_TEST_INCOMPLETE');
    if (profile.evidenceSource !== 'live-provider') blockers.push('LEMO_CAPABILITY_FIXTURE_ONLY');
    const age = (input.now ?? Date.now()) - Date.parse(profile.updatedAt);
    if (age < 0 || age > (input.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000)) blockers.push('LEMO_CAPABILITY_EXPIRED');
    for (const capability of LEMO_PROVIDER_CAPABILITIES) if (profile.checks[capability].status !== 'pass') blockers.push(`LEMO_CAPABILITY_${capability.replaceAll('-', '_').toUpperCase()}`);
    if (profile.acceptedMaxOutputTokens < input.maxOutputTokens) blockers.push('LEMO_CAPABILITY_OUTPUT_BUDGET_UNVERIFIED');
  }
  return { ready: blockers.length === 0, protocol: input.protocol, blockers, maxOutputTokens: input.maxOutputTokens, fingerprint: input.fingerprint };
}
