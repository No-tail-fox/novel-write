/**
 * Renderer-safe formatting for the G-9 relay probe result. Kept apart from `relay-capability-probe.ts`,
 * which now imports the Node network policy (G-5 proxy support) and must stay main-process only.
 */
import type { RelayProbeResult } from './relay-capability-probe';

/** One-paragraph Chinese report for the settings page. */
export function formatRelayProbeResult(result: RelayProbeResult): string {
  return [result.summary, ...result.checks.map(check => `· ${check.detail}`)].join('\n');
}
