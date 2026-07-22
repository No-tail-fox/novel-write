import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { ShellView } from '../shared/types';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  resetKey: ShellView;
  onNavigate: (view: ShellView) => void;
}

interface RouteErrorBoundaryState {
  error: Error | null;
  resetKey: ShellView;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(
    props: RouteErrorBoundaryProps,
    state: RouteErrorBoundaryState,
  ): RouteErrorBoundaryState | null {
    if (props.resetKey === state.resetKey) return null;
    return { error: null, resetKey: props.resetKey };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route render failed.', error, info.componentStack);
  }

  private returnToNewTask = () => {
    this.setState({ error: null }, () => this.props.onNavigate('new-task'));
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel full-panel route-error-state" role="alert">
        <h2>页面加载失败</h2>
        <p>{this.state.error.message || '当前页面无法显示。'}</p>
        <div className="button-row">
          <button className="primary-action slim" type="button" onClick={() => this.setState({ error: null })}>重新加载页面</button>
          <button className="secondary-action slim" type="button" onClick={this.returnToNewTask}>返回新建任务</button>
        </div>
      </section>
    );
  }
}
