import { describe, expect, it } from 'vitest';
import {
  applyStoredTheme,
  changeRuntimeTheme,
  revealThemedApplication,
} from '../src/features/settings/theme-controller';
import { defaultConfig } from '@shared/config';
import type { AppMutationResult } from '@shared/types';

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

  it('rolls the DOM and control owner back when persistence fails', async () => {
    const element = root();
    applyStoredTheme('dark', element);

    await expect(changeRuntimeTheme({
      currentTheme: 'dark',
      nextTheme: 'light',
      root: element,
      persist: async () => { throw new Error('theme save failed'); },
    })).rejects.toThrow('theme save failed');

    expect(element.dataset.theme).toBe('dark');
  });

  it('rejects non-canonical persistence responses and restores the previous theme', async () => {
    const element = root();
    applyStoredTheme('light', element);

    await expect(changeRuntimeTheme({
      currentTheme: 'light',
      nextTheme: 'dark',
      root: element,
      persist: async () => null,
    })).rejects.toThrow('THEME_MUTATION_INVALID');

    expect(element.dataset.theme).toBe('light');
  });
});
