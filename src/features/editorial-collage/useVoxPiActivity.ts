import { useEffect, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { VoxProductionRun } from '../../shared/vox-production';
import type { PiLiveActivity } from '../../shared/creative-animation/pi-activity';

const POLL_MS = 1200;
export function useVoxPiActivity(api: Pick<StoryDreamApi, 'getVoxPiActivity'>, projectId: string | undefined, run: VoxProductionRun | undefined) {
  const runId = run?.authoringVersion === 4 ? run.id : '';
  const key = projectId && runId ? `${projectId}\0${runId}` : '';
  const running = run?.status === 'running';
  const [state, setState] = useState<{ key: string; activity: PiLiveActivity | null }>({ key: '', activity: null });
  useEffect(() => {
    if (!key || !projectId) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const activity = await api.getVoxPiActivity({ id: projectId, runId });
        if (!cancelled) setState({ key, activity });
      } catch {
        if (!cancelled) setState(previous => ({ key, activity: previous.key === key ? previous.activity : null }));
      }
      if (!cancelled && running) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [api, key, projectId, runId, running, run?.status]);
  return state.key === key ? state.activity : null;
}
