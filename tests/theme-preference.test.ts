import { describe, expect, it } from 'vitest';
import { defaultConfig, defaultUiPreferences } from '@shared/config';
import {
  THEME_PREFERENCE_VERSION,
  canonicalThemePreferencePair,
  migrateThemePreference,
} from '@shared/theme-preference';

describe('theme preference ownership', () => {
  it('migrates once using legacy config, then raw UI, then the dark default', () => {
    expect(migrateThemePreference(
      { theme: 'dark', activeView: 'history' },
      { ui: { theme: 'light' } },
    )).toEqual({ theme: 'light', activeView: 'history', themePreferenceVersion: 1 });

    expect(migrateThemePreference(
      { theme: 'light', activeView: 'queue' },
      { ui: { theme: 'invalid' } },
    )).toEqual({ theme: 'light', activeView: 'queue', themePreferenceVersion: 1 });

    expect(migrateThemePreference(
      { theme: 'invalid', activeView: 'invalid' },
      { ui: { theme: 'invalid' } },
    )).toEqual(defaultUiPreferences);
  });

  it('treats a versioned UI preference as authoritative over legacy config', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(migrateThemePreference(
        { theme, activeView: 'settings', themePreferenceVersion: THEME_PREFERENCE_VERSION },
        { ui: { theme: theme === 'light' ? 'dark' : 'light' } },
      )).toEqual({ theme, activeView: 'settings', themePreferenceVersion: 1 });
    }
  });

  it('always mirrors the canonical UI theme into config', () => {
    const pair = canonicalThemePreferencePair(
      { ...structuredClone(defaultConfig), ui: { theme: 'light' } },
      { theme: 'dark', activeView: 'new-task', themePreferenceVersion: 1 },
    );
    expect(pair.ui.theme).toBe('dark');
    expect(pair.config.ui.theme).toBe('dark');
  });
});
