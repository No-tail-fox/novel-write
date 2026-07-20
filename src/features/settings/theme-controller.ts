import type { AppMutationResult, ThemeName } from '../../shared/types';

export interface ThemeRoot {
  dataset: Record<string, string | undefined>;
}

export interface RuntimeThemeChangeResult {
  theme: ThemeName;
  mutation: AppMutationResult;
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
}): Promise<RuntimeThemeChangeResult> {
  const root = input.root ?? documentRoot();
  applyStoredTheme(input.nextTheme, root);
  try {
    const mutation = await input.persist();
    const theme = persistedTheme(mutation);
    applyStoredTheme(theme, root);
    return { theme, mutation: mutation! };
  } catch (error) {
    applyStoredTheme(input.currentTheme, root);
    throw error;
  }
}
