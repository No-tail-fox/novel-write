import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Dialog } from '../ui';
import { createWorkspaceNavigationController, type UnsavedWorkspace, type WorkspaceNavigationController } from '../shared/workspace-navigation';

const WorkspaceNavigationContext = createContext<WorkspaceNavigationController | null>(null);

export function WorkspaceNavigationProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(createWorkspaceNavigationController);
  return <WorkspaceNavigationContext.Provider value={controller}>{children}</WorkspaceNavigationContext.Provider>;
}

export function useWorkspaceNavigation() {
  const controller = useContext(WorkspaceNavigationContext);
  if (!controller) throw new Error('Workspace navigation provider is missing.');
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, ...snapshot, requestLeave: controller.requestLeave };
}

export function useUnsavedChanges(options: UnsavedWorkspace) {
  const { controller } = useWorkspaceNavigation();
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => controller.register(options.id, () => latest.current), [controller, options.id]);
  useLayoutEffect(() => controller.refresh(), [controller, options.dirty, options.busy, options.label, Boolean(options.onSave)]);
  const requestLeave = useCallback((action: () => void | Promise<void>) => controller.requestLeave(action, [options.id]), [controller, options.id]);
  return { requestLeave };
}

export function WorkspaceLeaveDialog() {
  const { controller, pending, submitting, blocked, canSave, labels, error } = useWorkspaceNavigation();
  return <Dialog open={pending} title="保留未保存的改动？" onOpenChange={(open) => { if (!open) controller.cancel(); }} actions={<>
    <Button disabled={submitting} onClick={() => controller.cancel()}>继续编辑</Button>
    <Button variant="subtle" className="workspace-leave-discard" disabled={submitting || blocked} onClick={() => void controller.confirm('discard')}>放弃改动并离开</Button>
    {canSave ? <Button variant="primary" disabled={submitting || blocked} onClick={() => void controller.confirm('save')}>{submitting ? '正在保存' : '保存并离开'}</Button> : null}
  </>}>
    <div className="workspace-leave-content">
      <p>{labels.join('、') || '当前内容'}有未保存的改动。</p>
      {blocked ? <p role="status">操作正在进行，请等待完成后再离开。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </Dialog>;
}

export function useNativeWindowLeaveGuard(closeWindow: () => Promise<void>, native = true) {
  const { controller } = useWorkspaceNavigation();
  const closeRef = useRef(closeWindow);
  closeRef.current = closeWindow;
  const permitted = useRef(false);
  const close = useCallback(async () => {
    permitted.current = native;
    try { await closeRef.current(); } catch (error) { permitted.current = false; throw error; }
  }, [native]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (permitted.current || !controller.getSnapshot().dirty) return;
      event.preventDefault();
      event.returnValue = '';
      if (native) void controller.requestLeave(close);
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [close, controller, native]);
  return useCallback(() => controller.requestLeave(close), [close, controller]);
}
