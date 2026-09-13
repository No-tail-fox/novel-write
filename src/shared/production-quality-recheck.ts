import type { ProductionQualityRecheckScope } from './production-workflow';

export interface ProductionQualityRecheckShot {
  id: string;
  startMs: number;
  durationMs: number;
  subtitleCues?: readonly { id: string; startMs: number; endMs: number }[];
  assetVersionIds?: readonly string[];
}

export interface ProductionQualityRecheckPlan {
  kind: ProductionQualityRecheckScope['kind'];
  shotIds: string[];
  cueIds: string[];
  startMs?: number;
  endMs?: number;
  primaryShotId?: string;
  seekMs?: number;
  inspectorTab?: 'generate' | 'subtitle' | 'sound' | 'quality';
  requiresFullRender: boolean;
}

/** Resolve authored report scope into deterministic UI navigation targets. */
export function resolveProductionQualityRecheckScope(
  scope: ProductionQualityRecheckScope,
  shots: readonly ProductionQualityRecheckShot[],
): ProductionQualityRecheckPlan {
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const cueById = new Map(shots.flatMap((shot) => (shot.subtitleCues ?? []).map((cue) => [cue.id, { cue, shot }] as const)));
  const cueIds = [...new Set(scope.cueIds ?? [])].filter((id) => cueById.has(id));
  const targets = new Set((scope.shotIds ?? []).filter((id) => shotById.has(id)));
  cueIds.forEach((id) => targets.add(cueById.get(id)!.shot.id));
  const assetIds = new Set(scope.assetVersionIds ?? []);
  shots.forEach((shot) => { if (shot.assetVersionIds?.some((id) => assetIds.has(id))) targets.add(shot.id); });
  const rangeStart = Number.isFinite(scope.startMs) ? Math.max(0, scope.startMs!) : undefined;
  const rangeEnd = Number.isFinite(scope.endMs) ? Math.max(rangeStart ?? 0, scope.endMs!) : undefined;
  const rangeShot = rangeStart === undefined
    ? undefined
    : shots.find((shot) => rangeStart >= shot.startMs && rangeStart < shot.startMs + shot.durationMs)
      ?? shots.find((shot) => shot.startMs >= rangeStart);
  const hasExplicitTargets = Boolean(scope.shotIds?.length || scope.cueIds?.length || scope.assetVersionIds?.length);
  if (!hasExplicitTargets && scope.kind !== 'project') {
    const rangeShots = rangeStart === undefined ? shots : shots.filter((shot) =>
      shot.startMs + shot.durationMs > rangeStart && shot.startMs < (rangeEnd ?? rangeStart + 1));
    rangeShots.forEach((shot) => targets.add(shot.id));
    if (!targets.size && rangeShot) targets.add(rangeShot.id);
  }
  const resolvedShotIds = scope.kind === 'project' ? [] : shots.filter((shot) => targets.has(shot.id)).map((shot) => shot.id);
  const firstCue = scope.kind === 'project' ? undefined : cueById.get(cueIds[0]);
  const primaryShotId = firstCue?.shot.id ?? resolvedShotIds[0];
  const primaryShot = primaryShotId ? shotById.get(primaryShotId) : undefined;
  // A stale range must never seek away from the explicitly resolved object.
  const requestedSeek = firstCue?.cue.startMs ?? rangeStart;
  const seekMs = primaryShot ? requestedSeek !== undefined && Number.isFinite(requestedSeek)
    && requestedSeek >= primaryShot.startMs && requestedSeek < primaryShot.startMs + primaryShot.durationMs
    ? requestedSeek : primaryShot.startMs : undefined;
  const inspectorTab = scope.kind === 'subtitle'
    ? 'subtitle'
    : scope.kind === 'audio'
      ? 'sound'
      : scope.kind === 'media'
        ? 'quality'
        : scope.kind === 'project'
          ? 'quality'
          : 'generate';

  return {
    kind: scope.kind,
    shotIds: resolvedShotIds,
    cueIds: scope.kind === 'project' ? [] : cueIds,
    ...(rangeStart !== undefined ? { startMs: rangeStart } : {}),
    ...(rangeEnd !== undefined ? { endMs: rangeEnd } : {}),
    ...(primaryShotId ? { primaryShotId } : {}),
    ...(seekMs !== undefined ? { seekMs } : {}),
    inspectorTab,
    requiresFullRender: scope.kind === 'project',
  };
}
