import { describe, expect, it } from 'vitest';
import { createConfirmSubmissionGuard, nextDialogFocusIndex } from '../src/components/ConfirmDialog';
import { sortTimelineEvents } from '../src/components/EventTimeline';
import type { TaskEvent } from '../src/shared/types';

function event(seq: number | undefined, ts: number, detail: string): TaskEvent {
  return {
    seq,
    taskId: 'task-1',
    type: 'step_info',
    step: 1,
    agent: null,
    tool: null,
    detail,
    dataJson: null,
    ts,
  };
}

describe('shared history governance primitives', () => {
  it('wraps confirmation focus in both directions', () => {
    expect(nextDialogFocusIndex(0, 3, 'backward')).toBe(2);
    expect(nextDialogFocusIndex(2, 3, 'forward')).toBe(0);
    expect(nextDialogFocusIndex(1, 3, 'forward')).toBe(2);
    expect(nextDialogFocusIndex(-1, 3, 'forward')).toBe(0);
    expect(nextDialogFocusIndex(-1, 3, 'backward')).toBe(2);
    expect(nextDialogFocusIndex(0, 0, 'forward')).toBe(-1);
  });

  it('prevents a second confirmation while the first submission is active', async () => {
    const guard = createConfirmSubmissionGuard();
    let release: (() => void) | undefined;
    let calls = 0;
    const first = guard.run(async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return 'done';
    });
    const second = guard.run(async () => {
      calls += 1;
      return 'duplicate';
    });

    expect(await second).toBeUndefined();
    expect(calls).toBe(1);
    release?.();
    await expect(first).resolves.toBe('done');
    await expect(guard.run(async () => 'next')).resolves.toBe('next');
  });

  it('orders timeline events by sequence and then timestamp without mutating input', () => {
    const input = [event(3, 300, 'third'), event(undefined, 50, 'legacy'), event(1, 200, 'first'), event(1, 100, 'first-earlier')];
    const ordered = sortTimelineEvents(input);
    expect(ordered.map((item) => item.detail)).toEqual(['first-earlier', 'first', 'third', 'legacy']);
    expect(input.map((item) => item.detail)).toEqual(['third', 'legacy', 'first', 'first-earlier']);
  });
});
