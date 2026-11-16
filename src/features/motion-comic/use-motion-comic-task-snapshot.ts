import { useEffect, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';
import type { DirectorBatchRecord } from '../../shared/director-batch-persistence';

/** Read-only, project-scoped inspection. Opening tasks never submits or resumes work. */
export function useMotionComicTaskSnapshot(api: StoryDreamApi, projectId: string | undefined, open: boolean) {
  const [value, setValue] = useState<{ projectId?: string; scripts?: MotionComicScriptSnapshot; batches: DirectorBatchRecord[]; loading: boolean; error: string }>({ batches: [], loading: false, error: '' });
  useEffect(() => {
    if (!projectId || !open) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = projectId;
    async function poll() {
      setValue(previous => previous.projectId === id ? { ...previous, loading: !previous.scripts } : { projectId: id, batches: [], loading: true, error: '' });
      const results = await Promise.allSettled([api.getMotionComicScripts(id), api.listDirectorBatches({ projectId: id })]);
      if (disposed) return;
      setValue({ projectId: id, scripts: results[0].status === 'fulfilled' ? results[0].value : undefined,
        batches: results[1].status === 'fulfilled' ? results[1].value : [], loading: false,
        error: results.some(result => result.status === 'rejected') ? '部分任务状态暂时无法读取。下方仅展示已读取的记录，稍后自动重试。' : '' });
      timer = setTimeout(() => void poll(), 5000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, projectId, open]);
  return value.projectId === projectId ? value : { scripts: undefined, batches: [], loading: open, error: '' };
}
