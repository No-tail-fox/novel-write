import type { StoryDreamApi } from '../shared/storydream-api';
import {
  defaultAccount,
  defaultActivation,
  defaultConfig,
  defaultCreditTransactions,
  defaultCustomCoverTemplates,
  defaultCustomStyles,
  defaultMinimaxCloneVoices,
  defaultUiPreferences,
} from '../shared/config';
import { stripConfigSecrets, type PublicAppState } from '../shared/config-secrets';
import { normalizeAppConfig } from '../shared/config-utils';
import { promptTemplateCatalog } from '../shared/prompt-template-catalog';
import {
  collectCursorPages,
  historyEntityRevisionKey,
  imageLabSummaryToRecord,
  mergeDeltaViewSlices,
  taskSummaryToTask,
  viralSummaryToRecord,
  voiceLabSummaryToRecord,
  type HistoryResponseRevision,
} from '../shared/state-reconciliation';
import type { DeltaViewState, HistoryRevisionLedger } from '../shared/state-delta';
import { draftTemplates as builtinDraftTemplates, normalizeDraftTemplate } from '../shared/templates';
import type {
  AppConfig,
  AppDelta,
  AppMutationResult,
  BootstrapState,
  CustomStyle,
  HistoryFamily,
  PromptTemplate,
  PromptTemplateSummary,
  TaskSummary,
  ViralAnalysisSummary,
} from '../shared/types';

type AppState = PublicAppState;

function promptTemplatePlaceholder(summary: PromptTemplateSummary): PromptTemplate {
  return { ...summary, content: '' };
}

const initialPromptTemplates = promptTemplateCatalog.map(promptTemplatePlaceholder);

export const initialState: AppState = {
  config: defaultConfig,
  secretStatus: {},
  tasks: [],
  events: [],
  viralAnalyses: [],
  viralEvents: [],
  promptTemplates: initialPromptTemplates,
  draftTemplates: builtinDraftTemplates,
  imageLabRecords: [],
  voiceLabRecords: [],
  customStyles: defaultCustomStyles,
  customCoverTemplates: defaultCustomCoverTemplates,
  creditTransactions: defaultCreditTransactions,
  minimaxCloneVoices: defaultMinimaxCloneVoices,
  account: defaultAccount,
  activation: defaultActivation,
  ui: defaultUiPreferences,
};

export function taskFromMutation(result: AppMutationResult | null): TaskSummary | null {
  return result?.kind === 'task-upsert' ? result.task : null;
}

export function viralFromMutation(result: AppMutationResult | null): ViralAnalysisSummary | null {
  return result?.kind === 'viral-upsert' ? result.record : null;
}

export function configFromMutation(result: AppMutationResult | null): AppConfig {
  if (result?.kind === 'state-patch' && result.patch.kind === 'config') return result.patch.config;
  throw new Error('CONFIG_MUTATION_INVALID: Save did not return a config patch.');
}

export async function loadCompleteBootstrap(api: StoryDreamApi, bootstrap: BootstrapState): Promise<BootstrapState> {
  const [promptTemplates, draftTemplates] = await Promise.all([
    collectCursorPages(bootstrap.promptTemplates, (cursor) => api.listPromptTemplates({ cursor, limit: 100 })),
    collectCursorPages(bootstrap.draftTemplates, (cursor) => api.listDraftTemplates({ cursor, limit: 100 })),
  ]);
  return {
    ...bootstrap,
    promptTemplates: { items: promptTemplates, nextCursor: null },
    draftTemplates: { items: draftTemplates, nextCursor: null },
  };
}

export function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

export function hydrateState(state: Partial<AppState>): AppState {
  return {
    ...cloneState(initialState),
    ...state,
    config: stripConfigSecrets(normalizeAppConfig(state.config ?? defaultConfig)),
    secretStatus: state.secretStatus ?? {},
    tasks: state.tasks ?? [],
    events: state.events ?? [],
    promptTemplates: state.promptTemplates ?? initialPromptTemplates,
    draftTemplates: (state.draftTemplates ?? builtinDraftTemplates).map(normalizeDraftTemplate),
    imageLabRecords: state.imageLabRecords ?? [],
    voiceLabRecords: state.voiceLabRecords ?? [],
    customStyles: mergeDefaultCustomStyles(state.customStyles),
    customCoverTemplates: state.customCoverTemplates ?? defaultCustomCoverTemplates,
    creditTransactions: state.creditTransactions ?? defaultCreditTransactions,
    minimaxCloneVoices: state.minimaxCloneVoices ?? [],
    account: { ...defaultAccount, ...(state.account ?? {}) },
    activation: { ...defaultActivation, ...(state.activation ?? {}) },
    ui: { ...defaultUiPreferences, ...(state.ui ?? {}) },
  };
}

export function bootstrapToState(bootstrap: BootstrapState): AppState {
  const draftDefaults = new Map(builtinDraftTemplates.map((template) => [template.id, template]));
  return hydrateState({
    config: bootstrap.config,
    secretStatus: bootstrap.secretStatus,
    tasks: bootstrap.tasks.items.map((task) => taskSummaryToTask(task)),
    events: [],
    viralAnalyses: bootstrap.viralAnalyses.items.map((summary) => viralSummaryToRecord(summary)),
    viralEvents: [],
    promptTemplates: bootstrap.promptTemplates.items.map(promptTemplatePlaceholder),
    draftTemplates: bootstrap.draftTemplates.items.map((summary) => {
      const base = draftDefaults.get(summary.id) ?? builtinDraftTemplates[0];
      return normalizeDraftTemplate({
        ...base,
        id: summary.id,
        name: summary.name,
        isDefault: summary.isDefault,
        updatedAt: summary.updatedAt,
        canvas: { ...base.canvas, ...summary.canvas },
      });
    }),
    imageLabRecords: bootstrap.imageLabRecords.items.map((summary) => imageLabSummaryToRecord(summary)),
    voiceLabRecords: bootstrap.voiceLabRecords.items.map((summary) => voiceLabSummaryToRecord(summary)),
    customStyles: bootstrap.customStyles,
    customCoverTemplates: bootstrap.customCoverTemplates,
    creditTransactions: bootstrap.creditTransactions,
    minimaxCloneVoices: bootstrap.minimaxCloneVoices,
    account: bootstrap.account,
    activation: bootstrap.activation,
    ui: bootstrap.ui,
  });
}

