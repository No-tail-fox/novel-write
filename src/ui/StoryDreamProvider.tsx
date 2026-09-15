import { FluentProvider } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { storyDreamTheme } from './theme';

export function StoryDreamProvider({ theme, children }: { theme: 'dark' | 'light'; children: ReactNode }) {
  return (
    // Portals inherit theme tokens, not the root's full-screen size and background.
    <FluentProvider className="storydream-provider" theme={storyDreamTheme(theme)} data-storydream-theme={theme} applyStylesToPortals={false}>
      {children}
    </FluentProvider>
  );
}
