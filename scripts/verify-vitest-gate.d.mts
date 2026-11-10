export const VITEST_REPORT_CLOCK_SLACK_MS: number;

export interface VitestGateRun { status: number | null; signal?: string | null; error?: unknown }
export interface VitestGateBaseline { failures?: string[]; requiresLocalVendor?: string[]; [key: string]: unknown }
export interface VitestGateInput {
  run: VitestGateRun;
  report: unknown;
  sidecar: unknown;
  nonce: string;
  spawnedAtMs: number;
  root: string;
  baseline: VitestGateBaseline;
  tolerateVendorOnly: boolean;
  updateBaseline: boolean;
}
export interface VitestGateResult {
  ok: boolean;
  problems: string[];
  failed: string[];
  unexpected: string[];
  fixed: string[];
  nextBaseline: (VitestGateBaseline & { failures: string[] }) | null;
  notes: string[];
}

export function collectVitestFailures(report: unknown, root: string): string[];
export function vitestRunProblems(input: Pick<VitestGateInput, 'run' | 'report' | 'sidecar' | 'nonce' | 'spawnedAtMs'>): string[];
export function evaluateVitestGate(input: VitestGateInput): VitestGateResult;
