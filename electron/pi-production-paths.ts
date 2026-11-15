import { join } from 'node:path';
export function piProductionPaths(work: string, runId: string) {
  if (!/^[a-zA-Z0-9-]{1,160}$/.test(runId)) throw new Error('PI_RUN_ID');
  const root = join(work, 'pi-film', runId);
  return { root, project: join(root, 'project'), state: join(root, 'state'), narration: join(root, 'project', 'material', 'narration'),
    narrationState: join(root, 'narration-state'), reviews: join(root, 'reviews'), audio: join(root, 'audio'), previews: join(root, 'asset-previews') };
}
