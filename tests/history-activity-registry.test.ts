import { describe, expect, it } from 'vitest';
import { HistoryActivityRegistry } from '../electron/history-activity-registry';
import type { HistoryFamily } from '../src/shared/types';

const families: HistoryFamily[] = ['task', 'viral-analysis', 'image-lab', 'voice-lab'];

describe('HistoryActivityRegistry', () => {
  it.each(families)('rejects governance while %s is active and allows it after release', (family) => {
    const registry = new HistoryActivityRegistry();
    const active = registry.reserveActive(family, 'shared-id');

    expect(() => registry.reserveGovernance(family, 'shared-id')).toThrow(/active/i);

    active.release();
    expect(() => registry.reserveGovernance(family, 'shared-id').release()).not.toThrow();
  });

  it.each(families)('rejects active work while %s is governed and allows it after release', (family) => {
    const registry = new HistoryActivityRegistry();
    const governance = registry.reserveGovernance(family, 'shared-id');

    expect(() => registry.reserveActive(family, 'shared-id')).toThrow(/governance/i);

    governance.release();
    expect(() => registry.reserveActive(family, 'shared-id').release()).not.toThrow();
  });

  it('rejects duplicate reservations in the same direction', () => {
    const registry = new HistoryActivityRegistry();
    const active = registry.reserveActive('task', 'task-duplicate-active');
    const governance = registry.reserveGovernance('task', 'task-duplicate-governance');

    expect(() => registry.reserveActive('task', 'task-duplicate-active')).toThrow(/active/i);
    expect(() => registry.reserveGovernance('task', 'task-duplicate-governance')).toThrow(/governance/i);

    active.release();
    governance.release();
  });

  it('makes release idempotent and prevents an old token from releasing a newer reservation', () => {
    const registry = new HistoryActivityRegistry();
    const first = registry.reserveActive('image-lab', 'reused-id');
    first.release();
    const second = registry.reserveGovernance('image-lab', 'reused-id');

    expect(() => first.release()).not.toThrow();
    expect(() => registry.reserveActive('image-lab', 'reused-id')).toThrow(/governance/i);

    second.release();
    expect(() => second.release()).not.toThrow();
    const third = registry.reserveActive('image-lab', 'reused-id');
    third.release();
  });

  it('isolates reservations by family and ID and bounds conflict errors', () => {
    const registry = new HistoryActivityRegistry();
    const longId = 'x'.repeat(10_000);
    const held = registry.reserveActive('task', longId);

    expect(() => registry.reserveActive('viral-analysis', longId).release()).not.toThrow();
    expect(() => registry.reserveActive('task', 'another-id').release()).not.toThrow();

    let conflict: unknown;
    try {
      registry.reserveGovernance('task', longId);
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toBeInstanceOf(Error);
    expect((conflict as Error).message).toMatch(/active/i);
    expect((conflict as Error).message.length).toBeLessThanOrEqual(256);

    held.release();
  });

  it('rejects new reservations after close and waits for every existing lease to become idle', async () => {
    const registry = new HistoryActivityRegistry();
    const active = registry.reserveActive('image-lab', 'shutdown-image');
    const governing = registry.reserveGovernance('voice-lab', 'shutdown-voice');
    let idle = false;
    const waiting = registry.waitForIdle().then(() => {
      idle = true;
    });

    registry.close();
    expect(() => registry.reserveActive('task', 'late-task')).toThrow(/closed|shutdown/i);
    expect(() => registry.reserveGovernance('viral-analysis', 'late-viral')).toThrow(/closed|shutdown/i);
    await Promise.resolve();
    expect(idle).toBe(false);

    active.release();
    await Promise.resolve();
    expect(idle).toBe(false);
    governing.release();
    await waiting;
    expect(idle).toBe(true);
    await expect(registry.waitForIdle()).resolves.toBeUndefined();
  });
});
