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
    expect(theme).toContain('#cf3f2d');
    expect(app).toContain('<StoryDreamProvider theme={state.ui.theme}>');
  });

  it('keeps zero-valued slider labels visible', async () => {
    const slider = await source('../src/ui/SliderField.tsx');

    expect(slider).toContain('valueLabel !== undefined');
  });

  it('exports the first 15 project-owned core components', async () => {
    const index = await source('../src/ui/index.ts');
    const expectedExports = [
      'Button',
      'IconButton',
      'TextField',
      'TextAreaField',
      'SelectField',
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
    ];

    for (const component of expectedExports) {
      expect(index).toContain(`export { ${component} }`);
    }
    expect((index.match(/^export \{ /gmu) ?? []).length).toBe(expectedExports.length + 1);
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