export function mergeDeltaView(current: AppState, deltaState: DeltaViewState): AppState {
  return mergeDeltaViewSlices(current, deltaState);
}

type HistoryDeltaIdentity = { family: HistoryFamily; id: string; tombstone: boolean };
export type HistoryFamilyEpochs = Partial<Record<HistoryFamily, number>>;

export const allHistoryFamilies: readonly HistoryFamily[] = ['task', 'viral-analysis', 'image-lab', 'voice-lab'];
export const MAX_TASK_DETAIL_REVISION_ATTEMPTS = 3;

export function advanceHistoryFamilyEpochs(
  current: HistoryFamilyEpochs,
  families: readonly HistoryFamily[],
): HistoryFamilyEpochs {
  let next = current;
  for (const family of families) {
    if (next === current) next = { ...current };
    next[family] = (current[family] ?? 0) + 1;
  }
  return next;
}

function historyDeltaIdentity(delta: AppDelta): HistoryDeltaIdentity | null {
  if (delta.kind === 'task-upsert') return { family: 'task', id: delta.task.id, tombstone: false };
  if (delta.kind === 'viral-upsert') return { family: 'viral-analysis', id: delta.record.id, tombstone: false };
  if (delta.kind === 'task-tombstone') return { family: 'task', id: delta.id, tombstone: true };
  if (delta.kind === 'viral-tombstone') return { family: 'viral-analysis', id: delta.id, tombstone: true };
  if (delta.kind === 'image-lab-tombstone') return { family: 'image-lab', id: delta.id, tombstone: true };
  if (delta.kind === 'voice-lab-tombstone') return { family: 'voice-lab', id: delta.id, tombstone: true };
  if (delta.kind !== 'state-patch') return null;
  if (delta.patch.kind === 'image-lab-upsert') {
    return { family: 'image-lab', id: delta.patch.record.id, tombstone: false };
  }
  if (delta.patch.kind === 'voice-lab-upsert') {
    return { family: 'voice-lab', id: delta.patch.record.id, tombstone: false };
  }
  return null;
}

function recordHistoryDeltaRevision(
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
  delta: AppDelta,
): HistoryDeltaIdentity | null {
  const identity = historyDeltaIdentity(delta);
  if (!identity) return null;
  const key = historyEntityRevisionKey(identity.family, identity.id);
  const entityRevision = entityRevisions.get(key) ?? -1;
  const tombstoneRevision = tombstoneRevisions.get(key) ?? -1;
  if (identity.tombstone) {
    if (delta.revision < entityRevision || delta.revision <= tombstoneRevision) return null;
    entityRevisions.delete(key);
    tombstoneRevisions.set(key, delta.revision);
    return identity;
  }
  if (tombstoneRevision >= 0 || delta.revision <= entityRevision) return null;
  entityRevisions.set(key, delta.revision);
  return identity;
}

export function registerHistoryDeltaBarrier(
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
  delta: AppDelta,
  invalidate: (family: HistoryFamily, id: string) => void,
  accepted?: (family: HistoryFamily) => void,
): void {
  const identity = recordHistoryDeltaRevision(entityRevisions, tombstoneRevisions, delta);
  if (!identity) return;
  accepted?.(identity.family);
  if (identity.tombstone) invalidate(identity.family, identity.id);
}

export function replaceHistoryRevisionMap(target: Map<string, number>, ledger: HistoryRevisionLedger | undefined): void {
  for (const [family, revisions] of Object.entries(ledger ?? {}) as Array<[HistoryFamily, Record<string, number>]>) {
    for (const [id, revision] of Object.entries(revisions)) {
      const key = historyEntityRevisionKey(family, id);
      target.set(key, Math.max(target.get(key) ?? -1, revision));
    }
  }
}

export function captureHistoryResponseRevision(
  family: HistoryFamily,
  id: string,
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
): HistoryResponseRevision {
  const key = historyEntityRevisionKey(family, id);
  return {
    entityRevision: entityRevisions.get(key) ?? -1,
    tombstoneRevision: tombstoneRevisions.get(key) ?? -1,
  };
}

export function isHistoryResponseCurrent(
  family: HistoryFamily,
  id: string,
  captured: HistoryResponseRevision,
  entityRevisions: Map<string, number>,
  tombstoneRevisions: Map<string, number>,
): boolean {
  const current = captureHistoryResponseRevision(family, id, entityRevisions, tombstoneRevisions);
  return captured.tombstoneRevision < 0
    && current.entityRevision === captured.entityRevision
    && current.tombstoneRevision === captured.tombstoneRevision;
}

export function mergeDefaultCustomStyles(styles: CustomStyle[] | undefined): CustomStyle[] {
  const current = new Map((styles ?? []).map((style) => [style.id, style]));
  const builtinIds = new Set(defaultCustomStyles.map((style) => style.id));
  return [
    ...defaultCustomStyles.map((style) => current.get(style.id) ?? style),
    ...(styles ?? []).filter((style) => !builtinIds.has(style.id)),
  ];
}
