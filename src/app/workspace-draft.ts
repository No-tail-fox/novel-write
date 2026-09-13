import { useLayoutEffect, useRef, useState } from 'react';
import { useUnsavedChanges, useWorkspaceNavigation } from './workspace-navigation';

type DraftFields = Record<string, string | number | boolean>;

export function readWorkspaceDraft<T extends DraftFields>(raw: string | null, defaults: T): T {
  if (!raw) return { ...defaults };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('values' in parsed) || !parsed.values || typeof parsed.values !== 'object') return { ...defaults };
    const values = parsed.values as Record<string, unknown>;
    const draft = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T & string)[]) {
      const value = values[key];
      if (typeof value === typeof defaults[key] && (typeof value !== 'number' || Number.isFinite(value))) draft[key] = value as T[typeof key];
    }
    return draft;
  } catch { return { ...defaults }; }
}

// Only explicitly selected non-secret primitive form fields belong in this store.
export function useWorkspaceDraft<T extends DraftFields>({ id, label, value, restore, enabled = true, busy = false }: {
  id: string; label: string; value: T; restore: (value: T) => void; enabled?: boolean; busy?: boolean;
}) {
  const storageKey = `storydream.workspace-draft.v1.${id}`;
  const current = useRef({ value, restore });
  current.current = { value, restore };
  const saved = useRef<T>({ ...value });
  const { controller } = useWorkspaceNavigation();
  const [hydrated, setHydrated] = useState(false);
  useLayoutEffect(() => {
    let loaded = current.current.value;
    try { loaded = readWorkspaceDraft(localStorage.getItem(storageKey), loaded); } catch { /* A later save reports unavailable storage. */ }
    saved.current = loaded;
    current.current.restore(loaded);
    setHydrated(true);
  }, [storageKey]);
  const guard = useUnsavedChanges({
    id, label, busy,
    get dirty() { return enabled && hydrated && JSON.stringify(current.current.value) !== JSON.stringify(saved.current); },
    onSave: async () => {
      const next = { ...current.current.value };
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, values: next }));
      saved.current = next;
      controller.refresh();
      return true;
    },
    onDiscard: () => current.current.restore(saved.current),
  });
  return {
    ...guard,
    snapshot: () => ({ ...current.current.value }),
    complete: (submitted: T) => {
      localStorage.removeItem(storageKey);
      saved.current = { ...submitted };
      controller.refresh();
      return JSON.stringify(current.current.value) === JSON.stringify(submitted);
    },
  };
}
