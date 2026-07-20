import type { AppConfig, ShellView, ThemeName, UiPreferences } from './types';

export const THEME_PREFERENCE_VERSION = 1 as const;

export interface ThemePreferencePair {
  ui: UiPreferences;
  config: AppConfig;
}

const shellViews = new Set<ShellView>([
  'new-task',
  'queue',
  'history',
  'task-detail',
  'html-video',
  'image-lab',
  'voice-lab',
  'music-mv',
  'book-selection',
  'benchmark',
  'person-assets',
  'viral-analyzer',
  'prompt-templates',
  'draft-templates',
  'settings',
  'account',
  'activation',
]);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function validTheme(value: unknown): ThemeName | null {
  return value === 'dark' || value === 'light' ? value : null;
}

function validView(value: unknown): ShellView {
  return typeof value === 'string' && shellViews.has(value as ShellView)
    ? value as ShellView
    : 'new-task';
}

export function migrateThemePreference(rawUi: unknown, rawConfig: unknown): UiPreferences {
  const ui = objectValue(rawUi);
  const configUi = objectValue(objectValue(rawConfig).ui);
  const marked = ui.themePreferenceVersion === THEME_PREFERENCE_VERSION;
  const theme = marked
    ? validTheme(ui.theme) ?? 'dark'
    : validTheme(configUi.theme) ?? validTheme(ui.theme) ?? 'dark';
  return {
    theme,
    activeView: validView(ui.activeView),
    themePreferenceVersion: THEME_PREFERENCE_VERSION,
  };
}

export function canonicalThemePreferencePair(config: AppConfig, ui: UiPreferences): ThemePreferencePair {
  const canonicalUi = migrateThemePreference(ui, config);
  return {
    ui: canonicalUi,
    config: {
      ...config,
      ui: { ...config.ui, theme: canonicalUi.theme },
    },
  };
}
