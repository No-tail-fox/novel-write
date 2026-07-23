import type { ReactNode } from 'react';
import { Bell, Coins, History, Info, KeyRound, Maximize2, Minus, Moon, Sun, X } from 'lucide-react';
import { AsyncActionFeedback as InlineActionFeedback } from '../components/AsyncActionFeedback';
import { taskStatusLabel as statusLabel } from '../components/StatusBadge';
import { taskProgressLabel } from '../shared/html-video-workflow';
import type { AsyncActionFeedback } from '../ui/async-action';
import type { RendererAppState as AppState } from './route-types';
import {
  navigationItemForView,
  newTaskPrimaryAction,
  pageSubtitle,
  primaryNavItems,
  secondaryNavItems,
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

  return (
    <main className="app-shell" aria-busy={busy} data-editorial-shell data-shell-view={activeView}>
      <div className="window-line">
        <div className="window-title">
          <div className="app-mark">S</div>
          <strong>StoryDream</strong>
        </div>
        <div className="window-controls" aria-label="窗体控制">
          <button className="window-control-button" type="button" aria-label="最小化" disabled={busy} onClick={minimizeWindow}>
            <Minus size={14} />
          </button>
          <button className="window-control-button" type="button" aria-label="最大化" disabled={busy} onClick={toggleMaximizeWindow}>
            <Maximize2 size={14} />
          </button>
          <button className="window-control-button close" type="button" aria-label="关闭" disabled={busy} onClick={closeWindow}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo">S</div>
            <div>
              <strong>StoryDream</strong>
              <span>v0.10.4 · beta</span>
            </div>
            <Bell size={16} className="brand-bell" />
          </div>

          <button
            className="new-task-button"
            aria-label={newTaskPrimaryAction.label}
            title={`${newTaskPrimaryAction.label} · ${newTaskPrimaryAction.hint}`}
            disabled={busy}
            onClick={() => navigate(newTaskPrimaryAction.view)}
            onMouseEnter={() => preloadRouteIntent(newTaskPrimaryAction.view)}
            onFocus={() => preloadRouteIntent(newTaskPrimaryAction.view)}
          >
            <NewTaskIcon size={16} />
            <span>{newTaskPrimaryAction.label}</span>
            <kbd>Ctrl+N</kbd>
          </button>

          <nav className="nav-list">
            <span className="nav-section-label">主线工作流</span>
            {primaryNavItems.map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} busy={busy} navigate={navigate} />
            ))}
            <span className="nav-section-label secondary">扩展工具</span>
            {secondaryNavItems.map((item) => (
              <NavButton key={item.view} item={item} active={activeView === item.view} busy={busy} navigate={navigate} />
            ))}
          </nav>

          <div className="sidebar-bottom">
            <button
              className="recent-task-compact"
              type="button"
              aria-label="最近任务"
              title="最近任务"
              disabled={busy}
              onClick={() => recentTasks[0] ? openTaskDetail(recentTasks[0].id) : navigate('history')}
            >
              <History size={16} />
            </button>
            <section className="recent-task-strip">
              <span className="nav-section-label">最近任务</span>
              {recentTasks.length === 0 ? <small>暂无任务</small> : null}
              {recentTasks.map((task) => (
                <button
                  key={task.id}
                  className="recent-task-item"
                  disabled={busy}
                  onClick={() => openTaskDetail(task.id)}
                  onMouseEnter={() => preloadRouteIntent('task-detail')}
                  onFocus={() => preloadRouteIntent('task-detail')}
                >
                  <strong>{task.title || '未命名任务'}</strong>
                  <span>{statusLabel(task.status)} · {taskProgressLabel(task)}</span>
                </button>
              ))}
            </section>
            <button
              className="trial-activation-bar"
              disabled={busy}
              onClick={() => navigate('activation')}
              onMouseEnter={() => preloadRouteIntent('activation')}
              onFocus={() => preloadRouteIntent('activation')}
            >
              <KeyRound size={15} />
              <span>试用剩余</span>
              <strong>{trialDaysLabel}</strong>
            </button>
            <div className="account-entry-grid">
              <button
                className="credit-chip"
                disabled={busy}
                onClick={() => navigate('account')}
                onMouseEnter={() => preloadRouteIntent('account')}
                onFocus={() => preloadRouteIntent('account')}
              >
                <Coins size={15} />
                <span className="credit-label">积分明细</span>
                <span className="credit-balance">{state.account.balance.toFixed(2)}</span>
              </button>
              <button
                className="feedback-link"
                disabled={busy}
                onClick={() => navigate('account')}
                onMouseEnter={() => preloadRouteIntent('account')}
                onFocus={() => preloadRouteIntent('account')}
              >
                <Info size={14} />
                账户中心
              </button>
            </div>
          </div>
        </aside>

        <section className="content">
          <header className="page-head">
            <div>
              <h1>{activeNav.label}</h1>
              <p>{pageSubtitle(activeView)}</p>
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
            <button className="theme-toggle" type="button" aria-label={themeLabel} title={themeLabel} disabled={busy} onClick={toggleTheme}>
              {state.ui.theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
            </button>
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
    <button
      className={active ? 'nav-item active' : 'nav-item'}
      data-nav-view={item.view}
      aria-label={item.label}
      title={`${item.label} · ${item.hint}`}
      disabled={busy}
      onClick={() => navigate(item.view)}
      onMouseEnter={() => preloadRouteIntent(item.view)}
      onFocus={() => preloadRouteIntent(item.view)}
    >
      <Icon size={16} />
      <span>{item.label}</span>
      <small>{item.hint}</small>
    </button>
  );
}

function preloadRouteIntent(view: ShellView): void {
  void preloadRoute(view).catch(() => undefined);
}
