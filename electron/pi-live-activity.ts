import type { PiLiveActivity } from '../src/shared/creative-animation/pi-activity';
import { piLiveActivitySchema } from '../src/shared/creative-animation/pi-activity';

const activities = new Map<string, PiLiveActivity>();
const key = (taskId: string, runId: string) => `${taskId}\0${runId}`;
export function publishPiLiveActivity(taskId: string, activity: PiLiveActivity) {
  const parsed = piLiveActivitySchema.safeParse(activity);
  if (!parsed.success) return;
  activities.set(key(taskId, parsed.data.runId), parsed.data);
}
export function readPiLiveActivity(taskId: string, runId: string): PiLiveActivity | null {
  return activities.get(key(taskId, runId)) ?? null;
}
export function clearPiLiveActivity(taskId: string, runId: string) {
  activities.delete(key(taskId, runId));
}
