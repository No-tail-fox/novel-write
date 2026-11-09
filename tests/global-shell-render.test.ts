import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/app/AppShell';
import { initialState } from '../src/app/app-state';
import { productionNavItems } from '../src/app/navigation';
import { StoryDreamProvider } from '../src/ui';
import { version } from '../package.json';

function renderShell(overrides: Partial<ComponentProps<typeof AppShell>> = {}) {
  const props: ComponentProps<typeof AppShell> = {
    activeView: 'editorial-collage', returnView: 'projects', state: initialState,
    saveTone: 'saved', isBrowserPreview: true, busy: false, feedback: null,
    navigate: vi.fn(), openTaskDetail: vi.fn(), minimizeWindow: vi.fn(),
    toggleMaximizeWindow: vi.fn(), closeWindow: vi.fn(), toggleTheme: vi.fn(),
    updateStatus: null, updateBusy: false, updateAction: null,
    openAnnouncements: vi.fn(), checkForUpdate: vi.fn(), downloadUpdate: vi.fn(),
    installUpdate: vi.fn(), children: null, ...overrides,
  };
  const html = renderToStaticMarkup(createElement(StoryDreamProvider, {
    theme: props.state.ui.theme, children: createElement(AppShell, props),
  }));
  return { html, buttons: html.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [], props };
}

// Render real controls, not just declarations: the route and label must reach the accessible button.
describe('global shell rendered behavior', () => {
  it.each(['light', 'dark'] as const)('renders accessible production navigation in %s mode', (theme) => {
    const { html, buttons, props } = renderShell({ state: { ...initialState, ui: { ...initialState.ui, theme } } });
    expect(html).toContain(`<span class="window-version">V${version}</span>`);
    for (const { view, label } of productionNavItems) {
      const matches = buttons.filter((button) => button.includes(`data-nav-view="${view}"`));
      expect(matches).toHaveLength(1);
      expect(matches[0]).toContain(`aria-label="${label}"`);
      expect(matches[0].includes('aria-current="page"')).toBe(view === 'editorial-collage');
    }
    expect(buttons.filter((button) => button.includes('data-nav-view="new-task"'))).toHaveLength(1);
    const themeButton = buttons.find((button) => button.includes(`aria-label="切换${theme === 'light' ? '深' : '浅'}色主题"`));
    expect(themeButton).toBeDefined();
    expect(themeButton).not.toContain('disabled');
    expect(props.navigate).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'inactive', expiresAt: null, label: '未激活' },
    { status: 'active', expiresAt: null, label: '有效' },
    { status: 'active', expiresAt: new Date(Date.now() + 10 * 86400000).toISOString(), label: '10 天' },
  ] as const)('renders a reachable license action for $status / $label', ({ status, expiresAt, label }) => {
    const { buttons } = renderShell({ state: { ...initialState, activation: { ...initialState.activation, status, expiresAt } } });
    const actions = buttons.filter((button) => button.includes('data-nav-view="activation"'));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain(`aria-label="软件授权 ${label}"`);
    expect(actions[0]).toContain(`<strong>${label}</strong>`);
    expect(actions[0]).not.toContain('disabled');
  });

  it('disables route actions while busy without removing destinations', () => {
    const { buttons } = renderShell({ busy: true });
    const actions = buttons.filter((button) => button.includes('data-nav-view='));
    expect(actions.length).toBeGreaterThan(productionNavItems.length);
    for (const button of actions) expect(button).toMatch(/<button[^>]*\sdisabled=""/u);
    expect(actions.filter((button) => button.includes('data-nav-view="account"'))).toHaveLength(2);
  });
});
