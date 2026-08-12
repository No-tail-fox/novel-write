import { FluentProvider } from '@fluentui/react-components';
import type { ReactNode } from 'react';
import { storyDreamTheme } from './theme';

export function StoryDreamProvider({ theme, children }: { theme: 'dark' | 'light'; children: ReactNode }) {
  return (
    <FluentProvider className="storydream-provider" theme={storyDreamTheme(theme)} data-storydream-theme={theme}>
      {children}
    </FluentProvider>
  );
}
