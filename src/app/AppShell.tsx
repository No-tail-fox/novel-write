import type { ReactNode } from 'react';
import { Bell, Coins, History, Info, KeyRound, Maximize2, Minus, Moon, Sun, X } from 'lucide-react';
import { AsyncActionFeedback as InlineActionFeedback } from '../components/AsyncActionFeedback';
import { taskStatusLabel as statusLabel } from '../components/StatusBadge';
import { taskProgressLabel } from '../shared/html-video-workflow';
import type { AsyncActionFeedback } from '../ui/async-action';
import { Button, IconButton, Toolbar, Tooltip } from '../ui';
import type { RendererAppState as AppState } from './route-types';
import {
  navigationItemForView,
  newTaskPrimaryAction,
  pageSubtitle,
  sidebarNavGroups,
  type NavigationItem as NavItem,
} from './navigation';
import type { ShellView } from '../shared/types';
import { preloadRoute } from './route-registry';

export type SaveTone = 'saved' | 'saving' | 'dirty';

export function AppShell({
  activeView,
  state,
  saveTone,
  isBrowserPreview,
  busy,
  feedback,
  navigate,
  openTaskDetail,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
  toggleTheme,
  children,
}: {
  activeView: ShellView;
  state: AppState;
  saveTone: SaveTone;
  isBrowserPreview: boolean;
  busy: boolean;
  feedback: AsyncActionFeedback | null;
  navigate: (view: ShellView) => void;
  openTaskDetail: (taskId: string) => void;
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  toggleTheme: () => void;
  children: ReactNode;
}) {
  const recentTasks = state.tasks.slice(0, 3);
  const trialDaysLabel = state.activation.expiresAt
    ? `${Math.max(0, Math.ceil((new Date(state.activation.expiresAt).getTime() - Date.now()) / 86400000))} 天`
    : '本地试用';
  const activeNav = navigationItemForView(activeView);
  const NewTaskIcon = newTaskPrimaryAction.icon;
  const themeLabel = state.ui.theme === 'light' ? '切换深色主题' : '切换浅色主题';
  const taskOperationsView = activeView === 'queue' || activeView === 'history' || activeView === 'task-detail';

  return (
    <main className="app-shell" aria-busy={busy} data-editorial-shell data-shell-view={activeView}>
      <div className="window-line">
        <div className="window-title">
          <div className="app-mark">S</div>
          <strong>StoryDream</strong>
        </div>
        <Toolbar className="window-controls" aria-label="窗体控制" size="small">
          <Tooltip content="最小化">
            <IconButton className="window-control-button" variant="subtle" density="compact" label="最小化" icon={<Minus size={14} />} disabled={busy} onClick={minimizeWindow} />
          </Tooltip>
          <Tooltip content="最大化">
            <IconButton className="window-control-button" variant="subtle" density="compact" label="最大化" icon={<Maximize2 size={14} />} disabled={busy} onClick={toggleMaximizeWindow} />
          </Tooltip>
          <Tooltip content="关闭">
            <IconButton className="window-control-button close" variant="subtle" density="compact" label="关闭" icon={<X size={14} />} disabled={busy} onClick={closeWindow} />
          </Tooltip>
        </Toolbar>
      </div>

      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo">S</div>
            <div>
              <strong>StoryDream</strong>
              <span>V1.0.0</span>
            </div>
            <Bell size={16} className="brand-bell" />
          </div>

          <Button
            className="new-task-button"
            variant="primary"
            density="compact"
            icon={<NewTaskIcon size={16} />}
            type="button"
            data-nav-view={newTaskPrimaryAction.view}
            aria-label={newTaskPrimaryAction.label}
            title={`${newTaskPrimaryAction.label} · ${newTaskPrimaryAction.hint}`}
            disabled={busy}
            onClick={() => navigate(newTaskPrimaryAction.view)}
            onMouseEnter={() => preloadRouteIntent(newTaskPrimaryAction.view)}
            onFocus={() => preloadRouteIntent(newTaskPrimaryAction.view)}
          >
            <span>{newTaskPrimaryAction.label}</span>
            <kbd>Ctrl+N</kbd>
          </Button>

          <nav className="nav-list">
            {sidebarNavGroups.map((group) => (
              <div key={group.id} className="nav-group" role="group" aria-label={group.label}>
                <span className="nav-section-label">{group.label}</span>
                {group.items.map((item) => (
                  <NavButton key={item.view} item={item} active={activeView === item.view} busy={busy} navigate={navigate} />
                ))}
              </div>
            ))}
          </nav>

          <div className="sidebar-bottom">
            <IconButton
              className="recent-task-compact"
              variant="subtle"
              density="compact"
              label="最近任务"
              icon={<History size={16} />}
              disabled={busy}
              onClick={() => recentTasks[0] ? openTaskDetail(recentTasks[0].id) : navigate('history')}
            />
            <section className="recent-task-strip">
              <span className="nav-section-label">最近任务</span>
              {recentTasks.length === 0 ? <small>暂无任务</small> : null}
              {recentTasks.map((task) => (
                <Button
                  key={task.id}
                  className="recent-task-item"
                  variant="subtle"
                  density="compact"
                  type="button"
                  disabled={busy}
                  onClick={() => openTaskDetail(task.id)}
                  onMouseEnter={() => preloadRouteIntent('task-detail')}
                  onFocus={() => preloadRouteIntent('task-detail')}
                >
                  <strong>{task.title || '未命名任务'}</strong>
                  <span>{statusLabel(task.status)} · {taskProgressLabel(task)}</span>
                </Button>
              ))}
            </section>
            <Button
              className="trial-activation-bar"
              variant="secondary"
              density="compact"
              type="button"
              icon={<KeyRound size={15} />}
              disabled={busy}
              onClick={() => navigate('activation')}
              onMouseEnter={() => preloadRouteIntent('activation')}
              onFocus={() => preloadRouteIntent('activation')}
            >
              <span>试用剩余</span>
              <strong>{trialDaysLabel}</strong>
            </Button>
            <div className="account-entry-grid">
              <Button
                className="credit-chip"
                variant="secondary"
                density="compact"
                type="button"
                icon={<Coins size={15} />}
                disabled={busy}
                onClick={() => navigate('account')}
                onMouseEnter={() => preloadRouteIntent('account')}
                onFocus={() => preloadRouteIntent('account')}
              >
                <span className="credit-label">积分明细</span>
                <span className="credit-balance">{state.account.balance.toFixed(2)}</span>
              </Button>
              <Button
                className="feedback-link"
                variant="subtle"
                density="compact"
                type="button"
                icon={<Info size={14} />}
                disabled={busy}
                onClick={() => navigate('account')}
                onMouseEnter={() => preloadRouteIntent('account')}
                onFocus={() => preloadRouteIntent('account')}
              >
                账户中心
              </Button>
            </div>
          </div>
        </aside>

        <section className="content">
          <header className={taskOperationsView ? 'page-head task-operations-page-head' : 'page-head'}>
            <div>
              {taskOperationsView ? <span className="page-breadcrumb">StoryDream / 创作生产</span> : null}
              <h1>{activeNav.label}</h1>
              {taskOperationsView ? null : <p>{pageSubtitle(activeView)}</p>}
              {isBrowserPreview ? <span className="local-note">浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。</span> : null}
            </div>
            <div className="top-notice">
              <Info size={16} />
              <span>{state.config.jianying.draftPath ? `剪映草稿目录：${state.config.jianying.draftPath}` : '尚未配齐：剪映草稿目录'}</span>
            </div>
            <div className={`save-state ${saveTone}`}>
              <span />
              {saveTone === 'saving' ? '保存中' : saveTone === 'dirty' ? '有未保存改动' : '所有改动已保存'}
            </div>
            <Tooltip content={themeLabel}>
              <IconButton
                className="theme-toggle"
                variant="subtle"
                density="compact"
                label={themeLabel}
                icon={state.ui.theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
                disabled={busy}
                onClick={toggleTheme}
              />
            </Tooltip>
          </header>
          {feedback ? (
            <div className="global-action-banner">
              <InlineActionFeedback feedback={feedback} />
            </div>
          ) : null}
          {children}
        </section>
      </div>
    </main>
  );
}

function NavButton({ item, active, busy, navigate }: { item: NavItem; active: boolean; busy: boolean; navigate: (view: ShellView) => void }) {
  const Icon = item.icon;
  return (
    <Button
      className={active ? 'nav-item active' : 'nav-item'}
      variant="subtle"
      density="compact"
      type="button"
      icon={<Icon size={16} />}
      data-nav-view={item.view}
      aria-label={item.label}
      title={`${item.label} · ${item.hint}`}
      disabled={busy}
      onClick={() => navigate(item.view)}
      onMouseEnter={() => preloadRouteIntent(item.view)}
      onFocus={() => preloadRouteIntent(item.view)}
    >
      <span>{item.label}</span>
      <small>{item.hint}</small>
    </Button>
  );
}

function preloadRouteIntent(view: ShellView): void {
  void preloadRoute(view).catch(() => undefined);
}
