import { useEffect, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { Task } from '../../shared/types';
import { normalizeTaskOutputTargets, TASK_OUTPUT_LABELS } from '../../shared/task-output';

export function TaskDeliverablePanel({ task, api }: { task: Task; api: StoryDreamApi }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const output = task.deliverables?.mp4;
  const path = output?.status === 'completed' ? output.path : undefined;
  useEffect(() => {
    let active = true;
    setUrl(''); setError('');
    if (path) void api.getTaskMediaUrl(task.id, path).then(value => { if (active) setUrl(value); }, cause => { if (active) setError(String(cause)); });
    return () => { active = false; };
  }, [api, task.id, path, output?.updatedAt]);
  if (!task.outputTargets) return null;
  const labels = { pending: '等待生成', running: '生成中', completed: '已完成', failed: '失败，可重试' };
  return <section className="task-output-deliverables" aria-label="交付物" aria-live="polite">
    {normalizeTaskOutputTargets(task.outputTargets).map(target => {
      const delivery = task.deliverables?.[target];
      return <div key={target} data-output-target={target} data-output-status={delivery?.status ?? 'pending'}>
        <strong>{TASK_OUTPUT_LABELS[target]}</strong><span> · {labels[delivery?.status ?? 'pending']}</span>
        {delivery?.error ? <p role="alert">{delivery.error}</p> : null}
      </div>;
    })}
    {error ? <p role="alert">成片预览加载失败：{error}</p> : null}
    {url ? <video key={url} className="task-output-video" src={url} controls playsInline preload="metadata" aria-label="短片 MP4 成片预览" /> : null}
  </section>;
}