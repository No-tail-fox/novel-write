import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectHomePage, type ProjectFilterRequest, type ProjectFilterSession } from '../src/features/projects/ProjectHomePage';
import { createProjectHomeSession } from '../src/features/projects/project-home-session';
import { defaultConfig } from '../src/shared/config';
import type { StoryDreamApi } from '../src/shared/storydream-api';

const session: ProjectFilterSession = createProjectHomeSession();
session.view = { archiveFilter: 'archived', taskType: 'all', favoriteFilter: 'favorites', query: 'kept', layout: 'list' };
const requests: any[] = [];
const pending: Array<(value: any) => void> = [];
const api = { listTasks: (request: any) => { requests.push(request); return new Promise((resolve) => pending.push(resolve)); } } as unknown as StoryDreamApi;
const isTombstoned = () => false;
function Harness() {
  const [filter, setFilter] = useState<ProjectFilterRequest>({ taskType: 'motion-comic', revision: 1 });
  const [mounted, setMounted] = useState(true);
  (window as any).entryQA = {
    requests, session,
    request: (taskType: ProjectFilterRequest['taskType']) => setFilter(current => ({ taskType, revision: current.revision + 1 })),
    mount: setMounted,
    resolve: (index: number, count: number) => pending[index]({ family: 'task', items: [], totalCount: count, nextCursor: null }),
  };
  return mounted ? <ProjectHomePage session={session} projectFilterRequest={filter} config={defaultConfig} api={api} applyState={() => {}} openTaskDetail={() => {}} navigate={() => {}} isTombstoned={isTombstoned} familyEpochs={{}} /> : null;
}
createRoot(document.getElementById('root')!).render(<Harness />);
