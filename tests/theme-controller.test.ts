import { describe, expect, it } from 'vitest';
import {
  applyStoredTheme,
  changeRuntimeTheme,
  revealThemedApplication,
  transitionRendererTheme,
  withRuntimeTheme,
} from '../src/features/settings/theme-controller';
import { defaultConfig } from '@shared/config';
import type { AppMutationResult } from '@shared/types';
import { applyAppMutationResult } from '@shared/state-reconciliation';
import { cloneState, initialState } from '../src/app/app-state';

function root() {
  return { dataset: {} as Record<string, string> };
}

function themeMutation(theme: 'dark' | 'light', revision = 1): AppMutationResult {
  return {
    kind: 'state-patch',
    revision,
    patch: {
      kind: 'theme-preference',
      config: { ...structuredClone(defaultConfig), ui: { theme } },
      ui: { theme, activeView: 'settings', themePreferenceVersion: 1 },
    },
  };
}

describe('runtime theme controller', () => {
  it('applies the stored theme before revealing the application', () => {
    const element = root();
    expect(applyStoredTheme('light', element)).toBe('light');
    expect(element.dataset).toEqual({ theme: 'light' });

    revealThemedApplication(element);
    expect(element.dataset).toEqual({ theme: 'light', themeReady: 'true' });
  });

  it('changes the DOM immediately and resolves from the canonical persisted pair', async () => {
    const element = root();
    applyStoredTheme('dark', element);
    let resolve!: (value: AppMutationResult) => void;
    const persisted = new Promise<AppMutationResult>((done) => { resolve = done; });

    const changing = changeRuntimeTheme({
      currentTheme: 'dark',
      nextTheme: 'light',
      root: element,
      persist: () => persisted,
    });
    expect(element.dataset.theme).toBe('light');

    resolve(themeMutation('light'));
    await expect(changing).resolves.toEqual({ theme: 'light', mutation: themeMutation('light') });
    expect(element.dataset.theme).toBe('light');
  });

  it('keeps renderer state and the DOM on one theme while persistence is pending', async () => {
    const element = root();
    let state = {
      config: structuredClone(defaultConfig),
      ui: { theme: 'dark' as const, activeView: 'settings' as const, themePreferenceVersion: 1 as const },
    };
    let resolve!: (value: AppMutationResult) => void;
    const persisted = new Promise<AppMutationResult>((done) => { resolve = done; });
    const synchronizeState = (expectedTheme: 'dark' | 'light', nextTheme: 'dark' | 'light') => {
      const next = transitionRendererTheme(state, expectedTheme, nextTheme);
      const changed = next !== state;
      state = next;
      return changed;
    };

    const changing = changeRuntimeTheme({
      currentTheme: 'dark',
      nextTheme: 'light',
      root: element,
      synchronizeState,
      persist: () => persisted,
    });

    expect(state.ui.theme).toBe('light');
    expect(state.config.ui.theme).toBe('light');
    expect(element.dataset.theme).toBe('light');

    resolve(themeMutation('light'));
    await changing;
    expect(state.ui.theme).toBe('light');
    expect(element.dataset.theme).toBe('light');
  });

  it('does not let a stale theme completion overwrite a newer renderer choice', async () => {
    const element = root();
    let state = {
      config: structuredClone(defaultConfig),
      ui: { theme: 'dark' as const, activeView: 'settings' as const, themePreferenceVersion: 1 as const },
    };
    let resolve!: (value: AppMutationResult) => void;
    const persisted = new Promise<AppMutationResult>((done) => { resolve = done; });
    const synchronizeState = (expectedTheme: 'dark' | 'light', nextTheme: 'dark' | 'light') => {
      const next = transitionRendererTheme(state, expectedTheme, nextTheme);
      const changed = next !== state;
      state = next;
      return changed;
    };

    const changing = changeRuntimeTheme({
      currentTheme: 'dark',
      nextTheme: 'light',
      root: element,
      synchronizeState,
      persist: () => persisted,
    });
    state = transitionRendererTheme(state, 'light', 'dark');
    element.dataset.theme = 'dark';

    resolve(themeMutation('light'));
    await changing;
    expect(state.ui.theme).toBe('dark');
    expect(element.dataset.theme).toBe('dark');
  });

  it('keeps the DOM and control owner on the requested theme when persistence fails', async () => {
    const element = root();
    applyStoredTheme('dark', element);
    let state = cloneState(initialState);

    await expect(changeRuntimeTheme({
      currentTheme: 'dark',
      nextTheme: 'light',
      root: element,
      synchronizeState: (expected, next) => {
        state = transitionRendererTheme(state, expected, next);
        return state.ui.theme === next;
      },
      persist: async () => { throw new Error('ENOSPC: no space left on device, write'); },
    })).rejects.toMatchObject({ code: 'THEME_SAVE_FAILED', message: expect.stringContaining('主题已应用，但未能保存') });

    expect(element.dataset.theme).toBe('light');
    expect(state.ui.theme).toBe('light');
    expect(state.config.ui.theme).toBe('light');
  });

  it('reports non-canonical persistence responses without undoing the current theme', async () => {
    const element = root();
    applyStoredTheme('light', element);

    await expect(changeRuntimeTheme({
      currentTheme: 'light',
      nextTheme: 'dark',
      root: element,
      persist: async () => null,
    })).rejects.toMatchObject({
      code: 'THEME_SAVE_FAILED',
      message: expect.stringContaining('canonical preference pair'),
    });

    expect(element.dataset.theme).toBe('dark');
  });

  it('preserves the window theme across unrelated preference deltas and authoritative snapshots', () => {
    const stored = cloneState(initialState);
    const navigation = themeMutation('dark');
    if (navigation.kind !== 'state-patch' || navigation.patch.kind !== 'theme-preference') throw new Error('Invalid fixture');
    navigation.patch.ui.activeView = 'queue';
    const reconciled = applyAppMutationResult(stored, navigation, new Map());
    const visible = withRuntimeTheme(reconciled, 'light');
    expect(visible.ui).toMatchObject({ activeView: 'queue', theme: 'light' });
    expect(visible.config.ui.theme).toBe('light');
    expect(withRuntimeTheme(structuredClone(stored), 'light').ui.theme).toBe('light');
    expect(stored.ui.theme).toBe('dark');
    expect(withRuntimeTheme(stored, null)).toBe(stored);
    expect(withRuntimeTheme(visible, 'light')).toBe(visible);
  });

  it('does not let a failed older save revert a newer theme choice', async () => {
    const element = root();
    let reject!: (error: Error) => void;
    const changing = changeRuntimeTheme({
      currentTheme: 'dark', nextTheme: 'light', root: element,
      persist: () => new Promise((_, fail) => { reject = fail; }),
    });
    applyStoredTheme('dark', element);
    reject(new Error('ENOSPC: no space left on device, write'));
    await expect(changing).rejects.toMatchObject({ code: 'THEME_SAVE_FAILED' });
    expect(element.dataset.theme).toBe('dark');
  });
});
