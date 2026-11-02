import type { EditorialCollageShot } from '../src/shared/editorial-collage';
import { defaultLemoProductionBudget } from '../src/shared/lemo-production-budget';
import { voxProductionSettings, type VoxProductionRun, type VoxProductionNode } from '../src/shared/vox-production';
import { lemoCapabilityTestPlan, type LemoCapabilityProfile, type LemoCapabilityPreflight } from '../src/shared/lemo-provider-capabilities';

export const lemoUiShots: EditorialCollageShot[] = [1, 2, 3].map(index => ({
  id: 'shot-' + index, beatId: 'beat-1', title: ['港口变迁', '商贸路线', '城市记忆'][index - 1], durationMs: 5000,
  renderStrategy: 'remotion', scenePrompt: '城市档案画面', motionPrompt: '平稳推进', layers: [], camera: [], subtitleCueIds: [],
}));
export function lemoUiRun(): VoxProductionRun {
  const steps: Array<[string, VoxProductionNode['kind']]> = [['official-treatment', 'film-edit'], ['official-style-frame', 'film-edit'],
    ['official-voice-lock', 'film-edit'], ['official-authoring', 'film-edit'], ['official-ready', 'film-finalize'], ['render', 'render'], ['verify', 'verify']];
  return { version: 1, id: 'ui-fixture-run', status: 'completed', authoringVersion: 4,
    settings: { ...voxProductionSettings(), authoring: { mode: 'ai-code', styleId: 'auto' }, lemoBudget: defaultLemoProductionBudget() },
    sourceHash: 'a'.repeat(64), runtimeIdentity: 'offline-ui-fixture', createdAt: '2026-11-02T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z',
    nodes: steps.map(([id, kind], index) => ({ id, kind, dependencies: index ? [steps[index - 1][0]] : [], status: 'completed', paid: kind === 'film-edit', attempt: 1 })),
    message: '成片已导出；请审阅实际画面和声音。',
  };
}
export function lemoUiProfile(testId = 'offline-ui-fixture', tokens = 16384): LemoCapabilityProfile {
  const check = (): LemoCapabilityProfile['checks']['sse'] => ({ status: 'pass', code: 'OFFLINE_UI_FIXTURE', requestIndexes: [] });
  return { version: 1, fingerprint: 'a'.repeat(64), endpoint: 'https://fixture.invalid/v1/messages', model: 'offline-ui-model', protocol: 'anthropic',
    configurationHash: 'b'.repeat(64), testId, evidenceSource: 'local-fixture', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'complete', acceptedMaxOutputTokens: tokens, approvedMaxRequests: 6, approvedMaxOutputTokens: tokens + 448, reservedOutputTokens: tokens + 448, requests: [],
    checks: { 'tool-roundtrip': check(), 'image-input': check(), sse: check(), 'client-cancel': check(), 'output-budget': check() },
  };
}
export function lemoUiPreflight(tokens = 16384): LemoCapabilityPreflight {
  return { fingerprint: 'a'.repeat(64), endpoint: 'https://fixture.invalid/v1/messages', model: 'offline-ui-model', staticReady: true,
    blockers: [], profile: null, testPlan: lemoCapabilityTestPlan(tokens) };
}
