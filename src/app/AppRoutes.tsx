import { AccountPage } from '../features/account/AccountPage';
import { ActivationPage } from '../features/account/ActivationPage';
import { BenchmarkImportPage } from '../features/labs/BenchmarkImportPage';
import { BookSelectionPage } from '../features/labs/BookSelectionPage';
import { ImageLabPage } from '../features/labs/ImageLabPage';
import { PersonAssetsPage } from '../features/labs/PersonAssetsPage';
import { VoiceLabPage } from '../features/labs/VoiceLabPage';
import { HtmlVideoPage } from '../features/html-video/HtmlVideoPage';
import { MusicMvPage } from '../features/music-mv/MusicMvPage';
import { DraftTemplatesPage } from '../features/templates/DraftTemplatesPage';
import { PromptTemplatesPage } from '../features/templates/PromptTemplatesPage';
import { HistoryPage } from '../features/tasks/HistoryPage';
import { NewTaskPage } from '../features/tasks/NewTaskPage';
import { QueuePage } from '../features/tasks/QueuePage';
import { TaskDetailPage } from '../features/tasks/TaskDetailPage';
import { ViralAnalyzerPage } from '../features/viral/ViralAnalyzerPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import type { StoryDreamApi } from '../shared/storydream-api';
import type { HistoryFamily, ShellView, Task } from '../shared/types';
import type { ApplyMutationResult, RendererAppState as AppState } from './route-types';

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
    <>
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
    </>
  );
}
