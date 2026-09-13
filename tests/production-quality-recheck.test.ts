import { describe, expect, it } from 'vitest';
import { resolveProductionQualityRecheckScope } from '../src/shared/production-quality-recheck';

const shots = [
  { id: 'shot-1', startMs: 0, durationMs: 4000 },
  { id: 'shot-2', startMs: 5000, durationMs: 6000, subtitleCues: [{ id: 'cue-1', startMs: 5500, endMs: 6100 }], assetVersionIds: ['image-2'] },
  { id: 'shot-3', startMs: 13000, durationMs: 3000, subtitleCues: [{ id: 'cue-3', startMs: 14000, endMs: 15000 }], assetVersionIds: ['image-3', 'image-2'] },
];

describe('resolveProductionQualityRecheckScope', () => {
  it('resolves shot and asset scopes to the first existing shot', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'asset', shotIds: ['missing', 'shot-2', 'shot-2'] }, shots)).toMatchObject({
      kind: 'asset', shotIds: ['shot-2'], primaryShotId: 'shot-2', seekMs: 5000, inspectorTab: 'generate', requiresFullRender: false,
    });
  });

  it('resolves subtitle scopes to the time range and subtitle inspector', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'subtitle', cueIds: ['cue-1'], startMs: 5500, endMs: 6100 }, shots)).toMatchObject({
      shotIds: ['shot-2'], cueIds: ['cue-1'], primaryShotId: 'shot-2', seekMs: 5500, inspectorTab: 'subtitle', startMs: 5500, endMs: 6100,
    });
  });

  it('uses the first shot after a range when the range starts in a gap', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'media', startMs: 4200 }, shots)).toMatchObject({ primaryShotId: 'shot-2', seekMs: 5000, inspectorTab: 'quality' });
  });

  it('resolves cue ownership before a conflicting shot or stale scene-relative clock', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'subtitle', shotIds: ['shot-1'], cueIds: ['deleted', 'cue-3', 'cue-1', 'cue-3'], startMs: 1000 }, shots))
      .toMatchObject({ shotIds: ['shot-1', 'shot-2', 'shot-3'], cueIds: ['cue-3', 'cue-1'], primaryShotId: 'shot-3', seekMs: 14000 });
  });

  it('maps a shared asset version to each owning shot in timeline order', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'asset', assetVersionIds: ['image-2', 'deleted', 'image-2'] }, shots))
      .toMatchObject({ shotIds: ['shot-2', 'shot-3'], primaryShotId: 'shot-2', seekMs: 5000 });
  });

  it('never sends removed objects or a conflicting clock to another shot', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'subtitle', cueIds: ['deleted'], startMs: 5500 }, shots))
      .toMatchObject({ shotIds: [], cueIds: [] });
    expect(resolveProductionQualityRecheckScope({ kind: 'subtitle', cueIds: ['deleted'], startMs: 5500 }, shots).primaryShotId).toBeUndefined();
    expect(resolveProductionQualityRecheckScope({ kind: 'shot', shotIds: ['shot-3'], startMs: 1000 }, shots).seekMs).toBe(13000);
  });

  it('resolves all shots intersecting a media range and ignores invalid clocks', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'media', startMs: 10000, endMs: 15000 }, shots))
      .toMatchObject({ shotIds: ['shot-2', 'shot-3'], primaryShotId: 'shot-2', seekMs: 10000 });
    expect(resolveProductionQualityRecheckScope({ kind: 'shot', shotIds: ['shot-2'], startMs: NaN, endMs: Infinity }, shots).seekMs).toBe(5000);
  });

  it('marks project scope as requiring a full render even without shots', () => {
    expect(resolveProductionQualityRecheckScope({ kind: 'project' }, [])).toMatchObject({ kind: 'project', inspectorTab: 'quality', requiresFullRender: true });
  });
});
