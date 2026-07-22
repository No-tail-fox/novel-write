import { Suspense } from 'react';
import type { StoryDreamApi } from '../shared/storydream-api';
import type { HistoryFamily, ShellView, Task } from '../shared/types';
import { RouteLoadingState } from './RouteLoadingState';
import { routeComponents } from './route-registry';
import type { ApplyMutationResult, RendererAppState as AppState } from './route-types';

const {
  'new-task': NewTaskPage,
  'queue': QueuePage,
  'history': HistoryPage,
  'task-detail': TaskDetailPage,
  'html-video': HtmlVideoPage,
  'image-lab': ImageLabPage,
  'voice-lab': VoiceLabPage,
  'music-mv': MusicMvPage,
  'book-selection': BookSelectionPage,
  'benchmark': BenchmarkImportPage,
  'person-assets': PersonAssetsPage,
  'viral-analyzer': ViralAnalyzerPage,
  'prompt-templates': PromptTemplatesPage,
  'draft-templates': DraftTemplatesPage,
  'settings': SettingsPage,
  'account': AccountPage,
  'activation': ActivationPage,
} = routeComponents;

export function AppRoutes({
  activeView,
  api,
  state,
  selectedTask,
  applyState,
  navigate,
  openTaskDetail,
  isHistoryTombstoned,
  historyFamilyEpoch,
  refreshTaskDetail,
  onActiveHtmlTaskChange,
  refreshViralEvents,
  onActiveViralAnalysisChange,
  isBrowserPreview,
}: {
  activeView: ShellView;
  api: StoryDreamApi;
  state: AppState;
  selectedTask: Task | null;
  applyState: ApplyMutationResult;
  navigate: (view: ShellView) => void;
  openTaskDetail: (taskId: string) => void;
  isHistoryTombstoned: (family: HistoryFamily, id: string) => boolean;
  historyFamilyEpoch: number;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  onActiveHtmlTaskChange: (taskId: string) => void;
  refreshViralEvents: (analysisId: string) => Promise<void>;
  onActiveViralAnalysisChange: (analysisId: string) => void;
  isBrowserPreview: boolean;
}) {
  return (
    <Suspense fallback={<RouteLoadingState />}>
      {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'book-selection' ? <BookSelectionPage api={api} navigate={navigate} /> : null}
      {activeView === 'benchmark' ? <BenchmarkImportPage api={api} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'person-assets' ? <PersonAssetsPage api={api} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'history' ? (
        <HistoryPage
          api={api}
          openTaskDetail={openTaskDetail}
          isTombstoned={isHistoryTombstoned}
          familyEpoch={historyFamilyEpoch}
        />
      ) : null}
      {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} close={() => navigate('history')} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'voice-lab' ? <VoiceLabPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'music-mv' ? <MusicMvPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'html-video' ? <HtmlVideoPage api={api} state={state} applyState={applyState} refreshTaskDetail={refreshTaskDetail} onActiveTaskChange={onActiveHtmlTaskChange} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'viral-analyzer' ? <ViralAnalyzerPage api={api} state={state} applyState={applyState} refreshViralEvents={refreshViralEvents} onActiveAnalysisChange={onActiveViralAnalysisChange} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'prompt-templates' ? <PromptTemplatesPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'draft-templates' ? <DraftTemplatesPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'settings' ? <SettingsPage api={api} state={state} applyState={applyState} navigate={navigate} /> : null}
      {activeView === 'account' ? <AccountPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'activation' ? <ActivationPage api={api} state={state} applyState={applyState} /> : null}
    </Suspense>
  );
}
