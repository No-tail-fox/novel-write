import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { primaryNavGroups, secondaryNavigationItems } from '../src/app/navigation';
import { storyDreamDarkTheme, storyDreamLightTheme } from '../src/ui/theme';

describe('shared page visual contract', () => {
  it('preserves every route while removing redundant secondary entries', () => {
    for (const group of primaryNavGroups) {
      const secondary = secondaryNavigationItems(group);
      expect(new Set([group.defaultView, ...secondary.map((item) => item.view)]))
        .toEqual(new Set(group.items.map((item) => item.view)));
    }
    expect(secondaryNavigationItems(primaryNavGroups[0]).map((item) => item.view))
      .toEqual(['editorial-collage', 'motion-comic', 'html-video', 'music-mv']);
    expect(secondaryNavigationItems(primaryNavGroups.at(-1)!)).toEqual([]);
    const assetGroup = primaryNavGroups.find((group) => group.id === 'assets')!;
    expect(secondaryNavigationItems(assetGroup).map(({ view, label }) => [view, label])).toEqual([
      ['copy-studio', '文案创作'], ['conversation-workbench', '对话工作台'],
      ['image-lab', '图片生成'], ['voice-lab', '配音生成'],
      ['video-lab', '视频生成'], ['music-lab', '音乐创作'],
    ]);
    for (const group of primaryNavGroups) {
      const secondaryViews = secondaryNavigationItems(group).map((item) => item.view);
      expect(new Set(secondaryViews).size).toBe(secondaryViews.length);
    }
  });

  it('uses the same coral family for Fluent selection, controls and text', () => {
    for (const theme of [storyDreamDarkTheme, storyDreamLightTheme]) {
      expect(theme.colorCompoundBrandStroke).toBe(theme.colorBrandBackground);
      expect(theme.colorCompoundBrandBackground).toBe(theme.colorBrandBackground);
      expect(theme.colorCompoundBrandForeground1).toBe(theme.colorBrandForeground1);
      expect(theme.fontFamilyBase).toBe('var(--sd-font-ui)');
      expect(theme.fontFamilyNumeric).toBe(theme.fontFamilyBase);
    }
  });

  it('names icon-only layout modes and keeps text mode as the default', async () => {
    const control = await source('../src/ui/SegmentedControl.tsx');
    expect(control).toContain('iconOnly = false');
    expect(control).toContain('aria-label={option.label}');
    expect(control).toContain('<Tooltip key={option.value} content={option.label}>');
    expect(control).toContain('disabled={option.disabled}');
  });

  it('bounds rail account actions and keeps page forms unframed', async () => {
    const css = await source('../src/styles/redesign.css');
    expect(css).toContain('grid-template-rows: auto auto;');
    expect(css).toContain('height: 40px;');
    expect(css).toContain('.settings-content > .config-card');
    expect(css).toContain('border-radius: 0;');
    const shell = await source('../src/app/AppShell.tsx');
    expect(shell).toContain('secondaryNavigationItems(activePrimaryGroup)');
    expect(shell).toContain('data-nav-level={level}');
    expect(shell).toContain('aria-current={current ?');
  });

  it('shares the settings section state between desktop and narrow navigation', async () => {
    const page = await source('../src/features/settings/SettingsPage.tsx');
    const ast = ts.createSourceFile('SettingsPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const controls = new Map<string, Map<string, string>>();
    function visit(node: ts.Node) {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const tag = node.tagName.getText(ast);
        const props = new Map(node.attributes.properties.filter(ts.isJsxAttribute)
          .map((prop) => [prop.name.getText(ast), prop.initializer?.getText(ast).replace(/\s+/gu, '') ?? '']));
        if (tag === 'SelectField' && props.get('fieldClassName') === '"settings-section-select"'
          || tag === 'Tabs' && props.get('className') === '"settings-navigation"') controls.set(tag, props);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect([...controls.keys()].sort()).toEqual(['SelectField', 'Tabs']);
    for (const props of controls.values()) expect(props.get('value')).toBe('{section}');
    expect(controls.get('SelectField')?.get('onChange')).toBe('{(event)=>setSection(event.target.valueasSettingsSection)}');
    expect(controls.get('Tabs')?.get('onChange')).toBe('{(value)=>setSection(valueasSettingsSection)}');
    expect(controls.get('SelectField')?.get('options')).toMatch(/^\{sections\.map\(/u);
    expect(controls.get('Tabs')?.get('items')).toMatch(/^\{sections\.map\(/u);
  });
});

function source(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
