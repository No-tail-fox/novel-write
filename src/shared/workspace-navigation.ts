export interface UnsavedWorkspace {
  id: string;
  label: string;
  dirty: boolean;
  busy?: boolean;
  onSave?: () => Promise<boolean>;
  onDiscard: () => void | Promise<void>;
}

export interface WorkspaceNavigationSnapshot {
  dirty: boolean;
  pending: boolean;
  submitting: boolean;
  blocked: boolean;
  canSave: boolean;
  labels: readonly string[];
  error: string;
}

export function createWorkspaceNavigationController() {
  const workspaces = new Map<string, () => UnsavedWorkspace>();
  const listeners = new Set<() => void>();
  let pending: { ids?: string[]; action: () => void | Promise<void>; resolve: (value: boolean) => void } | null = null;
  let submitting = false;
  let approvedIds: Set<string> | null = null;
  let transitioning = false;
  let error = '';
  let snapshot: WorkspaceNavigationSnapshot = { dirty: false, pending: false, submitting: false, blocked: false, canSave: false, labels: [], error: '' };
  const current = (ids?: string[]) => [...workspaces.entries()]
    .filter(([id]) => !ids || ids.includes(id))
    .map(([, read]) => read())
    .filter((item) => item.dirty);
  function refresh() {
    const entries = current(pending?.ids);
    snapshot = {
      dirty: current().length > 0,
      pending: Boolean(pending),
      submitting,
      blocked: entries.some((entry) => entry.busy),
      canSave: entries.every((entry) => Boolean(entry.onSave)),
      labels: entries.map((entry) => entry.label),
      error,
    };
    listeners.forEach((listener) => listener());
  }
  async function execute(action: () => void | Promise<void>, ids: string[] = []) {
    transitioning = true;
    let result: void | Promise<void>;
    try {
      approvedIds = new Set(ids);
      result = action();
    } finally {
      approvedIds = null;
      transitioning = false;
    }
    await result;
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    refresh,
    register(id: string, read: () => UnsavedWorkspace) {
      workspaces.set(id, read);
      refresh();
      return () => {
        if (workspaces.get(id) === read) workspaces.delete(id);
        refresh();
      };
    },
    async requestLeave(action: () => void | Promise<void>, ids?: string[]): Promise<boolean> {
      if (approvedIds) {
        const unapproved = current(ids).filter((entry) => !approvedIds!.has(entry.id));
        if (unapproved.length) {
          if (pending?.ids) pending.ids = [...new Set([...pending.ids, ...unapproved.map((entry) => entry.id)])];
          throw new Error('还有未保存的内容，请确认后再离开。');
        }
        await action(); return true;
      }
      if (pending || submitting || transitioning) return false;
      const entries = current(ids);
      if (!entries.length) { await execute(action); return true; }
      return new Promise<boolean>((resolve) => {
        pending = { ids, action, resolve };
        error = '';
        refresh();
      });
    },
    cancel() {
      if (submitting) return;
      const previous = pending;
      pending = null;
      error = '';
      refresh();
      previous?.resolve(false);
    },
    async confirm(mode: 'save' | 'discard') {
      if (!pending || submitting) return;
      const transition = pending;
      const entries = current(transition.ids);
      if (entries.some((entry) => entry.busy)) return;
      submitting = true;
      error = '';
      refresh();
      try {
        for (const original of entries) {
          const entry = workspaces.get(original.id)?.();
          if (!entry?.dirty) continue;
          if (mode === 'save') {
            if (!entry.onSave || !(await entry.onSave())) throw new Error(`${entry.label}未能保存，请检查后重试。`);
          } else {
            await entry.onDiscard();
          }
        }
        await execute(transition.action, entries.map((entry) => entry.id));
        pending = null;
        transition.resolve(true);
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      } finally {
        submitting = false;
        refresh();
      }
    },
  };
}

export type WorkspaceNavigationController = ReturnType<typeof createWorkspaceNavigationController>;
