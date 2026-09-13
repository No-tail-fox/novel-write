import { describe, expect, it } from 'vitest';
import { createWorkspaceNavigationController, type UnsavedWorkspace } from '../src/shared/workspace-navigation';

function fixture(save: () => Promise<boolean> = async () => true) {
  const controller = createWorkspaceNavigationController();
  let discarded = 0;
  const workspace: UnsavedWorkspace = { id: 'project-a', label: '项目 A', dirty: true, onSave: save, onDiscard: () => { discarded++; workspace.dirty = false; } };
  controller.register(workspace.id, () => workspace);
  return { controller, workspace, discarded: () => discarded };
}

describe('workspace navigation', () => {
  it('allows leaving a clean workspace while its destination is still loading', async () => {
    const controller = createWorkspaceNavigationController();
    let finish!: () => void;
    const loading = controller.requestLeave(() => new Promise<void>((resolve) => { finish = resolve; }));
    let left = false;
    expect(await controller.requestLeave(() => { left = true; })).toBe(true);
    expect(left).toBe(true);
    finish();
    expect(await loading).toBe(true);
  });

  it('keeps the draft and original destination when a second navigation arrives', async () => {
    const { controller, discarded } = fixture();
    const destinations: string[] = [];
    const first = controller.requestLeave(() => { destinations.push('history'); });
    expect(await controller.requestLeave(() => { destinations.push('settings'); })).toBe(false);
    controller.cancel();
    expect(await first).toBe(false);
    expect(discarded()).toBe(0);
    expect(destinations).toEqual([]);
  });

  it('does not leave on a resolved failed save and permits a subsequent retry', async () => {
    let succeeds = false;
    const { controller } = fixture(async () => succeeds);
    let left = false;
    const request = controller.requestLeave(() => { left = true; });
    await controller.confirm('save');
    expect(left).toBe(false);
    expect(controller.getSnapshot().error).toContain('未能保存');
    succeeds = true;
    await controller.confirm('save');
    expect(await request).toBe(true);
    expect(left).toBe(true);
  });

  it('serializes saves and does not execute navigation before they complete', async () => {
    let finish!: (value: boolean) => void;
    let calls = 0;
    const { controller } = fixture(() => { calls++; return new Promise((resolve) => { finish = resolve; }); });
    let left = false;
    const request = controller.requestLeave(() => { left = true; });
    const saving = controller.confirm('save');
    await controller.confirm('discard');
    controller.cancel();
    expect(calls).toBe(1);
    expect(left).toBe(false);
    finish(true);
    await saving;
    expect(await request).toBe(true);
  });

  it('requires confirmation for other drafts when a scoped action requests global navigation', async () => {
    const { controller, workspace, discarded } = fixture();
    let otherDirty = true;
    controller.register('other', () => ({ id: 'other', label: '其他草稿', dirty: otherDirty, onDiscard: () => { otherDirty = false; } }));
    let left = false;
    const request = controller.requestLeave(async () => { await controller.requestLeave(() => { left = true; }); }, [workspace.id]);
    await controller.confirm('discard');
    expect(discarded()).toBe(1);
    expect(left).toBe(false);
    expect(otherDirty).toBe(true);
    expect(controller.getSnapshot().pending).toBe(true);
    await controller.confirm('discard');
    expect(await request).toBe(true);
    expect(left).toBe(true);
    expect(otherDirty).toBe(false);
  });

  it('blocks destructive leave while a workspace operation is running', async () => {
    const { controller, workspace, discarded } = fixture();
    workspace.busy = true;
    const request = controller.requestLeave(() => undefined);
    await controller.confirm('discard');
    expect(discarded()).toBe(0);
    workspace.busy = false;
    controller.refresh();
    await controller.confirm('discard');
    expect(await request).toBe(true);
  });

  it('keeps pending navigation recoverable after a thrown save error', async () => {
    const { controller } = fixture(async () => { throw new Error('Disk full'); });
    const request = controller.requestLeave(() => undefined);
    await controller.confirm('save');
    expect(controller.getSnapshot()).toMatchObject({ pending: true, submitting: false, error: 'Disk full' });
    controller.cancel();
    expect(await request).toBe(false);
  });
});
