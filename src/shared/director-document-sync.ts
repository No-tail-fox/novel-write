import type { ProductionAssetVersion, ProductionProviderJob, ProductionQualityReport } from './production-workflow';

interface DirectorStoredDocument {
  id: string;
  updatedAt: string;
  assets: ProductionAssetVersion[];
  providerJobs: ProductionProviderJob[];
  qualityReports: ProductionQualityReport[];
}

function mergeRecords<T extends { id: string }>(live: T[], submitted: T[], saved: T[], append: (item: T) => T = (item) => item): T[] {
  const baseline = new Map(submitted.map((item) => [item.id, item]));
  const remote = new Map(saved.map((item) => [item.id, item]));
  const present = new Set(live.map((item) => item.id));
  const merged = live.map((item) => {
    const original = baseline.get(item.id);
    const updated = remote.get(item.id);
    return original && updated && JSON.stringify(item) === JSON.stringify(original) ? updated : item;
  });
  // Preserve local deletions; only append records created after the submitted snapshot.
  return [...merged, ...saved.filter((item) => !present.has(item.id) && !baseline.has(item.id)).map(append)];
}

export function mergeDirectorSavedDocument<T extends DirectorStoredDocument>(live: T, submitted: T, saved: T): T {
  if (live.id !== submitted.id || saved.id !== submitted.id) return live;
  if (live === submitted) return saved;
  return {
    ...live,
    updatedAt: saved.updatedAt,
    assets: mergeRecords(live.assets, submitted.assets, saved.assets, (asset) => ({ ...asset, selected: false })),
    providerJobs: mergeRecords(live.providerJobs, submitted.providerJobs, saved.providerJobs),
    qualityReports: mergeRecords(live.qualityReports, submitted.qualityReports, saved.qualityReports),
  };
}
