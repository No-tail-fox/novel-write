import { beforeEach, describe, expect, it } from 'vitest';
import { clearPiLiveActivity, publishPiLiveActivity, readPiLiveActivity } from '../electron/pi-live-activity';

const activity = { runId: 'run-1', updatedAt: '2026-11-15T18:00:00.000Z', phase: 'waiting-model' as const, modelRequests: 3, received: 2, inputTokens: 1200, outputTokens: 300 };
describe('process-local Pi activity', () => {
  beforeEach(() => clearPiLiveActivity('task-1', 'run-1'));
  it('is scoped to task and run, and contains only typed summary data', () => {
    publishPiLiveActivity('task-1', activity);
    expect(readPiLiveActivity('task-1', 'run-1')).toEqual(activity);
    expect(readPiLiveActivity('task-2', 'run-1')).toBeNull();
    expect(readPiLiveActivity('task-1', 'run-2')).toBeNull();
  });
  it('rejects malformed snapshots and clears a settled run', () => {
    publishPiLiveActivity('task-1', { ...activity, inputTokens: -1 });
    expect(readPiLiveActivity('task-1', 'run-1')).toBeNull();
    publishPiLiveActivity('task-1', activity);
    clearPiLiveActivity('task-1', 'run-1');
    expect(readPiLiveActivity('task-1', 'run-1')).toBeNull();
  });
});
