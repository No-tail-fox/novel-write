import { Loader2 } from 'lucide-react';

export function RouteLoadingState({ label = '正在加载页面' }: { label?: string }) {
  return (
    <section className="panel full-panel route-loading-state" role="status" aria-live="polite" aria-busy="true">
      <Loader2 className="spin" size={20} />
      <h2>正在加载</h2>
      <p>{label}</p>
    </section>
  );
}
