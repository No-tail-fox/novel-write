import { readFile } from 'node:fs/promises';
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
    expect(secondaryNavigationItems(primaryNavGroups[1])[0].label).toBe('画图实验室');
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
    expect(page).toContain('fieldClassName="settings-section-select"');
    expect(page).toContain('value={section}');
    expect(page).toContain('setSection(event.target.value as SettingsSection)');
    expect(page).toContain('onClick={() => setSection(id)}');
  });
});

function source(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}
