import { lazy } from 'react';
import type { ShellView } from '../shared/types';

const loadProjectHomePage = () => import('../features/projects/ProjectHomePage').then((module) => ({ default: module.ProjectHomePage }));
const loadNewTaskPage = () => import('../features/tasks/NewTaskPage').then((module) => ({ default: module.NewTaskPage }));
const loadHotBoardPage = () => import('../features/hotboard/HotBoardPage').then((module) => ({ default: module.HotBoardPage }));
const loadQueuePage = () => import('../features/tasks/QueuePage').then((module) => ({ default: module.QueuePage }));
const loadHistoryPage = () => import('../features/tasks/HistoryPage').then((module) => ({ default: module.HistoryPage }));
const loadTaskDetailPage = () => import('../features/tasks/TaskDetailPage').then((module) => ({ default: module.TaskDetailPage }));
const loadEditorialCollagePage = () => import('../features/editorial-collage/EditorialCollagePage').then((module) => ({ default: module.EditorialCollagePage }));
const loadMotionComicPage = () => import('../features/motion-comic/MotionComicPage').then((module) => ({ default: module.MotionComicPage }));
const loadHtmlVideoPage = () => import('../features/html-video/HtmlVideoPage').then((module) => ({ default: module.HtmlVideoPage }));
const loadImageLabPage = () => import('../features/labs/ImageLabPage').then((module) => ({ default: module.ImageLabPage }));
const loadVoiceLabPage = () => import('../features/labs/VoiceLabPage').then((module) => ({ default: module.VoiceLabPage }));
const loadMusicMvPage = () => import('../features/music-mv/MusicMvPage').then((module) => ({ default: module.MusicMvPage }));
const loadBookSelectionPage = () => import('../features/labs/BookSelectionPage').then((module) => ({ default: module.BookSelectionPage }));
const loadBenchmarkImportPage = () => import('../features/labs/BenchmarkImportPage').then((module) => ({ default: module.BenchmarkImportPage }));
const loadPersonAssetsPage = () => import('../features/labs/PersonAssetsPage').then((module) => ({ default: module.PersonAssetsPage }));
const loadViralAnalyzerPage = () => import('../features/viral/ViralAnalyzerPage').then((module) => ({ default: module.ViralAnalyzerPage }));
const loadPromptTemplatesPage = () => import('../features/templates/PromptTemplatesPage').then((module) => ({ default: module.PromptTemplatesPage }));
const loadDraftTemplatesPage = () => import('../features/templates/DraftTemplatesPage').then((module) => ({ default: module.DraftTemplatesPage }));
const loadSettingsPage = () => import('../features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage }));
const loadAccountPage = () => import('../features/account/AccountPage').then((module) => ({ default: module.AccountPage }));
const loadActivationPage = () => import('../features/account/ActivationPage').then((module) => ({ default: module.ActivationPage }));

export const routeLoaders = {
  'projects': loadProjectHomePage,
  'new-task': loadNewTaskPage,
  'hot-board': loadHotBoardPage,
  'queue': loadQueuePage,
  'history': loadHistoryPage,
  'task-detail': loadTaskDetailPage,
  'editorial-collage': loadEditorialCollagePage,
  'motion-comic': loadMotionComicPage,
  'html-video': loadHtmlVideoPage,
  'image-lab': loadImageLabPage,
  'voice-lab': loadVoiceLabPage,
  'music-mv': loadMusicMvPage,
  'book-selection': loadBookSelectionPage,
  'benchmark': loadBenchmarkImportPage,
  'person-assets': loadPersonAssetsPage,
  'viral-analyzer': loadViralAnalyzerPage,
  'prompt-templates': loadPromptTemplatesPage,
  'draft-templates': loadDraftTemplatesPage,
  'settings': loadSettingsPage,
  'account': loadAccountPage,
  'activation': loadActivationPage,
} as const satisfies Record<ShellView, () => Promise<unknown>>;

export const routeComponents = {
  'projects': lazy(routeLoaders['projects']),
  'new-task': lazy(routeLoaders['new-task']),
  'hot-board': lazy(routeLoaders['hot-board']),
  'queue': lazy(routeLoaders['queue']),
  'history': lazy(routeLoaders['history']),
  'task-detail': lazy(routeLoaders['task-detail']),
  'editorial-collage': lazy(routeLoaders['editorial-collage']),
  'motion-comic': lazy(routeLoaders['motion-comic']),
  'html-video': lazy(routeLoaders['html-video']),
  'image-lab': lazy(routeLoaders['image-lab']),
  'voice-lab': lazy(routeLoaders['voice-lab']),
  'music-mv': lazy(routeLoaders['music-mv']),
  'book-selection': lazy(routeLoaders['book-selection']),
  'benchmark': lazy(routeLoaders['benchmark']),
  'person-assets': lazy(routeLoaders['person-assets']),
  'viral-analyzer': lazy(routeLoaders['viral-analyzer']),
  'prompt-templates': lazy(routeLoaders['prompt-templates']),
  'draft-templates': lazy(routeLoaders['draft-templates']),
  'settings': lazy(routeLoaders['settings']),
  'account': lazy(routeLoaders['account']),
  'activation': lazy(routeLoaders['activation']),
} as const satisfies Record<ShellView, unknown>;

export async function preloadRoute(view: ShellView): Promise<void> {
  await routeLoaders[view]();
}
