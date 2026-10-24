import type { AppConfig, AppMutationResult, ThemeName, UiPreferences } from '../../shared/types';
import { AppError, normalizeAppError } from '../../shared/app-error';

export interface ThemeRoot {
  dataset: Record<string, string | undefined>;
}

export interface RuntimeThemeChangeResult {
  theme: ThemeName;
  mutation: AppMutationResult;
}

export type RuntimeThemeStateSynchronizer = (expectedTheme: ThemeName, nextTheme: ThemeName) => boolean;

interface RendererThemeState {
  config: AppConfig;
  ui: UiPreferences;
}

function documentRoot(): ThemeRoot {
  return document.documentElement as unknown as ThemeRoot;
}

export function applyStoredTheme(theme: ThemeName, root: ThemeRoot = documentRoot()): ThemeName {
  root.dataset.theme = theme;
  return theme;
}

export function revealThemedApplication(root: ThemeRoot = documentRoot()): void {
  root.dataset.themeReady = 'true';
}

export function transitionRendererTheme<T extends RendererThemeState>(
  state: T,
  expectedTheme: ThemeName,
  nextTheme: ThemeName,
): T {
  if (state.ui.theme !== expectedTheme || expectedTheme === nextTheme) return state;
  return withRuntimeTheme(state, nextTheme);
}

export function withRuntimeTheme<T extends RendererThemeState>(state: T, theme: ThemeName | null): T {
  if (theme === null || (state.ui.theme === theme && state.config.ui.theme === theme)) return state;
  return {
    ...state,
    config: {
      ...state.config,
      ui: { ...state.config.ui, theme },
    },
    ui: { ...state.ui, theme },
  };
}

function persistedTheme(mutation: AppMutationResult | null): ThemeName {
  if (mutation?.kind !== 'state-patch' || mutation.patch.kind !== 'theme-preference') {
    throw new Error('THEME_MUTATION_INVALID: Theme save did not return the canonical preference pair.');
  }
  return mutation.patch.ui.theme;
}

export async function changeRuntimeTheme(input: {
  currentTheme: ThemeName;
  nextTheme: ThemeName;
  persist: () => Promise<AppMutationResult | null>;
  root?: ThemeRoot;
  synchronizeState?: RuntimeThemeStateSynchronizer;
}): Promise<RuntimeThemeChangeResult> {
  const root = input.root ?? documentRoot();
  const previewAccepted = input.synchronizeState?.(input.currentTheme, input.nextTheme) ?? true;
  if (previewAccepted) applyStoredTheme(input.nextTheme, root);
  try {
    const mutation = await input.persist();
    const theme = persistedTheme(mutation);
    const persistedAccepted = input.synchronizeState?.(input.nextTheme, theme) ?? true;
    if (persistedAccepted) applyStoredTheme(theme, root);
    return { theme, mutation: mutation! };
  } catch (error) {
    const failure = normalizeAppError(error);
    throw new AppError(
      'THEME_SAVE_FAILED',
      `主题已应用，但未能保存，重新打开后可能恢复原主题。${failure.message}`,
      true,
      failure.diagnosticId,
    );
  }
}
