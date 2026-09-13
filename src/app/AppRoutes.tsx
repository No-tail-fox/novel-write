import { Suspense, useState } from 'react';
import type { StoryDreamApi } from '../shared/storydream-api';
import type { HistoryFamily, ShellView, Task, ThemeName } from '../shared/types';
import { RouteLoadingState } from './RouteLoadingState';
import { routeComponents } from './route-registry';
import type { ApplyMutationResult, RendererAppState as AppState } from './route-types';
import type { SettingsSection } from '../features/settings/SettingsPage';
import { createProjectHomeSession } from '../features/projects/project-home-session';

const {
  'projects': ProjectHomePage,
  'new-task': NewTaskPage,
  'hot-board': HotBoardPage,
  'queue': QueuePage,
  'history': HistoryPage,
  'task-detail': TaskDetailPage,
  'editorial-collage': EditorialCollagePage,
  'motion-comic': MotionComicPage,
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
  synchronizeThemeState,
  navigate,
  openSettings,
  initialSettingsSection,
  settingsReturnView,
  returnFromSettings,
  openTaskDetail,
  taskDetailReturnView,
  isHistoryTombstoned,
  historyFamilyEpochs,
  refreshTaskDetail,
  requestedEditorialCollageTaskId,
  requestedMotionComicTaskId,
  requestedHtmlTaskId,
  onRequestedEditorialCollageTaskHandled,
  onRequestedMotionComicTaskHandled,
  onRequestedHtmlTaskHandled,
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
  synchronizeThemeState: (expectedTheme: ThemeName, nextTheme: ThemeName) => boolean;
  navigate: (view: ShellView) => void;
  openSettings: (section: SettingsSection, returnView: ShellView, taskId?: string) => void;
  initialSettingsSection?: SettingsSection;
  settingsReturnView?: ShellView;
  returnFromSettings: () => void;
  openTaskDetail: (taskId: string, returnView?: ShellView) => void;
  taskDetailReturnView: ShellView;
  isHistoryTombstoned: (family: HistoryFamily, id: string) => boolean;
  historyFamilyEpochs: Partial<Record<HistoryFamily, number>>;
  refreshTaskDetail: (taskId: string) => Promise<void>;
  requestedEditorialCollageTaskId: string;
  requestedMotionComicTaskId: string;
  requestedHtmlTaskId: string;
  onRequestedEditorialCollageTaskHandled: (taskId: string) => void;
  onRequestedMotionComicTaskHandled: (taskId: string) => void;
  onRequestedHtmlTaskHandled: (taskId: string) => void;
  onActiveHtmlTaskChange: (taskId: string) => void;
  refreshViralEvents: (analysisId: string) => Promise<void>;
  onActiveViralAnalysisChange: (analysisId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [projectHomeSession] = useState(createProjectHomeSession);
  return (
    <Suspense fallback={<RouteLoadingState />}>
      {activeView === 'projects' ? (
        <ProjectHomePage
          session={projectHomeSession}
          api={api}
          applyState={applyState}
          openTaskDetail={(taskId) => openTaskDetail(taskId, 'projects')}
          navigate={navigate}
          isTombstoned={isHistoryTombstoned}
          familyEpochs={historyFamilyEpochs}
        />
      ) : null}
      {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} navigate={navigate} /> : null}
      {activeView === 'hot-board' ? <HotBoardPage api={api} navigate={navigate} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'book-selection' ? <BookSelectionPage api={api} navigate={navigate} /> : null}
      {activeView === 'benchmark' ? <BenchmarkImportPage api={api} applyState={applyState} openTaskDetail={openTaskDetail} navigate={navigate} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'person-assets' ? <PersonAssetsPage api={api} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'history' ? (
        <HistoryPage
          api={api}
          applyState={applyState}
          openTaskDetail={openTaskDetail}
          isTombstoned={isHistoryTombstoned}
          familyEpochs={historyFamilyEpochs}
        />
      ) : null}
      {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} returnView={taskDetailReturnView} close={() => navigate(taskDetailReturnView)} openTemplateManager={() => navigate('draft-templates')} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'voice-lab' ? <VoiceLabPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'music-mv' ? <MusicMvPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'editorial-collage' ? <EditorialCollagePage api={api} state={state} applyState={applyState} requestedTaskId={requestedEditorialCollageTaskId} onRequestedTaskHandled={onRequestedEditorialCollageTaskHandled} navigate={navigate} openSettings={openSettings} returnView={taskDetailReturnView} /> : null}
      {activeView === 'motion-comic' ? <MotionComicPage api={api} state={state} applyState={applyState} requestedTaskId={requestedMotionComicTaskId} onRequestedTaskHandled={onRequestedMotionComicTaskHandled} navigate={navigate} openSettings={openSettings} returnView={taskDetailReturnView} /> : null}
      {activeView === 'html-video' ? <HtmlVideoPage api={api} state={state} applyState={applyState} refreshTaskDetail={refreshTaskDetail} requestedTaskId={requestedHtmlTaskId} onRequestedTaskHandled={onRequestedHtmlTaskHandled} onActiveTaskChange={onActiveHtmlTaskChange} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'viral-analyzer' ? <ViralAnalyzerPage api={api} state={state} applyState={applyState} refreshViralEvents={refreshViralEvents} onActiveAnalysisChange={onActiveViralAnalysisChange} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
      {activeView === 'prompt-templates' ? <PromptTemplatesPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'draft-templates' ? <DraftTemplatesPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'settings' ? <SettingsPage api={api} state={state} applyState={applyState} synchronizeThemeState={synchronizeThemeState} navigate={navigate} initialSection={initialSettingsSection} returnView={settingsReturnView} onReturn={returnFromSettings} /> : null}
      {activeView === 'account' ? <AccountPage api={api} state={state} applyState={applyState} /> : null}
      {activeView === 'activation' ? <ActivationPage api={api} state={state} applyState={applyState} /> : null}
    </Suspense>
  );
}
