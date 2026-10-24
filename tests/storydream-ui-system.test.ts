import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

describe('StoryDream Fluent UI system', () => {
  it('uses Fluent UI React without adding a second icon library', async () => {
    const pkg = JSON.parse(await source('../package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.['@fluentui/react-components']).toBe('^9.74.5');
    expect(pkg.dependencies?.['@fluentui/react-icons']).toBeUndefined();
    expect(pkg.devDependencies?.['lucide-react']).toBe('^1.16.0');
  });

  it('maps StoryDream light and dark themes through one provider', async () => {
    const provider = await source('../src/ui/StoryDreamProvider.tsx');
    const theme = await source('../src/ui/theme.ts');
    const app = await source('../src/app/App.tsx');

    expect(provider).toContain('FluentProvider');
    expect(provider).toContain('storyDreamTheme(theme)');
    expect(theme).toContain('storyDreamDarkTheme');
    expect(theme).toContain('storyDreamLightTheme');
    expect(theme).toContain('#f2614b');
    expect(theme).toContain('#cf4938');
    expect(app).toContain('<StoryDreamProvider theme={state.ui.theme}>');
  });

  it('keeps zero-valued slider labels visible', async () => {
    const slider = await source('../src/ui/SliderField.tsx');

    expect(slider).toContain('valueLabel !== undefined');
  });

  it('keeps enabled control labels readable on primary and secondary surfaces', async () => {
    const { storyDreamDarkTheme, storyDreamLightTheme } = await import('../src/ui/theme');
    const luminance = (hex: string): number => {
      const channels = hex.slice(1).match(/.{2}/gu)!.map((channel) => {
        const value = parseInt(channel, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
    };

    for (const theme of [storyDreamDarkTheme, storyDreamLightTheme]) {
      for (const foreground of [theme.colorNeutralForeground1, theme.colorNeutralForeground2, theme.colorNeutralForeground3]) {
        for (const background of [theme.colorNeutralBackground1, theme.colorNeutralBackground2]) {
          const values = [luminance(foreground), luminance(background)];
          const ratio = (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
          expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('shares theme tokens with portals without copying full-screen root styles', async () => {
    const { StoryDreamProvider } = await import('../src/ui/StoryDreamProvider');
    const { storyDreamTheme } = await import('../src/ui/theme');
    const styles = await source('../src/styles/storydream-ui.css');

    for (const theme of ['dark', 'light'] as const) {
      const provider = StoryDreamProvider({ theme, children: null });
      expect(provider.props.applyStylesToPortals).toBe(false);
      expect(provider.props.theme).toBe(storyDreamTheme(theme));
      expect(provider.props.className).toBe('storydream-provider');
    }
    expect(styles).toContain('[data-portal-node] *');
    expect(styles).toContain('[data-portal-node] *::before');
    expect(styles).toContain('[data-portal-node] *::after');
  }, 30_000);

  it('exports project-owned core components and workspace extensions', async () => {
    const index = await source('../src/ui/index.ts');
    const expectedExports = [
      'Button',
      'IconButton',
      'TextField',
      'TextAreaField',
      'SelectField',
      'ColorField',
      'CheckboxField',
      'SwitchField',
      'SliderField',
      'Tabs',
      'SegmentedControl',
      'Tooltip',
      'Menu',
      'Dialog',
      'Toolbar',
      'Pane',
      'StoryDreamProvider',
      'Drawer',
      'HoverPreview',
      'PreviewSelectField',
    ];

    for (const component of expectedExports) {
      expect(index).toContain(`export { ${component} }`);
    }
  });

  it('keeps migrated settings and task workflows inside the shared component layer', async () => {
    const paths = [
      'SettingsPage.tsx', 'settings-controls.tsx', 'ProviderProfileManagers.tsx',
      'MinimaxCloneVoiceManager.tsx', 'MusicVideoProfileManagers.tsx',
    ];
    const pages = await Promise.all(paths.map((path) => source(`../src/features/settings/${path}`)));
    pages.push(await source('../src/features/tasks/QueuePage.tsx'));
    pages.push(await source('../src/features/tasks/HistoryPage.tsx'));
    pages.push(await source('../src/features/tasks/NewTaskPage.tsx'));
    pages.push(await source('../src/features/tasks/TaskDetailPage.tsx'));
    pages.push(await source('../src/features/tasks/TaskArtifactPreview.tsx'));
    pages.push(await source('../src/features/templates/PromptTemplatesPage.tsx'));
    pages.push(await source('../src/features/templates/PromptTemplateEditor.tsx'));
    pages.push(await source('../src/features/templates/DraftTemplatesPage.tsx'));
    pages.push(await source('../src/features/labs/VoiceLabPage.tsx'));
    pages.push(await source('../src/features/labs/ImageLabPage.tsx'));
    pages.push(await source('../src/features/labs/BenchmarkImportPage.tsx'));
    pages.push(await source('../src/features/html-video/HtmlVideoPage.tsx'));
    pages.push(await source('../src/features/html-video/HtmlVideoTabPanel.tsx'));
    pages.push(await source('../src/features/html-video/HtmlVideoAuthoringWorkspace.tsx'));
    pages.push(await source('../src/features/html-video/HtmlVideoStoryboundPanels.tsx'));
    pages.push(await source('../src/components/Accordion.tsx'));
    pages.push(await source('../src/components/ConfirmDialog.tsx'));
    pages.push(await source('../src/components/CursorPagination.tsx'));
    pages.forEach((page) => {
      expect(page).not.toMatch(/<(?:button|input|select|textarea)\b/u);
      expect(page).not.toContain("from '@fluentui/react-components'");
    });
  });

  it('isolates native form chrome from Fluent slots', async () => {
    const [base, css, shared] = await Promise.all([
      source('../src/styles/base.css'), source('../src/styles.css'),
      source('../src/styles/storydream-ui.css'),
    ]);
    expect(base).toContain(":where(button, input, select, textarea):not([class*='fui-'])");
    expect(css).toContain(":where(input, select, textarea):not([class*='fui-'])");
    expect(css).toContain(".config-input > span:not([class*='fui-'])");
    expect(shared).not.toContain('color: #fff !important');
    expect(shared).not.toContain('.sd-segmented-control .fui-Tab::after');
  });

  it('routes shared shell actions through the StoryDream component layer', async () => {
    const shell = await source('../src/app/AppShell.tsx');
    const button = await source('../src/ui/Button.tsx');
    const shellStyles = await source('../src/styles/shell.css');

    expect(shell).toContain("from '../ui'");
    expect(shell).toContain('<Toolbar');
    expect(shell).toContain('<IconButton');
    expect(shell).toContain('<Button');
    expect(shell).not.toContain('<button');
    expect(button).toContain('className="sd-button__content"');
    expect(shellStyles).toContain('.new-task-button .sd-button__content,');
    expect(shellStyles).toContain('.nav-item .sd-button__content,');
    expect(shellStyles).toContain('.trial-activation-bar .sd-button__content,');
    expect(shellStyles).toContain('.credit-chip .sd-button__content,');
  });

  it('ships a project skill that prevents page-local component reinvention', async () => {
    const skill = await source('../.agents/skills/storydream-ui/SKILL.md');
    const metadata = await source('../.agents/skills/storydream-ui/agents/openai.yaml');

    expect(skill).toContain('name: storydream-ui');
    expect(skill).toContain('src/ui');
    expect(skill).toContain('Do not import `@fluentui/react-components` from feature pages');
    expect(skill).toContain('Do not add raw `<button>`, `<input>`, `<select>`, or `<dialog>`');
    expect(skill).toContain('normal desktop window and a compact desktop window');
    expect(metadata).toContain('$storydream-ui');
  });
});
