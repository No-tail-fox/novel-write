import { Component, type ErrorInfo, type ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { revealThemedApplication } from '../features/settings/theme-controller';

interface ApplicationErrorBoundaryProps {
  children: ReactNode;
}

interface ApplicationErrorBoundaryState {
  error: Error | null;
}

export class ApplicationErrorBoundary extends Component<ApplicationErrorBoundaryProps, ApplicationErrorBoundaryState> {
  state: ApplicationErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ApplicationErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    revealThemedApplication();
    console.error('Application render failed.', error, info.componentStack);
  }

  private reloadApplication = () => {
    window.location.reload();
  };

  private returnToNewTask = () => {
    const api = window.storydream ?? window.storybound;
    void Promise.resolve(api?.saveUiPreferences({ activeView: 'new-task' }))
      .catch(() => undefined)
      .finally(this.reloadApplication);
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="application-error-state" role="alert">
        <CircleAlert size={24} aria-hidden="true" />
        <h1>应用显示异常</h1>
        <p>界面渲染已中断，当前数据不会被修改。请重新加载应用继续操作。</p>
        <div className="button-row">
          <button className="primary-action slim" type="button" onClick={this.reloadApplication}>重新加载应用</button>
          <button className="secondary-action slim" type="button" onClick={this.returnToNewTask}>返回新建任务</button>
        </div>
      </main>
    );
  }
}
