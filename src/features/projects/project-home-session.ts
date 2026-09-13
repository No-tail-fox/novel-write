import type { HistoryArchiveFilter, TaskSummary } from '../../shared/types';
import type { HistoryPageRequestController } from '../history/use-history-page';

export type ProjectTaskType = 'all' | 'story' | 'music-mv' | 'html-video' | 'editorial-collage' | 'motion-comic';
export type ProjectLayout = 'grid' | 'list';

export interface ProjectHomeView {
  archiveFilter: HistoryArchiveFilter;
  taskType: ProjectTaskType;
  favoriteFilter: 'all' | 'favorites';
  query: string;
  layout: ProjectLayout;
}

export interface ProjectHomeSession {
  view: ProjectHomeView;
  controller?: HistoryPageRequestController<'task', TaskSummary>;
}

export function createProjectHomeSession(): ProjectHomeSession {
  return {
    view: { archiveFilter: 'active', taskType: 'all', favoriteFilter: 'all', query: '', layout: 'grid' },
  };
}
