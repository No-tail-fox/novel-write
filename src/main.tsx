import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Bell,
  Bot,
  Circle,
  Coins,
  Copy,
  Database,
  FileJson,
  FlaskConical,
  FolderOpen,
  History,
  Image as ImageIcon,
  Info,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Maximize2,
  Mic2,
  Minus,
  Palette,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings,
  Sparkles,
  Upload,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AccountProfile,
  ActivationState,
  AiSourceContext,
  AiSourceSection,
  AppConfig,
  AppState,
  ConfigTestTarget,
  CreateTaskInput,
  DraftTemplate,
  ImageLabGenerateInput,
  ImageProviderProfile,
  ImageLabRecord,
  BgmItem,
  JianyingEffectCatalog,
  PausePoint,
  PromptTemplate,
  PromptTemplateType,
  ProviderModel,
  RewriteIntensity,
  ShellView,
  Task,
  TaskArtifactSnapshot,
  TaskEvent,
  TaskMode,
  TaskStatus,
  TtsProviderProfile,
  UiPreferences,
  VolcengineSpeaker,
} from './shared/types';
import { configTargetStatus, normalizeAppConfig, validateConfigTarget } from './shared/config-utils';
import {
  activeImageProfileId,
  activeLlmProfileId,
  activeTtsProfileId,
  addImageProfile,
  addLlmProfile,
  addTtsProfile,
  buildConfigForSelectedProfileTest,
  copyImageProfile,
  copyLlmProfile,
  copyTtsProfile,
  editableLlmProfileProvider,
  enableImageProfile,
  enableLlmProfile,
  enableTtsProfile,
  imageProfileCustomImage,
  imageProfileGptImage,
  imageProfileJimeng,
  normalizeEditableConfigProviders,
  normalizedImageProfiles,
  normalizedTtsProfiles,
  removeImageProfile,
  removeLlmProfile,
  removeTtsProfile,
  saveImageProfile,
  saveLlmProfile,
  saveTtsProfile,
  ttsProfileMinimax,
  ttsProfileVolcengine,
} from './shared/provider-profile-utils';
import { listOpenAiCompatibleModels } from './shared/llm-provider';
import {
  defaultAccount,
  defaultActivation,
  defaultConfig,
  defaultCreditTransactions,
  defaultCustomStyles,
  defaultMinimaxCloneVoices,
  defaultPromptTemplates,
  defaultUiPreferences,
} from './shared/config';
import { draftTemplates as builtinDraftTemplates, imageAnimations, normalizeDraftTemplate } from './shared/templates';
import { selectTaskPromptTemplate } from './shared/prompt-templates';
import './styles.css';

const sampleText =
  '武曌，通称武则天、武后，是中国历史上唯一的女皇帝。武则天十四岁入宫为唐太宗才人，历经十二年不得升迁。唐高宗时复为昭仪，通过废黜王皇后与萧淑妃，得以立为皇后。并尊号为天后，与唐高宗并称二圣。';

const initialState: AppState = {
  config: defaultConfig,
  tasks: [],
  events: [],
  promptTemplates: defaultPromptTemplates,
  draftTemplates: builtinDraftTemplates,
  imageLabRecords: [],
  customStyles: defaultCustomStyles,
  creditTransactions: defaultCreditTransactions,
  minimaxCloneVoices: defaultMinimaxCloneVoices,
  account: defaultAccount,
  activation: defaultActivation,
  ui: defaultUiPreferences,
};

const navItems: Array<{ view: ShellView; label: string; hint: string; icon: React.ComponentType<{ size?: number }> }> = [
  { view: 'new-task', label: '新建任务', hint: '素材成片', icon: Plus },
  { view: 'queue', label: '任务队列', hint: '运行进度', icon: ListChecks },
  { view: 'history', label: '历史任务', hint: '本地记录', icon: History },
  { view: 'image-lab', label: '画图实验室', hint: '分镜图片', icon: FlaskConical },
  { view: 'prompt-templates', label: '提示词模板', hint: '代理提示词', icon: Sparkles },
  { view: 'draft-templates', label: '草稿模板', hint: '剪映画布', icon: LayoutTemplate },
  { view: 'settings', label: '系统设置', hint: 'API 与路径', icon: Settings },
  { view: 'account', label: '账号管理', hint: '本地资料', icon: Circle },
  { view: 'activation', label: '激活管理', hint: '本地状态', icon: KeyRound },
];

const contentTracks = [
  ['character-story', '人物故事', '历史人物 / 名人传记'],
  ['health-book', '健康图书', '健康养生 / 医学知识'],
  ['culture-science', '文化科普', '华夏文化 / 传统民俗'],
  ['picture-book', '绘本故事', '儿童绘本 / 睡前故事'],
  ['ecommerce', '电商带货', '产品种草 / 好物推荐'],
  ['mind-soup', '心灵鸡汤', '情感治愈 / 励志感悟'],
  ['folk-story', '民间故事', '虚构传说 / 因果寓言'],
  ['general-story', '通用故事', '通用写实风格'],
  ['food-v2', '美食探店V2', '城市街角小店的烟火气'],
];

const styleOptions = [
  ['black-white', '黑白摄影', '纪实感'],
  ['photo-real', '写实彩色', '质感胶片'],
  ['oil-paint', '油画风格', '印象写意'],
  ['modern-film', '现代电影', '宽屏调色'],
  ['ancient-film', '古风电影', '古代史诗'],
  ['retro-film', '复古胶片', '80年代闭达'],
  ['watercolor', '水彩治愈', '柔和晕染'],
  ['magazine', '杂志插画', '极简色块'],
  ['pixar-3d', '皮克斯 3D', '动画质感'],
  ['ink', '中国水墨', '文人意境'],
  ['folk', '民间故事工笔风', '工笔叙事'],
  ['ghibli', '吉卜力', '治愈日漫'],
];

const ratioOptions = ['21:9', '16:9', '3:2', '4:3', '1:1', '3:4', '2:3', '9:16'];
const storyboardSceneCountOptions = [8, 12, 16, 20, 30];
const voiceOptions = ['东方浩然', '灿博小叔', '温柔小雅', '爽快思思', '更多音色...'];
const volcengineVoicePresets = [
  ['Vivi 2.0', 'zh_female_vv_uranus_bigtts'],
  ['云舟 2.0', 'zh_male_m191_uranus_bigtts'],
  ['爽快思思 2.0', 'zh_female_shuangkuaisisi_uranus_bigtts'],
  ['儒雅青年 2.0', 'zh_male_ruyaqingnian_uranus_bigtts'],
  ['悬疑解说 2.0', 'zh_male_xuanyijieshuo_uranus_bigtts'],
] as const;
const pauseOptions: Array<[PausePoint, string]> = [
  ['none', '不暂停'],
  ['critical', '关键节点'],
  ['every-step', '每步确认'],
  ['custom', '自定义'],
];
const rewriteOptions: Array<[RewriteIntensity, string]> = [
  ['standard', '标准改写'],
  ['deep', '深度改写'],
  ['original', '高度原创'],
];
const povOptions = [
  ['keep-original', '保持原文'],
  ['first-person', '第一人称'],
  ['third-person', '第三人称'],
] as const;
const promptTemplateTypeOptions: Array<PromptTemplateType | 'all'> = ['all', 'task', 'review', 'rewrite', 'cover', 'storyboard', 'image-prompt'];
const promptTemplateVariables = ['inputText', 'sourceContext', 'reviewedText', 'rewrittenCopy', 'scenesJson', 'track', 'style', 'ratio', 'extraRequirements', 'taskTemplateContent'];
const fallbackEffectCatalog: JianyingEffectCatalog = {
  status: 'warn',
  detail: 'Fallback Jianying effect catalog.',
  transitions: ['叠化'],
  filters: [],
  videoEffects: [],
  audioEffects: [],
};

const pipelineSteps = [
  { index: 0, title: '文案预审', hint: '清理广告 / 敏感词', agent: 'Reviewer' },
  { index: 1, title: '智能改写与封面生成', hint: '正文 / 标题 / 发布文案 / 标签 / 评论', agent: 'Writer' },
  { index: 2, title: '影视分镜分句', hint: '拆成可配图的单元', agent: 'Storyboard' },
  { index: 3, title: '生成绘图提示词', hint: '为每个分镜写 prompt', agent: 'Prompt' },
  { index: 4, title: '批量生图', hint: '并发调用 AI 绘图', agent: 'Producer' },
  { index: 5, title: 'TTS配音', hint: '生成音频', agent: 'TTS' },
  { index: 6, title: '剪映草稿目录', hint: '写入可打开的草稿目录', agent: 'Draft' },
] as const;

type StoryboundApi = NonNullable<Window['storybound']>;
type ModelListKey = 'llm' | 'gpt-image' | 'custom-image';
type DraftCanvasLayer = 'image' | 'title' | 'subtitle' | 'caption' | 'disclaimer';
type DraftDragSnapshot =
  | { layer: 'image'; pointerId: number; startX: number; startY: number; template: DraftTemplate }
  | { layer: Exclude<DraftCanvasLayer, 'image'>; pointerId: number; startX: number; startY: number; template: DraftTemplate };

function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function hydrateState(state: Partial<AppState>): AppState {
  return {
    ...cloneState(initialState),
    ...state,
    config: normalizeAppConfig(state.config ?? defaultConfig),
    tasks: state.tasks ?? [],
    events: state.events ?? [],
    promptTemplates: state.promptTemplates ?? defaultPromptTemplates,
    draftTemplates: (state.draftTemplates ?? builtinDraftTemplates).map(normalizeDraftTemplate),
    imageLabRecords: state.imageLabRecords ?? [],
    customStyles: state.customStyles ?? defaultCustomStyles,
    creditTransactions: state.creditTransactions ?? defaultCreditTransactions,
    minimaxCloneVoices: state.minimaxCloneVoices ?? [],
    account: { ...defaultAccount, ...(state.account ?? {}) },
    activation: { ...defaultActivation, ...(state.activation ?? {}) },
    ui: { ...defaultUiPreferences, ...(state.ui ?? {}) },
  };
}

function makeFallbackApi(setState: (state: AppState) => void): StoryboundApi {
  const read = () => {
    const raw = localStorage.getItem('storybound-state');
    return raw ? hydrateState(JSON.parse(raw) as AppState) : cloneState(initialState);
  };
  const persist = (state: AppState) => {
    const next = hydrateState(state);
    localStorage.setItem('storybound-state', JSON.stringify(next));
    setState(next);
    return next;
  };

  return {
    async getState() {
      return read();
    },
    async saveConfig(config: AppConfig) {
      return persist({ ...read(), config });
    },
    async testLlmConfig(config) {
      return {
        status: config.apiKey ? 'warn' : 'fail',
        detail: config.apiKey ? 'Browser preview cannot call the model test endpoint; run the Electron app to test it.' : 'API key is missing; fill it before testing the model.',
        latencyMs: 0,
        model: config.model,
        endpoint: `${config.baseUrl || 'https://api.openai.com'}/v1/chat/completions`,
        requestId: null,
      };
    },
    async listProviderModels(request) {
      return listOpenAiCompatibleModels(request);
    },
    async listVolcengineSpeakers() {
      const speakers = volcengineVoicePresets.map(([name, voiceType]) => ({ voiceType, name }));
      return {
        status: 'warn',
        detail: '浏览器预览无法调用火山 OpenAPI，已展示本地预设音色。请在 Electron 桌面端加载全部音色。',
        latencyMs: 0,
        endpoint: 'https://open.volcengineapi.com/?Action=ListSpeakers&Version=2025-05-20',
        speakers,
        total: speakers.length,
        requestId: null,
      };
    },
    async testAppConfig(target, config) {
      return validateConfigTarget(target, config);
    },
    async searchWebSources(query) {
      return {
        query,
        sections: [],
        warnings: ['浏览器预览无法直接抓取网页正文，请在 Electron 桌面端使用搜索。'],
      };
    },
    async composeResearchCopy() {
      throw new Error('浏览器预览无法调用真实 LLM 生成文案，请在 Electron 桌面端配置模型后使用。');
    },
    async savePromptTemplate(template: PromptTemplate) {
      const state = read();
      const next = state.promptTemplates.filter((item) => item.id !== template.id);
      return persist({ ...state, promptTemplates: [{ ...template, updatedAt: new Date().toISOString() }, ...next] });
    },
    async resetPromptTemplates() {
      const state = read();
      const custom = state.promptTemplates.filter((template) => !template.isBuiltin);
      return persist({ ...state, promptTemplates: [...defaultPromptTemplates, ...custom] });
    },
    async saveDraftTemplate(template: DraftTemplate) {
      const state = read();
      const exists = state.draftTemplates.some((item) => item.id === template.id);
      const templates = exists ? state.draftTemplates.map((item) => (item.id === template.id ? template : item)) : [template, ...state.draftTemplates];
      return persist({ ...state, draftTemplates: templates });
    },
    async generateImageLab(input: ImageLabGenerateInput) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: state.config.imageProvider,
        imagePath: '',
        status: 'failed',
        errorMessage: '浏览器预览无法调用真实生图模型，请在 Electron 桌面端使用。',
        resolution: input.resolution ?? activeImageResolution(state.config),
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async addImageLabRecord(input: Partial<ImageLabRecord> & Pick<ImageLabRecord, 'prompt' | 'ratio' | 'style' | 'provider'>) {
      const state = read();
      const now = new Date().toISOString();
      const record: ImageLabRecord = {
        id: input.id ?? crypto.randomUUID(),
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        provider: input.provider,
        imagePath: input.imagePath ?? '',
        status: input.status ?? 'failed',
        errorMessage: input.errorMessage ?? '',
        resolution: input.resolution ?? '2K',
        referenceImagePath: input.referenceImagePath ?? '',
        upstreamTaskId: input.upstreamTaskId ?? null,
        createdAt: input.createdAt ?? now,
        finishedAt: input.finishedAt ?? now,
      };
      return persist({ ...state, imageLabRecords: [record, ...state.imageLabRecords] });
    },
    async saveAccount(account: AccountProfile) {
      return persist({ ...read(), account });
    },
    async saveActivation(activation: ActivationState) {
      return persist({ ...read(), activation });
    },
    async saveUiPreferences(ui: UiPreferences) {
      return persist({ ...read(), ui });
    },
    async createAndRunTask(input: CreateTaskInput) {
      const browserPipelineError =
        'Browser preview cannot run the real provider pipeline. Start the Electron app with configured LLM, image, TTS, Python, and pyJianYingDraft.';
      const state = read();
      const task: Task = {
        id: crypto.randomUUID(),
        title: input.title || input.inputText.slice(0, 18) || 'New task',
        inputText: input.inputText,
        status: 'paused',
        currentStep: 0,
        track: input.track ?? 'character-story',
        style: input.style ?? 'photo-real',
        speaker: input.speaker ?? '灿博小叔',
        ratio: input.ratio ?? '9:16',
        templateId: input.templateId ?? 'default-portrait-9-16',
        bgmId: input.bgmId ?? state.config.jianying.defaultBgmId ?? '',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: browserPipelineError,
        createdAt: new Date().toISOString(),
        completedAt: null,
        startedAt: null,
        lastHeartbeatAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        selectedSources: input.selectedSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        storyboardSceneCount: input.storyboardSceneCount ?? 12,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        failedStep: 0,
        retryFromStep: 0,
        artifactStatePath: '',
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'step_error', step: 0, agent: 'Reviewer', tool: null, detail: browserPipelineError, dataJson: null, ts: Date.now() },
      ];
      return persist({ ...state, tasks: [task, ...state.tasks], events: [...state.events, ...events] });
    },
    async updateTaskStatus(id: string, status: TaskStatus) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status, errorMessage: status === 'cancelled' ? '用户取消' : task.errorMessage } : task)) });
    },
    async retryTask(id: string) {
      const state = read();
      return persist({ ...state, tasks: state.tasks.map((task) => (task.id === id ? { ...task, status: 'pending', errorMessage: '' } : task)) });
    },
    async regenerateTaskImage() {
      throw new Error('浏览器预览不能重新生成真实图片，请在 Electron 应用中操作。');
    },
    async regenerateTaskNarration() {
      throw new Error('浏览器预览不能重新生成真实配音，请在 Electron 应用中操作。');
    },
    async getTaskArtifacts(id: string) {
      const task = read().tasks.find((item) => item.id === id);
      return {
        available: false,
        message: '浏览器预览无法读取本地任务产物，请在 Electron 桌面端查看。',
        taskId: id,
        statePath: task?.artifactStatePath ?? '',
        outputDir: task?.outputDir ?? '',
        updatedAt: null,
        steps: {},
        artifact: {},
        assets: { images: [], narration: [] },
        draft: null,
      };
    },
    async readAssetDataUrl() {
      throw new Error('浏览器预览不能读取本地媒体预览，请在 Electron 应用中查看。');
    },
    async selectLocalImage() {
      return null;
    },
    async selectLocalAudio() {
      return null;
    },
    async getJianyingEffectCatalog() {
      return fallbackEffectCatalog;
    },
    async runDiagnostics() {
      const state = read();
      return {
        generatedAt: new Date().toISOString(),
        checks: [
          { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: state.config.llm.model },
          { id: 'tts-config', label: 'TTS 凭证已填写', status: state.config.tts.volcengine.apiKey || state.config.tts.accessKey ? 'pass' : 'warn', detail: state.config.tts.provider },
          { id: 'jianying-sidecar', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath },
          { id: 'account-state', label: '账户状态', status: 'pass', detail: state.activation.message },
        ],
      };
    },
    openPath: async () => undefined,
    windowControl: async () => undefined,
    onTaskEvent: () => () => undefined,
  };
}

function App() {
  const [state, setState] = useState<AppState>(cloneState(initialState));
  const [activeView, setActiveView] = useState<ShellView>('new-task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const isBrowserPreview = !window.storybound;
  const api = useMemo(() => window.storybound ?? makeFallbackApi(setState), []);

  useEffect(() => {
    api
      .getState()
      .then((next) => {
        const hydrated = hydrateState(next);
        setState(hydrated);
        setActiveView(hydrated.ui.activeView);
      })
      .catch(console.error);
    return api.onTaskEvent((next) => {
      setState(hydrateState(next));
    });
  }, [api]);

  const liveRefreshMs = state.tasks.some((task) => task.status === 'running' || task.status === 'pending') ? 1000 : 0;
  useEffect(() => {
    if (!liveRefreshMs) return undefined;
    const timer = window.setInterval(() => {
      api.getState().then((next) => setState(hydrateState(next))).catch(console.error);
    }, liveRefreshMs);
    return () => window.clearInterval(timer);
  }, [api, liveRefreshMs]);

  async function navigate(view: ShellView) {
    if (view !== 'task-detail') {
      setSelectedTaskId(null);
    }
    setActiveView(view);
    setSaveTone('saving');
    try {
      const next = await api.saveUiPreferences({ ...state.ui, activeView: view });
      setState(hydrateState(next));
      setSaveTone('saved');
    } catch (error) {
      setSaveTone('dirty');
      console.error(error);
    }
  }

  function applyState(next: AppState) {
    setState(hydrateState(next));
    setSaveTone('saved');
  }

  async function openTaskDetail(taskId: string) {
    setSelectedTaskId(taskId);
    setActiveView('task-detail');
    setSaveTone('saving');
    try {
      const next = await api.saveUiPreferences({ ...state.ui, activeView: 'task-detail' });
      setState(hydrateState(next));
      setSaveTone('saved');
    } catch (error) {
      setSaveTone('dirty');
      console.error(error);
    }
  }

  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) ?? state.tasks[0] ?? null;
  const activeNav = activeView === 'task-detail' ? { label: '任务详情', hint: '单任务流水线' } : navItems.find((item) => item.view === activeView) ?? navItems[0];

  return (
    <main className="app-shell">
      <div className="window-line">
        <div className="window-title">
          <div className="app-mark">S</div>
          <strong>Storybound</strong>
        </div>
        <div className="window-controls" aria-label="窗体控制">
          <button className="window-control-button" type="button" aria-label="最小化" onClick={() => api.windowControl('minimize')}>
            <Minus size={14} />
          </button>
          <button className="window-control-button" type="button" aria-label="最大化" onClick={() => api.windowControl('toggle-maximize')}>
            <Maximize2 size={14} />
          </button>
          <button className="window-control-button close" type="button" aria-label="关闭" onClick={() => api.windowControl('close')}>
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="shell-grid">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand-logo">S</div>
            <div>
              <strong>Storybound</strong>
              <span>v0.10.4 · beta</span>
            </div>
            <Bell size={16} className="brand-bell" />
          </div>

          <button className="new-task-button" onClick={() => navigate('new-task')}>
            <Plus size={16} />
            <span>新建任务</span>
            <kbd>Ctrl+N</kbd>
          </button>

          <nav className="nav-list">
            {navItems.slice(1).map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.view} className={activeView === item.view ? 'nav-item active' : 'nav-item'} onClick={() => navigate(item.view)}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                  <small>{item.hint}</small>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-bottom">
            <button className="credit-chip">
              <Coins size={15} />
              全能绘图积分
              <span>{state.account.balance.toFixed(2)}</span>
            </button>
            <button className="feedback-link">
              <Info size={14} />
              意见反馈
            </button>
          </div>
        </aside>

        <section className="content">
          <header className="page-head">
          <div>
            <h1>{activeNav.label}</h1>
            <p>{pageSubtitle(activeView)}</p>
            {isBrowserPreview ? <span className="local-note">浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。</span> : null}
          </div>
            <div className="top-notice">
              <Info size={16} />
              <span>{state.config.jianying.draftPath ? `剪映草稿目录：${state.config.jianying.draftPath}` : '尚未配齐：剪映草稿目录'}</span>
            </div>
            <div className={`save-state ${saveTone}`}>
              <span />
              {saveTone === 'saving' ? '保存中' : saveTone === 'dirty' ? '有未保存改动' : '所有改动已保存'}
            </div>
          </header>

          {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'history' ? <HistoryPage api={api} state={state} openTaskDetail={openTaskDetail} /> : null}
          {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} close={() => navigate('history')} isBrowserPreview={isBrowserPreview} /> : null}
          {activeView === 'image-lab' ? <ImageLabPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'prompt-templates' ? <PromptTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'draft-templates' ? <DraftTemplatesPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'settings' ? <SettingsPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'account' ? <AccountPage api={api} state={state} applyState={applyState} /> : null}
          {activeView === 'activation' ? <ActivationPage api={api} state={state} applyState={applyState} /> : null}
        </section>
      </div>
    </main>
  );
}

function NewTaskPage({
  api,
  state,
  applyState,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryboundApi;
  state: AppState;
  applyState: (state: AppState) => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const [mode, setMode] = useState<TaskMode>('paste');
  const [title, setTitle] = useState('');
  const [inputText, setInputText] = useState(sampleText);
  const [aiKeyword, setAiKeyword] = useState('武则天回宫');
  const [aiSources, setAiSources] = useState(['web']);
  const [extraRequirements, setExtraRequirements] = useState('字数控制在 500 字左右，聚焦人物转折经历，语气偏感性');
  const [track, setTrack] = useState('character-story');
  const [style, setStyle] = useState('photo-real');
  const [ratio, setRatio] = useState('9:16');
  const [templateId, setTemplateId] = useState(state.draftTemplates[0]?.id ?? 'default-portrait-9-16');
  const [promptTemplateOverrideId, setPromptTemplateOverrideId] = useState('');
  const [speaker, setSpeaker] = useState(state.config.tts.speaker);
  const [bgmId, setBgmId] = useState(() => resolveDefaultBgmId(state.config));
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pausePoint, setPausePoint] = useState<PausePoint>('none');
  const [rewriteIntensity, setRewriteIntensity] = useState<RewriteIntensity>('standard');
  const [narrativePov, setNarrativePov] = useState<Task['narrativePov']>('keep-original');
  const [keepPromotion, setKeepPromotion] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [storyboardSceneCount, setStoryboardSceneCount] = useState(12);
  const [running, setRunning] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  const [searchingSources, setSearchingSources] = useState(false);
  const [searchContext, setSearchContext] = useState<AiSourceContext | null>(null);
  const [selectedSearchSourceIds, setSelectedSearchSourceIds] = useState<string[]>([]);
  const [searchMessage, setSearchMessage] = useState('');
  const [composingCopy, setComposingCopy] = useState(false);
  const [researchCopy, setResearchCopy] = useState('');
  const [researchCopyMessage, setResearchCopyMessage] = useState('');

  const searchSections = (searchContext?.sections ?? []).slice(0, 10);
  const selectedSources = searchSections.filter((source, index) => selectedSearchSourceIds.includes(sourceKey(source, index)));
  const taskPromptTemplates = state.promptTemplates.filter((template) => template.type === 'task');
  const resolvedPromptTemplate = resolvePromptTemplateForTrack(state.promptTemplates, track, promptTemplateOverrideId || null);
  const bgmOptions = validBgmItems(state.config);

  useEffect(() => {
    setBgmId((current) => (current && bgmOptions.some((bgm) => bgm.id === current) ? current : resolveDefaultBgmId(state.config)));
  }, [state.config.jianying.bgmLibrary, state.config.jianying.defaultBgmId]);

  async function searchWebSources() {
    const keyword = aiKeyword.trim();
    if (!keyword) {
      setSearchMessage('请先输入关键词。');
      return;
    }
    setSearchingSources(true);
    setSearchMessage('正在从 Bing 搜索并读取网页正文...');
    try {
      const context = await api.searchWebSources(keyword);
      const limitedContext = { ...context, sections: context.sections.slice(0, 10) };
      setSearchContext(limitedContext);
      setSelectedSearchSourceIds([]);
      setSearchMessage(context.warnings.length ? context.warnings.join('；') : `已获取前 ${limitedContext.sections.length} 条网页资料，请勾选要使用的页面。`);
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSearchingSources(false);
    }
  }

  async function composeResearchCopy() {
    if (selectedSources.length === 0) {
      setResearchCopyMessage('请先勾选至少 1 个网页来源。');
      return;
    }
    setComposingCopy(true);
    setResearchCopyMessage('正在结合所选页面信息生成文案...');
    try {
      const result = await api.composeResearchCopy({
        keyword: aiKeyword.trim(),
        extraRequirements,
        selectedSources,
      });
      setResearchCopy(result.copy);
      setInputText(result.copy);
      setTitle(result.title || aiKeyword.trim());
      setMode('paste');
      setResearchCopyMessage(`已生成文案并填入粘贴文案${result.requestId ? `（request ${result.requestId}）` : ''}。`);
    } catch (error) {
      setResearchCopyMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setComposingCopy(false);
    }
  }

  async function addBgmFromTask() {
    const audioPath = await api.selectLocalAudio();
    if (!audioPath) return;
    const nextBgm = addUploadedBgm(state.config, audioPath);
    const next = await api.saveConfig(nextBgm.config);
    applyState(next);
    setBgmId(nextBgm.bgmId);
  }

  async function run() {
    if (isBrowserPreview) {
      setDraftNotice('浏览器预览不能执行真实流水线，请在 Electron 应用中运行任务。');
      return;
    }
    setRunning(true);
    try {
      const next = await api.createAndRunTask({
        title,
        inputText: mode === 'paste' ? inputText : researchCopy.trim() || `${aiKeyword}\n\n${extraRequirements}`,
        mode,
        aiKeyword,
        aiSources,
        selectedSources: mode === 'ai' ? selectedSources : [],
        extraRequirements,
        track,
        style,
        speaker,
        ratio,
        templateId,
        bgmId,
        pausePoints: [pausePoint],
        referenceImagePath,
        rewriteIntensity,
        narrativePov,
        keepPromotion,
        ttsProvider: state.config.tts.provider,
        ttsSpeed,
        storyboardSceneCount,
        promptTemplateId: resolvedPromptTemplate?.id ?? null,
        promptTemplateType: 'task',
      });
      applyState(next);
      const createdTask = next.tasks[0];
      if (createdTask) {
        openTaskDetail(createdTask.id);
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="new-task-scroll">
      <section className="task-card">
        <Field label="标题" hint="可选">
          <input value={title} placeholder="留空会从文案自动提取" onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="mode-grid">
          <button className={mode === 'paste' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('paste')}>
            <strong>粘贴文案</strong>
            <span>已有对标文案，直接贴进来改写</span>
          </button>
          <button className={mode === 'ai' ? 'mode-card active' : 'mode-card'} onClick={() => setMode('ai')}>
            <strong>AI 创作 <em>NEW</em></strong>
            <span>输入关键词，AI 自动搜索并创作原稿</span>
          </button>
        </div>

        {mode === 'paste' ? (
          <Field label="文案内容">
            <textarea className="source-textarea" value={inputText} onChange={(event) => setInputText(event.target.value)} />
          </Field>
        ) : (
          <div className="ai-create-panel">
            <Field label="关键词">
              <input value={aiKeyword} onChange={(event) => setAiKeyword(event.target.value)} placeholder="例如：钱学森回国 / 张桂梅 / 苹果秋季发布会" />
            </Field>
            <span className="field-title">数据源</span>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('web')} onChange={() => setAiSources(toggleArray(aiSources, 'web'))} />
              全网搜索 <small>从 Bing + 搜狗 + 百度 + 360 搜索，补充百科、知乎、百家号、头条正文</small>
            </label>
            <label className="check-row">
              <input type="checkbox" checked={aiSources.includes('builtin-knowledge')} onChange={() => setAiSources(toggleArray(aiSources, 'builtin-knowledge'))} />
              AI 内置知识补全 <small>允许 AI 用自己的知识补全细节</small>
            </label>
            <label className="check-row muted">
              <input type="checkbox" checked={aiSources.includes('ima')} onChange={() => setAiSources(toggleArray(aiSources, 'ima'))} />
              IMA 知识库 <small>前往系统设置 · AI 创作配置</small>
            </label>
            <Field label="额外要求" hint="可选">
              <input className="extra-requirements-input" value={extraRequirements} onChange={(event) => setExtraRequirements(event.target.value)} />
            </Field>
            <button className="ghost-action" disabled={searchingSources || !aiKeyword.trim()} onClick={searchWebSources}>
              {searchingSources ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
              搜索
            </button>
            {searchMessage ? <div className="test-result">{searchMessage}</div> : null}
            {searchContext ? (
              <div className="ai-search-block">
                <div className="ai-search-results ai-search-results-scroll">
                  <div className="panel-title-row">
                    <h3>网页候选（前 10 条）</h3>
                    <small>{selectedSources.length}/{searchContext.sections.length} 已选择</small>
                  </div>
                  {searchContext.sections.length === 0 ? <EmptyState title="暂无可用网页资料" /> : null}
                  {searchContext.sections.map((source, index) => {
                    const id = sourceKey(source, index);
                    return (
                      <label className="search-source-card" key={id}>
                        <input type="checkbox" checked={selectedSearchSourceIds.includes(id)} onChange={() => setSelectedSearchSourceIds(toggleArray(selectedSearchSourceIds, id))} />
                        <div>
                          <strong>{source.title}</strong>
                          {source.url ? <span>{source.url}</span> : null}
                          <p>{(source.content || source.snippet || '').slice(0, 220)}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <div className="ai-search-actions">
                  <button className="primary-action slim" disabled={composingCopy || selectedSources.length === 0} onClick={composeResearchCopy}>
                    {composingCopy ? <Loader2 className="spin" size={15} /> : <Wand2 size={15} />}
                    结合所选页面信息生成文案
                  </button>
                </div>
                {researchCopyMessage ? <div className="test-result">{researchCopyMessage}</div> : null}
                {researchCopy ? (
                  <Field label="生成文案（可编辑）">
                    <textarea className="small-textarea research-copy-textarea" value={researchCopy} onChange={(event) => setResearchCopy(event.target.value)} />
                  </Field>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <OptionCloud title="内容赛道" options={contentTracks} value={track} onChange={setTrack} />
        <OptionCloud title="画面风格" options={styleOptions} value={style} onChange={setStyle} />

        <div className="option-two-col">
          <OptionCloud title="草稿模板" options={state.draftTemplates.map((template) => [template.id, template.name, `出图 ${template.image.ratio}`])} value={templateId} onChange={setTemplateId} />
          <div>
            <span className="field-title">AI 出图比例 <small>已跟随草稿模板</small></span>
            <div className="ratio-grid">
              {['9:16', '4:3', '1:1', '16:9'].map((item) => (
                <button key={item} className={ratio === item ? 'chip active' : 'chip'} onClick={() => setRatio(item)}>
                  <span className="ratio-icon" />
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>

        <span className="field-title">配音员</span>
        <div className="chip-row">
          {voiceOptions.map((voice) => (
            <button key={voice} className={speaker === voice ? 'chip active' : 'chip'} onClick={() => setSpeaker(voice)}>
              <Mic2 size={14} />
              {voice}
            </button>
          ))}
        </div>

        <span className="field-title">背景音乐</span>
        <div className="chip-row">
          <button className={bgmId === '' ? 'chip active' : 'chip'} onClick={() => setBgmId('')}>
            无 BGM
          </button>
          {bgmOptions.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>
              {bgm.title}
            </button>
          ))}
          <button className="chip" onClick={addBgmFromTask}><Plus size={14} />添加</button>
        </div>

        <Field label="主角参考图" hint="可选">
          <div className="upload-row">
            <input value={referenceImagePath} placeholder="上传后出现主角的分镜会以这张为基础保持人物一致" onChange={(event) => setReferenceImagePath(event.target.value)} />
            <button className="ghost-action">
              <Upload size={15} />
              上传主角参考图
            </button>
          </div>
        </Field>

        <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? '▼' : '▶'} 高级选项 <span>改写强度 · 叙事视角 · 带货 · 处理模式 · 暂停确认</span>
        </button>
        {showAdvanced ? (
          <div className="advanced-grid">
            <Segmented label="处理模式" value="full-auto" options={['full-auto', 'semi-auto', 'clip-only']} labels={['全自动', '半自动', '直接出片']} onChange={() => undefined} />
            <Segmented
              label="分镜数量"
              value={String(storyboardSceneCount)}
              options={storyboardSceneCountOptions.map(String)}
              labels={storyboardSceneCountOptions.map((count) => `${count} 条`)}
              onChange={(value) => setStoryboardSceneCount(Number(value))}
            />
            <Segmented label="暂停确认" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
            <Segmented label="改写强度" value={rewriteIntensity} options={rewriteOptions.map(([id]) => id)} labels={rewriteOptions.map(([, label]) => label)} onChange={(value) => setRewriteIntensity(value as RewriteIntensity)} />
            <Segmented label="叙事视角" value={narrativePov} options={povOptions.map(([id]) => id)} labels={povOptions.map(([, label]) => label)} onChange={(value) => setNarrativePov(value as Task['narrativePov'])} />
            <Field label="提示词模板" hint={resolvedPromptTemplate ? `当前：${resolvedPromptTemplate.name}` : '自动匹配赛道模板'}>
              <select className="prompt-template-selector" value={promptTemplateOverrideId} onChange={(event) => setPromptTemplateOverrideId(event.target.value)}>
                <option value="">自动匹配赛道模板</option>
                {taskPromptTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.baseTrack ? `${template.name} · ${template.baseTrack}` : template.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="toggle-row">
              <input type="checkbox" checked={keepPromotion} onChange={(event) => setKeepPromotion(event.target.checked)} />
              带货模式 <small>改写时删除带货段落</small>
            </label>
            <Segmented label="配音语速" value={String(ttsSpeed)} options={['0.85', '1', '1.15', '1.3']} labels={['慢速 0.85x', '默认 1.0x', '快速 1.15x', '更快 1.3x']} onChange={(value) => setTtsSpeed(Number(value))} />
            <Field label="自定义 / 其他模型">
              <select defaultValue={state.config.llm.model}>
                {state.config.llmProfiles.map((profile) => (
                  <option key={profile.model} value={profile.model}>
                    {profile.provider}: {profile.model}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : null}

        <div className="task-footer">
          <span className="danger-text">{isBrowserPreview ? '浏览器预览不能执行真实流水线' : '试用已用尽，复刻版仅本地模拟，不阻断生成'}</span>
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraftNotice('已保存为本地草稿预设')}>
              保存为草稿
            </button>
            <button className="primary-action" onClick={run} disabled={isBrowserPreview || running || (mode === 'paste' ? inputText.trim().length === 0 : aiKeyword.trim().length === 0)}>
              {running ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
              {running ? '运行中' : '开始生成'}
            </button>
          </div>
        </div>
        {draftNotice ? <span className="local-note">{draftNotice}</span> : null}
      </section>
    </div>
  );
}

function QueuePage({
  api,
  state,
  applyState,
  openNewTask,
  openTaskDetail,
  isBrowserPreview,
}: {
  api: StoryboundApi;
  state: AppState;
  applyState: (state: AppState) => void;
  openNewTask: () => void;
  openTaskDetail: (taskId: string) => void;
  isBrowserPreview: boolean;
}) {
  const latestTask = state.tasks[0];
  const events = latestTask ? state.events.filter((event) => event.taskId === latestTask.id || event.taskId === 'live') : state.events;
  async function setStatus(task: Task, status: TaskStatus) {
    applyState(await api.updateTaskStatus(task.id, status));
  }
  async function resumeTask(task: Task) {
    applyState(await api.retryTask(task.id));
  }
  return (
    <div className="queue-layout">
      <section className="panel">
        <div className="panel-title-row">
          <div>
            <h2>任务队列</h2>
            <span>{state.tasks.length} 个草稿 · 选中一批即可自动串行执行 · 单任务内 3 路并发生图</span>
          </div>
          <button className="primary-action slim" onClick={openNewTask}>
            <Plus size={15} />
            新建任务
          </button>
        </div>
        <div className="task-list">
          {state.tasks.length === 0 ? <EmptyState title="暂无任务" /> : null}
          {state.tasks.map((task) => (
            <article className="task-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
              <div>
                <strong>{task.title || '未命名任务'}</strong>
                <span>{task.mode === 'ai' ? 'AI 创作' : '粘贴文案'} · {task.ratio} · {formatDate(task.createdAt)}</span>
                <ErrorSummaryButton fullMessage={task.errorMessage} title={task.title || '任务错误'} />
              </div>
              <StatusPill status={task.status} />
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                {task.status === 'running' ? <button className="mini-button" onClick={() => setStatus(task, 'paused')}>暂停</button> : null}
                {task.status === 'running' || task.status === 'pending' ? <button className="mini-button" onClick={() => setStatus(task, 'cancelled')}>取消</button> : null}
                {task.status === 'paused' || task.status === 'failed' ? <button className="mini-button" disabled={isBrowserPreview} onClick={() => resumeTask(task)}>继续</button> : null}
                {task.status === 'paused' || task.status === 'failed' ? <button className="mini-button" disabled={isBrowserPreview} onClick={() => resumeTask(task)}>重试</button> : null}
                <button className="mini-button" disabled={task.status !== 'completed' || !task.outputDir} onClick={() => task.outputDir && api.openPath(task.outputDir)}>
                  <FolderOpen size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-title-row">
          <h2>步骤事件</h2>
          {latestTask?.status === 'completed' && latestTask.outputDir ? (
            <button className="ghost-action" onClick={() => api.openPath(latestTask.outputDir)}>
              <FolderOpen size={15} />
              打开剪映草稿
            </button>
          ) : null}
        </div>
        <EventTimeline events={events.slice(-24)} />
      </section>
    </div>
  );
}

function HistoryPage({ api, state, openTaskDetail }: { api: StoryboundApi; state: AppState; openTaskDetail: (taskId: string) => void }) {
  const [filter, setFilter] = useState<'all' | TaskStatus>('all');
  const [query, setQuery] = useState('');
  const tasks = state.tasks.filter((task) => (filter === 'all' || task.status === filter) && `${task.title}${task.inputText}`.includes(query));
  return (
    <section className="panel full-panel">
      <div className="panel-title-row">
        <div className="chip-row">
          {(['all', 'draft', 'completed', 'running', 'failed', 'cancelled'] as const).map((item) => (
            <button key={item} className={filter === item ? 'chip active' : 'chip'} onClick={() => setFilter(item)}>
              {statusLabel(item)}
            </button>
          ))}
        </div>
        <input className="search-input" value={query} placeholder="搜索任务" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="history-table">
        <div className="table-head">
          <span>任务</span>
          <span>状态</span>
          <span>步骤</span>
          <span>创建时间</span>
          <span>输出</span>
        </div>
        {tasks.length === 0 ? <EmptyState title="暂无历史任务" /> : null}
        {tasks.map((task) => (
          <div className="table-row clickable" key={task.id} role="button" tabIndex={0} onClick={() => openTaskDetail(task.id)} onKeyDown={(event) => event.key === 'Enter' && openTaskDetail(task.id)}>
            <strong>{task.title || '未命名任务'}</strong>
            <StatusPill status={task.status} />
            <span>{task.currentStep}</span>
            <span>{formatDate(task.createdAt)}</span>
            <button className="mini-button" disabled={!task.outputDir} onClick={(event) => { event.stopPropagation(); if (task.outputDir) api.openPath(task.outputDir); }}>
              <FolderOpen size={14} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskDetailPage({
  api,
  state,
  task,
  applyState,
  close,
  isBrowserPreview,
}: {
  api: StoryboundApi;
  state: AppState;
  task: Task | null;
  applyState: (state: AppState) => void;
  close: () => void;
  isBrowserPreview: boolean;
}) {
  const [tab, setTab] = useState<'preview' | 'storyboard' | 'audio'>('preview');
  const [liveNow, setLiveNow] = useState(Date.now());
  const [artifactSnapshot, setArtifactSnapshot] = useState<TaskArtifactSnapshot | null>(null);
  const [artifactRefreshTick, setArtifactRefreshTick] = useState(0);
  const events = task ? state.events.filter((event) => event.taskId === task.id) : [];
  const latestEvent = [...events].reverse()[0] ?? null;
  const snapshotImageCount = artifactSnapshot?.assets.images.length ?? 0;
  const artifactRefreshKey = [
    task?.id ?? '',
    task?.artifactStatePath ?? '',
    task?.outputDir ?? '',
    task?.currentStep ?? '',
    task?.status ?? '',
    latestEvent?.id ?? latestEvent?.seq ?? latestEvent?.ts ?? '',
    snapshotImageCount,
    snapshotStepStatus(artifactSnapshot, 4),
    artifactRefreshTick,
  ].join('|');
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    if (task?.status !== 'running') return undefined;
    const timer = window.setInterval(() => setArtifactRefreshTick((tick) => tick + 1), 1500);
    return () => window.clearInterval(timer);
  }, [task?.id, task?.status]);
  useEffect(() => {
    let cancelled = false;
    if (!task) {
      setArtifactSnapshot(null);
      return undefined;
    }
    const artifactTask = task;
    api.getTaskArtifacts(artifactTask.id)
      .then((snapshot) => {
        if (!cancelled) setArtifactSnapshot(snapshot);
      })
      .catch((error) => {
        if (!cancelled) {
          setArtifactSnapshot({
            available: false,
            message: error instanceof Error ? error.message : String(error),
            taskId: artifactTask.id,
            statePath: artifactTask.artifactStatePath,
            outputDir: artifactTask.outputDir,
            updatedAt: null,
            steps: {},
            artifact: {},
            assets: { images: [], narration: [] },
            draft: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, artifactRefreshKey, task]);
  if (!task) {
    return (
      <section className="panel full-panel">
        <EmptyState title="暂无任务详情" />
      </section>
    );
  }

  const activeTask = task;
  const currentStep = Math.min(Math.max(activeTask.currentStep, 0), pipelineSteps.length - 1);
  const currentMeta = pipelineSteps[currentStep] ?? pipelineSteps[0];
  const completedSteps = activeTask.status === 'completed' ? pipelineSteps.length : Math.max(0, activeTask.currentStep);

  async function cancelTask() {
    applyState(await api.updateTaskStatus(activeTask.id, 'cancelled'));
  }

  return (
    <div className="task-detail-shell">
      <div className="task-detail-bar">
        <div className="breadcrumb">
          <button onClick={close}>历史任务</button>
          <span>/</span>
          <strong>任务详情</strong>
        </div>
        <button className="mini-button" onClick={close}>
          <XCircle size={14} />
          关闭
        </button>
      </div>

      <aside className="task-detail-sidebar">
        <section className="task-summary-card">
          <div className="task-id-line">
            <span>{activeTask.id}</span>
            <button className="icon-button" title="复制任务 ID" onClick={() => navigator.clipboard?.writeText(activeTask.id)}>
              <Copy size={14} />
            </button>
          </div>
          <div className="task-metrics">
            <div><strong>{formatDuration(activeTask.createdAt, activeTask.completedAt, liveNow)}</strong><span>总耗时</span></div>
            <div><strong>{completedSteps}<small>/{pipelineSteps.length}</small></strong><span>当前步骤</span></div>
            <div><strong>{events.length || '-'}</strong><span>事件数</span></div>
          </div>
          <button className="cancel-task-button" disabled={activeTask.status === 'completed' || activeTask.status === 'cancelled'} onClick={cancelTask}>
            <XCircle size={14} />
            取消任务
          </button>
        </section>

        <section className="pipeline-card">
          <div className="pipeline-title">
            <strong>7 步流水线</strong>
            <span className="auto-badge">全自动</span>
            <small>· 全部 7 步执行</small>
          </div>
          <div className="pipeline-list">
            {pipelineSteps.map((step) => {
              const status = pipelineStepStatus(activeTask, step.index);
              const stepEvent = [...events].reverse().find((event) => event.step === step.index);
              const stepLabel = stepEvent?.detail || statusLabelForStep(status);
              return (
                <div className={`pipeline-step ${status}`} key={step.index}>
                  <div className="pipeline-node">{status === 'running' ? <Loader2 className="spin" size={14} /> : step.index + 1}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.hint}</span>
                    {status === 'running' ? <small>进行中</small> : stepEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={stepEvent.detail} title={step.title} compact /> : <small>{stepLabel}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      <section className="task-detail-main">
        <div className="artifact-tabs">
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><FileJson size={14} />产物预览</button>
          <button className={tab === 'storyboard' ? 'active' : ''} onClick={() => setTab('storyboard')}><ImageIcon size={14} />分镜画廊</button>
          <button className={tab === 'audio' ? 'active' : ''} onClick={() => setTab('audio')}><Mic2 size={14} />配音试听</button>
        </div>
        <ArtifactPreviewContent api={api} task={activeTask} config={state.config} applyState={applyState} tab={tab} snapshot={artifactSnapshot} latestEvent={latestEvent} currentAgent={currentMeta.agent} isBrowserPreview={isBrowserPreview} />
      </section>
    </div>
  );
}

function ArtifactPreviewContent({
  api,
  task,
  config,
  applyState,
  tab,
  snapshot,
  latestEvent,
  currentAgent,
  isBrowserPreview,
}: {
  api: StoryboundApi;
  task: Task;
  config: AppConfig;
  applyState: (state: AppState) => void;
  tab: 'preview' | 'storyboard' | 'audio';
  snapshot: TaskArtifactSnapshot | null;
  latestEvent: TaskEvent | null;
  currentAgent: string;
  isBrowserPreview: boolean;
}) {
  const artifact = snapshot?.artifact ?? {};
  const sourceContext = artifact.sourceContext;
  const scenes = artifact.scenes ?? [];
  const imagePrompts = artifact.imagePrompts ?? [];
  const subtitles = artifact.subtitles;
  const imageAssets = snapshot?.assets.images ?? [];
  const narrationAssets = snapshot?.assets.narration ?? [];
  const imageProgress = imageProgressLabel(scenes.length, imageAssets.length, snapshotStepStatus(snapshot, 4));

  return (
    <div className="artifact-preview">
      <div className="artifact-preview-head">
        <div className="preview-empty-icon">{task.status === 'running' ? <Loader2 className="spin" size={22} /> : <Database size={22} />}</div>
        <div>
          <strong>{artifactPanelTitle(task, tab)}</strong>
          {latestEvent?.type === 'step_error' ? <ErrorSummaryButton fullMessage={latestEvent.detail} title="流水线错误" /> : <span>{snapshot?.message || latestEvent?.detail || '等待当前步骤产物落盘'}</span>}
        </div>
        {task.status === 'completed' && task.outputDir ? (
          <button className="ghost-action" onClick={() => api.openPath(task.outputDir)}>
            <FolderOpen size={15} />
            打开剪映草稿
          </button>
        ) : null}
      </div>

      <div className="preview-meta-grid">
        <div><small>任务</small><strong>{task.title || '未命名任务'}</strong></div>
        <div><small>状态</small><strong>{statusLabel(task.status)}</strong></div>
        <div><small>当前代理</small><strong>{currentAgent}</strong></div>
        <div><small>图片进度</small><strong>{imageProgress}</strong></div>
        <div><small>产物更新时间</small><strong>{snapshot?.updatedAt ? formatDate(snapshot.updatedAt) : '等待生成'}</strong></div>
        <div><small>输出目录</small><strong>{task.outputDir || '等待生成'}</strong></div>
        <div><small>失败步骤</small><strong>{task.failedStep ?? '-'}</strong></div>
        <div><small>状态文件</small><strong>{task.artifactStatePath || '等待生成'}</strong></div>
        <div><small>最近心跳</small><strong>{task.lastHeartbeatAt ? formatDate(task.lastHeartbeatAt) : '等待运行'}</strong></div>
        <div><small>恢复步骤</small><strong>{task.retryFromStep ?? '-'}</strong></div>
      </div>

      {tab === 'preview' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="AI 搜索资料" badge={`${sourceContext?.sections.length ?? 0} 条`}>
            {sourceContext?.sections.length ? (
              <div className="artifact-source-list">
                {sourceContext.sections.map((source, index) => (
                  <div key={`${source.title}-${index}`}>
                    <strong>{source.title}</strong>
                    {source.url ? <span>{source.url}</span> : null}
                    <p>{trimForPreview(source.content || source.snippet || '', 260)}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="等待 AI 创作搜索资料" />}
          </ArtifactSection>

          <ArtifactSection title="文案预审" badge={`${countChars(artifact.reviewedText)} 字`}>
            <ArtifactText value={artifact.reviewedText} empty="等待文案预审产物" />
          </ArtifactSection>

          <ArtifactSection title="改写产物" badge={`${countChars(artifact.rewrittenCopy)} 字`}>
            <ArtifactText value={artifact.rewrittenCopy} empty="等待改写产物" />
          </ArtifactSection>

          <ArtifactSection title="封面信息" badge={artifact.cover?.title || '等待生成'}>
            {artifact.cover ? (
              <div className="artifact-cover-grid">
                <div><small>标题</small><strong>{artifact.cover.title}</strong></div>
                <div><small>副标题</small><strong>{artifact.cover.subtitle.join(' / ') || '-'}</strong></div>
                <div><small>摘要</small><p>{artifact.cover.summary || '-'}</p></div>
                <div><small>标签</small><p>{artifact.cover.tags.join(' ') || '-'}</p></div>
                <div><small>种子评论</small><p>{artifact.cover.comments.join(' / ') || '-'}</p></div>
              </div>
            ) : <ArtifactEmpty text="等待封面标题、摘要、标签和评论" />}
          </ArtifactSection>

          <ArtifactSection title="分镜分句" badge={`${scenes.length} 条`}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>

          <ArtifactSection title="绘图提示词" badge={`${imagePrompts.length} 条`}>
            <ArtifactPromptList prompts={imagePrompts} />
          </ArtifactSection>

          <ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>

          <ArtifactSection title="配音字幕" badge={`${narrationAssets.length} 段 / ${subtitles?.cues.length ?? 0} 条字幕`}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="等待配音生成"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.srt ? <pre className="artifact-text-block compact">{trimForPreview(subtitles.srt, 900)}</pre> : null}
          </ArtifactSection>

          <ArtifactSection title="草稿输出" badge={snapshot?.draft ? '已生成' : '等待生成'}>
            {snapshot?.draft ? (
              <div className="artifact-path-list">
                <span>{snapshot.draft.draftDir}</span>
                <span>{snapshot.draft.draftContentPath}</span>
                <span>{snapshot.draft.draftMetaPath}</span>
              </div>
            ) : <ArtifactEmpty text="等待剪映草稿目录" />}
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'storyboard' ? (
        <div className="artifact-section-stack">
          <section className="storyboard-gallery-hero">
            <div>
              <strong>分镜画廊</strong>
              <span>{imageProgress}</span>
            </div>
            <small>生成一张就会出现在这里，便于边跑边检查全部画面。</small>
          </section>
          <ArtifactSection title="全部图片" badge={`${imageAssets.length} / ${scenes.length || imageAssets.length} 张`}>
            <ArtifactImageGallery assets={imageAssets} scenes={scenes} empty="等待第一张分镜图片生成" />
          </ArtifactSection>
          <ArtifactSection title="分镜分句" badge={`${scenes.length} 条`}>
            <ArtifactSceneList scenes={scenes} imagePrompts={imagePrompts} images={imageAssets} />
          </ArtifactSection>
          <ArtifactSection title="绘图提示词" badge={`${imagePrompts.length} 条`}>
            <ArtifactPromptList prompts={imagePrompts} />
          </ArtifactSection>
          <ArtifactSection title="批量生图" badge={`${imageAssets.length} 张`}>
            <ImageGenerationGallery
              api={api}
              task={task}
              scenes={scenes}
              imagePrompts={imagePrompts}
              images={imageAssets}
              concurrency={activeImageConcurrency(config)}
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
          </ArtifactSection>
        </div>
      ) : null}

      {tab === 'audio' ? (
        <div className="artifact-section-stack">
          <ArtifactSection title="配音字幕" badge={`${narrationAssets.length} 段 / ${subtitles?.cues.length ?? 0} 条字幕`}>
            <NarrationPreviewList
              api={api}
              task={task}
              scenes={scenes}
              subtitles={subtitles}
              assets={narrationAssets}
              empty="等待配音生成"
              isBrowserPreview={isBrowserPreview}
              applyState={applyState}
            />
            {subtitles?.cues.length ? (
              <div className="artifact-scene-list">
                {subtitles.cues.map((cue) => (
                  <div key={cue.index}>
                    <strong>{cue.index}. {formatMs(cue.startMs)} - {formatMs(cue.endMs)}</strong>
                    <p>{cue.text}</p>
                  </div>
                ))}
              </div>
            ) : <ArtifactEmpty text="等待字幕时间轴" />}
          </ArtifactSection>
        </div>
      ) : null}
    </div>
  );
}

function ArtifactSection({ title, badge, children }: { title: string; badge: string; children: React.ReactNode }) {
  return (
    <section className="artifact-section">
      <div className="panel-title-row">
        <h3>{title}</h3>
        <small>{badge}</small>
      </div>
      {children}
    </section>
  );
}

function ArtifactText({ value, empty }: { value?: string; empty: string }) {
  return value ? <pre className="artifact-text-block">{value}</pre> : <ArtifactEmpty text={empty} />;
}

function ArtifactEmpty({ text }: { text: string }) {
  return <div className="artifact-empty">{text}</div>;
}

function ArtifactSceneList({
  scenes,
  imagePrompts,
  images,
}: {
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
}) {
  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜生成" />;
  return (
    <div className="artifact-scene-list">
      {scenes.map((scene) => {
        const prompt = imagePrompts.find((item) => item.sceneId === scene.id);
        const image = images.find((item) => item.sceneId === scene.id);
        return (
          <div key={scene.id}>
            <strong>{scene.id}. {scene.cap}</strong>
            <p>{scene.descPrompt}</p>
            {prompt ? <small>Prompt: {trimForPreview(prompt.prompt, 220)}</small> : null}
            {image ? <span>{image.path}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ArtifactPromptList({ prompts }: { prompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']> }) {
  if (prompts.length === 0) return <ArtifactEmpty text="等待绘图提示词" />;
  return (
    <div className="artifact-scene-list">
      {prompts.map((prompt) => (
        <div key={prompt.sceneId}>
          <strong>{prompt.sceneId}. {prompt.cap}</strong>
          <p>{prompt.prompt}</p>
          <small>负面：{prompt.negativePrompt || '-'}</small>
        </div>
      ))}
    </div>
  );
}

function ImageGenerationGallery({
  api,
  task,
  scenes,
  imagePrompts,
  images,
  concurrency,
  isBrowserPreview,
  applyState,
}: {
  api: StoryboundApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  imagePrompts: NonNullable<TaskArtifactSnapshot['artifact']['imagePrompts']>;
  images: TaskArtifactSnapshot['assets']['images'];
  concurrency: number;
  isBrowserPreview: boolean;
  applyState: (state: AppState) => void;
}) {
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({});
  const [imagePreviewErrors, setImagePreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const imagePaths = images.map((asset) => asset.path).join('|');

  useEffect(() => {
    if (isBrowserPreview || images.length === 0) {
      setImagePreviewUrls({});
      setImagePreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(images.map((asset) => asset.path));
    setImagePreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setImagePreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of images) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setImagePreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setImagePreviewErrors((current) => ({ ...current, [asset.path]: error instanceof Error ? error.message : String(error) }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, imagePaths, isBrowserPreview]);

  async function regenerate(sceneId: number) {
    setRegeneratingSceneId(sceneId);
    try {
      applyState(await api.regenerateTaskImage(task.id, sceneId));
    } finally {
      setRegeneratingSceneId(null);
    }
  }

  if (scenes.length === 0) return <ArtifactEmpty text="等待分镜后生成图片" />;

  return (
    <div className="image-generation-gallery">
      <div className="image-generation-toolbar">
        <span>并发数 {concurrency}</span>
        <span>{images.length}/{scenes.length} 张已落盘</span>
      </div>
      <div className="image-preview-grid">
        {scenes.map((scene) => {
          const image = images.find((item) => item.sceneId === scene.id);
          const prompt = imagePrompts.find((item) => item.sceneId === scene.id);
          const previewUrl = image ? imagePreviewUrls[image.path] : '';
          const previewError = image ? imagePreviewErrors[image.path] : '';
          return (
            <article className={`image-preview-card ${image ? 'ready' : 'pending'}`} key={scene.id}>
              <div className="image-thumb">
                {previewUrl ? <img src={previewUrl} alt={`Scene ${scene.id}`} /> : null}
                {!previewUrl && image && !previewError ? <span className="thumb-state">读取中</span> : null}
                {!previewUrl && previewError ? <span className="thumb-state danger">读取失败</span> : null}
                {!image ? <ImageIcon size={24} /> : null}
              </div>
              <div className="image-preview-body">
                <div className="image-preview-title">
                  <strong>{scene.id}. {scene.cap}</strong>
                  <span>{image ? '已生成' : task.status === 'running' ? '等待/生成中' : '未生成'}</span>
                </div>
                <p>{prompt ? trimForPreview(prompt.prompt, 180) : scene.descPrompt}</p>
                {image ? <small>{image.path}</small> : <small>等待 provider 返回真实图片</small>}
                {previewError ? <small className="danger-text">{previewError}</small> : null}
              </div>
              <button
                className="mini-button"
                disabled={isBrowserPreview || task.status === 'running' || task.status === 'pending' || !image || regeneratingSceneId === scene.id}
                onClick={() => regenerate(scene.id)}
              >
                {regeneratingSceneId === scene.id ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
                重新生成
              </button>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function NarrationPreviewList({
  api,
  task,
  scenes,
  subtitles,
  assets,
  empty,
  isBrowserPreview,
  applyState,
}: {
  api: StoryboundApi;
  task: Task;
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  subtitles: TaskArtifactSnapshot['artifact']['subtitles'];
  assets: TaskArtifactSnapshot['assets']['narration'];
  empty: string;
  isBrowserPreview: boolean;
  applyState: (state: AppState) => void;
}) {
  const [audioPreviewUrls, setAudioPreviewUrls] = useState<Record<string, string>>({});
  const [audioPreviewErrors, setAudioPreviewErrors] = useState<Record<string, string>>({});
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<number | null>(null);
  const audioPaths = assets.map((asset) => asset.path).join('|');

  useEffect(() => {
    if (isBrowserPreview || assets.length === 0) {
      setAudioPreviewUrls({});
      setAudioPreviewErrors({});
      return undefined;
    }
    let cancelled = false;
    const validPaths = new Set(assets.map((asset) => asset.path));
    setAudioPreviewUrls((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));
    setAudioPreviewErrors((current) => Object.fromEntries(Object.entries(current).filter(([path]) => validPaths.has(path))));

    for (const asset of assets) {
      api.readAssetDataUrl(asset.path)
        .then((dataUrl) => {
          if (!cancelled) {
            setAudioPreviewUrls((current) => ({ ...current, [asset.path]: dataUrl }));
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setAudioPreviewErrors((current) => ({ ...current, [asset.path]: error instanceof Error ? error.message : String(error) }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, audioPaths, assets, isBrowserPreview]);

  async function regenerate(sceneId: number) {
    setRegeneratingSceneId(sceneId);
    try {
      applyState(await api.regenerateTaskNarration(task.id, sceneId));
    } finally {
      setRegeneratingSceneId(null);
    }
  }

  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const rows = scenes.length
    ? [
        ...scenes.map((scene, index) => ({
          sceneId: scene.id,
          cap: scene.cap,
          cue: subtitles?.cues[index],
          asset: assets.find((item) => item.sceneId === scene.id),
          canRegenerate: true,
        })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({
          sceneId: asset.sceneId,
          cap: '已生成配音',
          cue: undefined,
          asset,
          canRegenerate: false,
        })),
      ]
    : assets.map((asset) => ({
        sceneId: asset.sceneId,
        cap: '已生成配音',
        cue: undefined,
        asset,
        canRegenerate: false,
      }));

  if (rows.length === 0) return <ArtifactEmpty text={empty} />;

  return (
    <div className="narration-preview-list">
      {rows.map((item) => {
        const previewUrl = item.asset ? audioPreviewUrls[item.asset.path] : '';
        const previewError = item.asset ? audioPreviewErrors[item.asset.path] : '';
        const disabled = isBrowserPreview || task.status === 'running' || task.status === 'pending' || regeneratingSceneId === item.sceneId || !item.canRegenerate;
        return (
          <article className={`narration-preview-card ${item.asset ? 'ready' : 'pending'}`} key={`${item.sceneId}-${item.asset?.path ?? 'pending'}`}>
            <div className="narration-preview-head">
              <div>
                <strong>{item.sceneId}. {item.cap}</strong>
                {item.cue ? <span>{formatMs(item.cue.startMs)} - {formatMs(item.cue.endMs)}</span> : null}
              </div>
              <span>{item.asset ? '可试听' : task.status === 'running' ? '等待/生成中' : '未生成'}</span>
            </div>
            {previewUrl ? <audio controls className="narration-player" preload="metadata" src={previewUrl} /> : null}
            {!previewUrl && item.asset && !previewError ? <div className="narration-player loading">读取音频中</div> : null}
            {!previewUrl && item.asset && previewError ? <div className="narration-player error">音频读取失败</div> : null}
            {!item.asset ? <div className="narration-player loading">等待音频落盘</div> : null}
            {item.cue ? <p>{item.cue.text}</p> : null}
            {item.asset ? <small>{item.asset.path}</small> : <small>等待 TTS 返回真实音频</small>}
            {previewError ? <small className="danger-text">{previewError}</small> : null}
            <button className="mini-button" disabled={disabled} onClick={() => regenerate(item.sceneId)}>
              {regeneratingSceneId === item.sceneId ? <Loader2 className="spin" size={14} /> : <RotateCcw size={14} />}
              {item.asset ? '重新生成配音' : '生成配音'}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function ArtifactImageGallery({
  assets,
  scenes,
  empty,
}: {
  assets: TaskArtifactSnapshot['assets']['images'];
  scenes: NonNullable<TaskArtifactSnapshot['artifact']['scenes']>;
  empty: string;
}) {
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const galleryItems = scenes.length
    ? [
        ...scenes.map((scene) => ({ sceneId: scene.id, cap: scene.cap, asset: assets.find((item) => item.sceneId === scene.id) })),
        ...assets.filter((asset) => !sceneIds.has(asset.sceneId)).map((asset) => ({ sceneId: asset.sceneId, cap: '已生成图片', asset })),
      ]
    : assets.map((asset) => ({ sceneId: asset.sceneId, cap: '已生成图片', asset }));
  if (galleryItems.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-image-gallery">
      {galleryItems.map((item) => {
        const imagePath = item.asset?.path ?? '';
        return (
          <figure className={imagePath ? 'artifact-image-card' : 'artifact-image-card pending'} key={`${item.sceneId}-${imagePath || 'pending'}`}>
            {imagePath ? (
              <img src={toLocalImageUrl(imagePath)} alt={`分镜 ${item.sceneId}: ${item.cap}`} loading="lazy" />
            ) : (
              <div className="artifact-image-pending">
                <ImageIcon size={22} />
                <span>等待生成</span>
              </div>
            )}
            <figcaption>
              <strong>{item.sceneId}. {item.cap}</strong>
              <span>{imagePath || '等待生成'}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function ArtifactAssetList({ assets, empty }: { assets: TaskArtifactSnapshot['assets']['images']; empty: string }) {
  if (assets.length === 0) return <ArtifactEmpty text={empty} />;
  return (
    <div className="artifact-path-list">
      {assets.map((asset) => <span key={`${asset.sceneId}-${asset.path}`}>{asset.sceneId}. {asset.path}</span>)}
    </div>
  );
}

function ImageLabPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [tab, setTab] = useState<'text' | 'reference'>('text');
  const [prompt, setPrompt] = useState('唐代宫殿中的武则天，电影级写实光影，统一角色');
  const [ratio, setRatio] = useState('9:16');
  const [style, setStyle] = useState('photo-real');
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('2K');
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [generating, setGenerating] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function addRecord() {
    if (generating) return;
    setGenerating(true);
    setSubmitError('');
    try {
      const next = await api.generateImageLab({
        prompt,
        ratio,
        style,
        resolution,
        referenceImagePath: tab === 'reference' ? referenceImagePath : '',
      });
      applyState(next);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="two-column lab-layout">
      <section className="panel">
        <Segmented label="模式" value={tab} options={['text', 'reference']} labels={['文生图', '图像参考']} onChange={(value) => setTab(value as 'text' | 'reference')} />
        <Field label="提示词">
          <textarea className="prompt-box" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </Field>
        {tab === 'reference' ? (
          <Field label="参考图">
            <input value={referenceImagePath} placeholder="本地图片路径" onChange={(event) => setReferenceImagePath(event.target.value)} />
          </Field>
        ) : null}
        <OptionCloud title="风格" options={styleOptions} value={style} onChange={setStyle} />
        <Segmented label="比例" value={ratio} options={ratioOptions} onChange={setRatio} />
        <Segmented label="分辨率" value={resolution} options={['1K', '2K', '4K']} onChange={(value) => setResolution(value as '1K' | '2K' | '4K')} />
        <div className="provider-line">Provider：{state.config.imageProvider} · {resolution} · {ratio}</div>
        {submitError ? <ErrorSummaryButton compact title="画图实验室提交失败" fullMessage={submitError} /> : null}
        <button className="primary-action" onClick={addRecord} disabled={generating || !prompt.trim()}>
          {generating ? <Loader2 className="spin" size={17} /> : <ImageIcon size={17} />}
          {generating ? '生成中' : '开始生成'}
        </button>
      </section>
      <section className="image-grid-panel">
        {state.imageLabRecords.length === 0 ? <EmptyState title="暂无画图记录" /> : null}
        {state.imageLabRecords.map((record) => (
          <article className={`image-record ${record.status}`} key={record.id}>
            <div className="lab-image-preview">
              {record.imagePath ? <img src={toLocalImageUrl(record.imagePath)} alt={record.prompt} loading="lazy" /> : (
                <>
                  <ImageIcon size={28} />
                  <span>{record.status === 'failed' ? '生成失败' : '等待图片'}</span>
                </>
              )}
            </div>
            <strong>{record.prompt}</strong>
            <small>{record.provider} · {record.ratio} · {record.resolution} · {formatDate(record.createdAt)}</small>
            {record.errorMessage ? <ErrorSummaryButton compact title="生图失败" fullMessage={record.errorMessage} /> : null}
          </article>
        ))}
      </section>
    </div>
  );
}

function PromptTemplatesPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [selectedId, setSelectedId] = useState(state.promptTemplates[0]?.id ?? '');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<PromptTemplateType | 'all'>('all');
  const [templateTrackFilter, setTemplateTrackFilter] = useState('all');
  const filteredTemplates = state.promptTemplates.filter((template) => {
    const typeMatches = templateTypeFilter === 'all' || template.type === templateTypeFilter;
    const trackMatches = templateTrackFilter === 'all' || template.baseTrack === templateTrackFilter;
    return typeMatches && trackMatches;
  });
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? filteredTemplates[0] ?? state.promptTemplates[0];
  const [draft, setDraft] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const [importJson, setImportJson] = useState('');

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected?.id]);

  async function savePromptTemplateDraft() {
    if (!draft) return;
    const templateToSave: PromptTemplate = draft.isBuiltin
      ? {
          ...draft,
          id: crypto.randomUUID(),
          name: `${draft.name} 自定义`,
          isBuiltin: false,
          origin: 'custom',
          baseTemplateId: draft.id,
          updatedAt: new Date().toISOString(),
        }
      : { ...draft, updatedAt: new Date().toISOString() };
    applyState(await api.savePromptTemplate(templateToSave));
    setSelectedId(templateToSave.id);
  }

  async function duplicate() {
    if (!draft) return;
    const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} 副本`, isBuiltin: false, origin: 'custom' as const, baseTemplateId: draft.baseTemplateId ?? draft.id };
    applyState(await api.savePromptTemplate(copy));
    setSelectedId(copy.id);
  }

  async function createPromptTemplate() {
    const template: PromptTemplate = {
      id: crypto.randomUUID(),
      name: '新建模板',
      type: 'task',
      description: '本地自定义提示词模板',
      content: '请基于 {{inputText}} 生成适合 {{track}} 的短视频内容。',
      isBuiltin: false,
      updatedAt: new Date().toISOString(),
      baseTrack: 'general-story',
      defaultStyles: ['写实彩色'],
      characterPolicy: 'follow-template',
      step3SkeletonModules: ['防台词文字'],
      referenceKind: 'none',
      origin: 'custom',
      marketTags: [],
    };
    applyState(await api.savePromptTemplate(template));
    setSelectedId(template.id);
  }

  function exportPromptTemplateJson() {
    if (!draft) return;
    const json = JSON.stringify(draft, null, 2);
    setImportJson(json);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
  }

  async function importTemplate() {
    try {
      const imported = JSON.parse(importJson) as PromptTemplate;
      const next = { ...imported, id: imported.id || crypto.randomUUID(), isBuiltin: false, origin: 'custom' as const, updatedAt: new Date().toISOString() };
      applyState(await api.savePromptTemplate(next));
      setSelectedId(next.id);
      setImportJson('');
    } catch {
      setImportJson('{"name":"自定义模板","type":"task","description":"请补充","content":"请补充提示词"}');
    }
  }

  return (
    <div className="templates-layout">
      <section className="template-list">
        <div className="panel-title-row compact">
          <h2>系统模板</h2>
          <div className="button-row">
            <button className="ghost-action" onClick={createPromptTemplate}><Plus size={14} />新建模板</button>
            <button className="ghost-action" onClick={async () => applyState(await api.resetPromptTemplates())}>
              <RotateCcw size={14} />
              重置
            </button>
          </div>
        </div>
        <div className="template-filter-row">
          <Field label="类型筛选">
            <select value={templateTypeFilter} onChange={(event) => setTemplateTypeFilter(event.target.value as PromptTemplateType | 'all')}>
              {promptTemplateTypeOptions.map((type) => <option key={type} value={type}>{type === 'all' ? '全部类型' : type}</option>)}
            </select>
          </Field>
          <Field label="赛道筛选">
            <select value={templateTrackFilter} onChange={(event) => setTemplateTrackFilter(event.target.value)}>
              <option value="all">全部赛道</option>
              {contentTracks.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </Field>
        </div>
        {filteredTemplates.map((template) => (
          <button key={template.id} className={selectedId === template.id ? 'template-card active' : 'template-card'} onClick={() => setSelectedId(template.id)}>
            <Sparkles size={16} />
            <strong>{template.name}</strong>
            <span>{template.description}</span>
            <small>{template.isBuiltin ? '查看 / 克隆' : '自定义'}</small>
          </button>
        ))}
      </section>
      <section className="panel editor-panel">
        {draft ? (
          <>
            <div className="panel-title-row">
              <h2>查看系统模板 · {draft.name}</h2>
              <div className="button-row">
                <button className="ghost-action" onClick={duplicate}>
                  <Copy size={15} />
                  克隆
                </button>
                <button className="ghost-action" onClick={exportPromptTemplateJson}>
                  <FileJson size={15} />
                  导出 JSON
                </button>
                <button className="ghost-action" onClick={importTemplate}>
                  <FileJson size={15} />
                  导入 JSON
                </button>
                <button className="primary-action slim" onClick={savePromptTemplateDraft}>
                  <Save size={15} />
                  保存
                </button>
              </div>
            </div>
            <div className="template-meta-grid">
              <Field label="模板名">
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </Field>
              <Field label="描述（一句话说明这个模板的特点）">
                <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
              </Field>
              <Field label="模板类型">
                <select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as PromptTemplateType })}>
                  {promptTemplateTypeOptions.filter((type) => type !== 'all').map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="绑定赛道">
                <select value={draft.baseTrack ?? ''} onChange={(event) => setDraft({ ...draft, baseTrack: event.target.value || undefined })}>
                  <option value="">无</option>
                  {contentTracks.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
            </div>
            {draft.isBuiltin ? <span className="local-note">首次保存将创建自定义副本，原内置模板保持不变。</span> : null}
            <span className="field-title">变量</span>
            <div className="variable-chip-row">{promptTemplateVariables.map((item) => <button className="chip" type="button" key={item} onClick={() => setDraft({ ...draft, content: `${draft.content}${draft.content.endsWith(' ') || draft.content.endsWith('\n') ? '' : ' '}{{${item}}}` })}>{`{{${item}}}`}</button>)}</div>
            <span className="field-title">默认画风</span>
            <Field label="默认画风">
              <input value={(draft.defaultStyles ?? []).join('、')} onChange={(event) => setDraft({ ...draft, defaultStyles: splitListInput(event.target.value) })} />
            </Field>
            <span className="field-title">主角档案</span>
            <div className="chip-row">
              {(['follow-template', 'force-extract', 'force-skip'] as const).map((policy) => (
                <button className={draft.characterPolicy === policy ? 'chip active' : 'chip'} type="button" key={policy} onClick={() => setDraft({ ...draft, characterPolicy: policy })}>
                  {policy === 'force-extract' ? '强制提取' : policy === 'force-skip' ? '强制跳过' : '跟随赛道'}
                </button>
              ))}
            </div>
            <Field label="Step 3 骨架模块">
              <input value={(draft.step3SkeletonModules ?? []).join('、')} onChange={(event) => setDraft({ ...draft, step3SkeletonModules: splitListInput(event.target.value) })} />
            </Field>
            <Field label="参考图类型">
              <select value={draft.referenceKind ?? 'none'} onChange={(event) => setDraft({ ...draft, referenceKind: event.target.value as PromptTemplate['referenceKind'] })}>
                <option value="none">无</option>
                <option value="face">人脸</option>
                <option value="product">产品</option>
              </select>
            </Field>
            <Field label="标签">
              <input value={(draft.marketTags ?? []).join('、')} onChange={(event) => setDraft({ ...draft, marketTags: splitListInput(event.target.value) })} />
            </Field>
            <Field label="baseTemplateId">
              <input value={draft.baseTemplateId ?? ''} onChange={(event) => setDraft({ ...draft, baseTemplateId: event.target.value || null })} />
            </Field>
            <Field label="提示词内容">
              <textarea className="template-textarea" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
            </Field>
            <Field label="导入 JSON">
              <textarea className="small-textarea" value={importJson} onChange={(event) => setImportJson(event.target.value)} placeholder="粘贴模板 JSON 后点击导入 JSON" />
            </Field>
          </>
        ) : (
          <EmptyState title="暂无模板" />
        )}
      </section>
    </div>
  );
}

function DraftTemplatesPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingTemplate = editingId ? state.draftTemplates.find((template) => template.id === editingId) ?? null : null;
  const [draft, setDraft] = useState<DraftTemplate | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<DraftCanvasLayer>('title');
  const [effectCatalog, setEffectCatalog] = useState<JianyingEffectCatalog>(fallbackEffectCatalog);

  useEffect(() => {
    // Rehydrate only when switching templates; state refreshes must not overwrite unsaved drag edits.
    const currentEditingTemplate = state.draftTemplates.find((template) => template.id === editingId) ?? null;
    setDraft(currentEditingTemplate ? cloneDraftTemplate(currentEditingTemplate) : null);
  }, [editingId]);

  useEffect(() => {
    let disposed = false;
    api
      .getJianyingEffectCatalog()
      .then((catalog) => {
        if (!disposed) setEffectCatalog(catalog);
      })
      .catch(() => {
        if (!disposed) setEffectCatalog(fallbackEffectCatalog);
      });
    return () => {
      disposed = true;
    };
  }, [api]);

  async function save() {
    if (draft) applyState(await api.saveDraftTemplate(draft));
  }

  async function copyTemplate(template: DraftTemplate) {
    const copy = { ...cloneDraftTemplate(template), id: crypto.randomUUID(), name: `${template.name} 副本`, isDefault: false };
    applyState(await api.saveDraftTemplate(copy));
    setEditingId(copy.id);
  }

  async function createTemplate() {
    const base = cloneDraftTemplate(builtinDraftTemplates[0]);
    const next = { ...base, id: crypto.randomUUID(), name: '新模板', isDefault: false };
    applyState(await api.saveDraftTemplate(next));
    setEditingId(next.id);
  }

  function openEditor(template: DraftTemplate) {
    setDraft(cloneDraftTemplate(template));
    setEditingId(template.id);
  }

  async function selectDraftBackgroundImage() {
    const imagePath = await api.selectLocalImage();
    if (!imagePath) return;
    setDraft((current) => (current ? { ...current, canvas: { ...current.canvas, backgroundImage: imagePath } } : current));
  }

  if (editingId && draft) {
    return (
      <div className="draft-template-page">
        <div className="editor-topbar">
          <button className="ghost-action" onClick={() => setEditingId(null)}>返回模板列表</button>
          <input className="template-name-input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraft(editingTemplate ? cloneDraftTemplate(editingTemplate) : draft)}>取消</button>
            <button className="primary-action slim" onClick={save}><Save size={15} />保存</button>
          </div>
        </div>

        <div className="draft-editor-shell focused">
          <section className="draft-stage">
            <div className="panel-title-row">
              <div>
                <h2>{draft.name}</h2>
                <span className="hint-text">{draft.canvas.ratio} · {draft.canvas.width}x{draft.canvas.height} · {draft.image.animation}</span>
              </div>
              <button className="ghost-action" onClick={() => copyTemplate(draft)}><Copy size={15} />复制</button>
            </div>
            <EditableDraftCanvas template={draft} selectedLayer={selectedLayer} onSelectLayer={setSelectedLayer} onChange={setDraft} />
          </section>

          <section className="panel draft-controls">
            <Accordion title="画布设置" open>
              <Segmented label="比例" value={draft.canvas.ratio} options={['9:16', '4:3', '1:1', '16:9']} onChange={(value) => setDraft(applyDraftCanvasRatio(draft, value))} />
              <Field label="尺寸"><input value={`${draft.canvas.width}x${draft.canvas.height}`} readOnly /></Field>
              <Field label="底色">
                <div className="draft-background-field with-swatch">
                  <input className="draft-background-swatch" type="color" value={normalizeColorInput(draft.canvas.backgroundColor)} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                  <input value={draft.canvas.backgroundColor} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} />
                </div>
              </Field>
              <Field label="背景图">
                <div className="draft-background-field">
                  <input value={draft.canvas.backgroundImage} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: event.target.value } })} placeholder="留空 = 无背景图" />
                  <button className="ghost-action" type="button" onClick={selectDraftBackgroundImage}><FolderOpen size={14} />浏览</button>
                  <button className="ghost-action" type="button" onClick={() => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: '' } })}>清空</button>
                </div>
              </Field>
            </Accordion>
            <Accordion title="图片区域" open>
              <Segmented label="图片比例" value={draft.image.ratio} options={['9:16', '4:3', '16:9']} onChange={(value) => setDraft(applyDraftImageRatio(draft, value))} />
              <Segmented label="适配" value={draft.image.fit} options={['cover', 'contain']} onChange={(value) => setDraft({ ...draft, image: { ...draft.image, fit: value as 'cover' | 'contain' } })} />
              <Field label="坐标"><input value={`top ${draft.image.top.toFixed(2)}, height ${draft.image.height.toFixed(2)}`} readOnly /></Field>
              <Field label="垂直位置"><input type="range" min="-1" max="1" step="0.01" value={draft.image.top} onChange={(event) => setDraft({ ...draft, image: { ...draft.image, top: Number(event.target.value) } })} /></Field>
              <Field label="高度占比"><input type="range" min="0.1" max="1" step="0.01" value={draft.image.height} onChange={(event) => setDraft({ ...draft, image: { ...draft.image, height: Number(event.target.value) } })} /></Field>
              <Segmented label="动画效果" value={draft.image.animation} options={imageAnimations.slice(0, 8)} onChange={(value) => setDraft({ ...draft, image: { ...draft.image, animation: value } })} />
            </Accordion>
            <Accordion title="主标题">
              <Field label="文字"><input value={draft.title.text} onChange={(event) => setDraft({ ...draft, title: { ...draft.title, text: event.target.value } })} /></Field>
              <Field label="坐标"><input value={`${draft.title.x.toFixed(2)}, ${draft.title.y.toFixed(2)}`} readOnly /></Field>
              <Field label="字号"><input type="number" value={draft.title.fontSize} onChange={(event) => setDraft({ ...draft, title: { ...draft.title, fontSize: Number(event.target.value) } })} /></Field>
              <Field label="颜色"><input value={draft.title.color} onChange={(event) => setDraft({ ...draft, title: { ...draft.title, color: event.target.value } })} /></Field>
            </Accordion>
            <Accordion title="副标题"><Field label="坐标"><input value={`${draft.subtitle.x.toFixed(2)}, ${draft.subtitle.y.toFixed(2)}`} readOnly /></Field><Field label="字号"><input type="number" value={draft.subtitle.fontSize} onChange={(event) => setDraft({ ...draft, subtitle: { ...draft.subtitle, fontSize: Number(event.target.value) } })} /></Field></Accordion>
            <Accordion title="字幕"><Field label="坐标"><input value={`${draft.caption.x.toFixed(2)}, ${draft.caption.y.toFixed(2)}`} readOnly /></Field><Field label="字号"><input type="number" value={draft.caption.fontSize} onChange={(event) => setDraft({ ...draft, caption: { ...draft.caption, fontSize: Number(event.target.value) } })} /></Field></Accordion>
            <Accordion title="免责声明"><Field label="坐标"><input value={`${draft.disclaimer.x.toFixed(2)}, ${draft.disclaimer.y.toFixed(2)}`} readOnly /></Field><Field label="文字"><input value={draft.disclaimer.text} onChange={(event) => setDraft({ ...draft, disclaimer: { ...draft.disclaimer, text: event.target.value } })} /></Field></Accordion>
            <Accordion title="音频设置">
              <Field label="旁白音量"><input type="number" value={draft.audio.narrationVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationVolume: Number(event.target.value) } })} /></Field>
              <Field label="BGM 音量"><input type="number" value={draft.audio.bgmVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmVolume: Number(event.target.value) } })} /></Field>
              <Field label="转场">
                <select value={draft.audio.transitionType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.transitions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="转场时长(ms)"><input type="number" value={draft.audio.transitionDurationMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, transitionDurationMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡入(ms)"><input type="number" value={draft.audio.narrationFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="旁白淡出(ms)"><input type="number" value={draft.audio.narrationFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡入(ms)"><input type="number" value={draft.audio.bgmFadeInMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeInMs: Number(event.target.value) } })} /></Field>
              <Field label="BGM 淡出(ms)"><input type="number" value={draft.audio.bgmFadeOutMs} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmFadeOutMs: Number(event.target.value) } })} /></Field>
              <Field label="滤镜">
                <select value={draft.audio.filterType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, filterType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.filters.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="视频特效">
                <select value={draft.audio.videoEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, videoEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.videoEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
              <Field label="音频特效">
                <select value={draft.audio.audioEffectType} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, audioEffectType: event.target.value } })}>
                  <option value="">关闭</option>
                  {effectCatalog.audioEffects.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </Field>
            </Accordion>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-template-page">
      <div className="panel-title-row draft-template-toolbar">
        <div>
          <h2>草稿模板</h2>
          <span className="hint-text">内置模板：默认竖屏、竖屏4:3、横屏16:9；自定义模板保存在本机。</span>
        </div>
        <button className="primary-action slim" onClick={createTemplate}><Plus size={15} />新模板</button>
      </div>

      <section className="draft-template-gallery">
        {state.draftTemplates.map((template) => (
          <article key={template.id} className="draft-template-card">
            <button className="draft-template-thumb" onClick={() => openEditor(template)} type="button" aria-label={`编辑 ${template.name}`}>
              <DraftTemplatePreview template={template} compact />
            </button>
            <div className="draft-template-meta">
              <div>
                <strong>{template.name}</strong>
                {template.isDefault ? <small>系统默认</small> : <small>本地自定义</small>}
              </div>
              <span>{template.canvas.ratio} · {template.canvas.width}x{template.canvas.height}</span>
              <span>图片 {template.image.ratio} · {template.image.fit} · {template.image.animation}</span>
            </div>
            <div className="row-actions">
              <button className="ghost-action" onClick={() => openEditor(template)}><LayoutTemplate size={15} />编辑</button>
              <button className="ghost-action" onClick={() => copyTemplate(template)}><Copy size={15} />复制</button>
            </div>
          </article>
        ))}
        <button className="draft-template-card new-template-card" onClick={createTemplate} type="button">
          <Plus size={24} />
          <strong>新模板</strong>
          <span>从默认竖屏复制一份本地配置</span>
        </button>
      </section>
    </div>
  );
}

function DraftTemplatePreview({ template, compact = false }: { template: DraftTemplate; compact?: boolean }) {
  const titleSize = compact ? Math.max(9, template.title.fontSize * 0.28) : template.title.fontSize;
  const subtitleSize = compact ? Math.max(7, template.subtitle.fontSize * 0.28) : template.subtitle.fontSize;
  const captionSize = compact ? Math.max(7, template.caption.fontSize * 0.42) : template.caption.fontSize;
  return (
    <div className={compact ? 'draft-preview-mini' : 'draft-preview-large'} style={draftTemplateCanvasStyle(template)}>
      <div className="draft-image" style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}>
        <div className="draft-image-media" style={draftImageMediaStyle(template)} />
      </div>
      {template.title.visible ? <DraftCanvasText className="draft-title" x={template.title.x} y={template.title.y} style={{ color: template.title.color, fontSize: titleSize, fontWeight: 800 }}>{template.title.text}</DraftCanvasText> : null}
      {template.subtitle.visible ? <DraftCanvasText className="draft-subtitle" x={template.subtitle.x} y={template.subtitle.y} style={{ color: template.subtitle.color, fontSize: subtitleSize }}>副标题示例文字</DraftCanvasText> : null}
      {template.caption.visible ? <DraftCanvasText className="draft-caption" x={template.caption.x} y={template.caption.y} style={{ color: template.caption.color, fontSize: captionSize }}>字幕预览</DraftCanvasText> : null}
      {template.disclaimer.visible ? <DraftCanvasText className="draft-disclaimer" x={template.disclaimer.x} y={template.disclaimer.y}>{template.disclaimer.text}</DraftCanvasText> : null}
    </div>
  );
}

function EditableDraftCanvas({
  template,
  selectedLayer,
  onSelectLayer,
  onChange,
}: {
  template: DraftTemplate;
  selectedLayer: DraftCanvasLayer;
  onSelectLayer: (layer: DraftCanvasLayer) => void;
  onChange: (template: DraftTemplate) => void;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DraftDragSnapshot | null>(null);

  function handleDraftCanvasPointerDown(layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelectLayer(layer);
    dragRef.current = {
      layer,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      template: cloneDraftTemplate(template),
    } as DraftDragSnapshot;
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!drag || !rect || drag.pointerId !== event.pointerId) return;
    const deltaX = ((event.clientX - drag.startX) / rect.width) * 2;
    const deltaY = ((event.clientY - drag.startY) / rect.height) * 2;
    onChange(updateDraftLayerPosition(drag.template, drag.layer, deltaX, deltaY));
  }

  function stopDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      ref={canvasRef}
      className="editable-draft-canvas draft-preview-large"
      style={draftTemplateCanvasStyle(template)}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <div
        className={selectedLayer === 'image' ? 'draft-layer image-layer selected' : 'draft-layer image-layer'}
        data-layer="image"
        style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }}
        onPointerDown={(event) => handleDraftCanvasPointerDown('image', event)}
      >
        <div className="draft-image-media" style={draftImageMediaStyle(template)} />
        <span>图片区域</span>
        <i className="draft-layer-handle" />
      </div>
      {template.title.visible ? (
        <DraftCanvasLayerBox layer="title" label="主标题" selected={selectedLayer === 'title'} x={template.title.x} y={template.title.y} onPointerDown={handleDraftCanvasPointerDown}>
          <DraftCanvasText className="draft-title" x={0} y={0} style={{ color: template.title.color, fontSize: template.title.fontSize, fontWeight: 800 }}>{template.title.text}</DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.subtitle.visible ? (
        <DraftCanvasLayerBox layer="subtitle" label="副标题" selected={selectedLayer === 'subtitle'} x={template.subtitle.x} y={template.subtitle.y} onPointerDown={handleDraftCanvasPointerDown}>
          <DraftCanvasText className="draft-subtitle" x={0} y={0} style={{ color: template.subtitle.color, fontSize: template.subtitle.fontSize }}>副标题示例文字</DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.caption.visible ? (
        <DraftCanvasLayerBox layer="caption" label="字幕" selected={selectedLayer === 'caption'} x={template.caption.x} y={template.caption.y} onPointerDown={handleDraftCanvasPointerDown}>
          <DraftCanvasText className="draft-caption" x={0} y={0} style={{ color: template.caption.color, fontSize: template.caption.fontSize }}>字幕预览</DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
      {template.disclaimer.visible ? (
        <DraftCanvasLayerBox layer="disclaimer" label="免责声明" selected={selectedLayer === 'disclaimer'} x={template.disclaimer.x} y={template.disclaimer.y} onPointerDown={handleDraftCanvasPointerDown}>
          <DraftCanvasText className="draft-disclaimer" x={0} y={0}>{template.disclaimer.text}</DraftCanvasText>
        </DraftCanvasLayerBox>
      ) : null}
    </div>
  );
}

function DraftCanvasLayerBox({
  layer,
  label,
  selected,
  x,
  y,
  onPointerDown,
  children,
}: {
  layer: Exclude<DraftCanvasLayer, 'image'>;
  label: string;
  selected: boolean;
  x: number;
  y: number;
  onPointerDown: (layer: DraftCanvasLayer, event: React.PointerEvent<HTMLDivElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={selected ? 'draft-layer text-layer selected' : 'draft-layer text-layer'}
      data-layer={layer}
      style={draftLayerPositionStyle(x, y)}
      onPointerDown={(event) => onPointerDown(layer, event)}
    >
      <span>{label}</span>
      {children}
      <i className="draft-layer-handle" />
    </div>
  );
}

function SettingsPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [section, setSection] = useState('llm');
  const [draft, setDraft] = useState<AppConfig>(() => normalizeEditableConfigProviders(state.config));
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [lastAppliedConfigSignature, setLastAppliedConfigSignature] = useState(() => settingsConfigSignature(state.config));
  const [diagnostics, setDiagnostics] = useState('');
  const [configTestResult, setConfigTestResult] = useState('');
  const [testingConfig, setTestingConfig] = useState(false);
  const [modelLists, setModelLists] = useState<Record<ModelListKey, ProviderModel[]>>({ llm: [], 'gpt-image': [], 'custom-image': [] });
  const [modelListStatus, setModelListStatus] = useState<Partial<Record<ModelListKey, string>>>({});
  const [loadingModelList, setLoadingModelList] = useState<ModelListKey | null>(null);
  const [volcengineSpeakers, setVolcengineSpeakers] = useState<VolcengineSpeaker[]>([]);
  const [volcengineSpeakerStatus, setVolcengineSpeakerStatus] = useState('');
  const [loadingVolcengineSpeakers, setLoadingVolcengineSpeakers] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedLlmProfileId, setSelectedLlmProfileId] = useState(() => activeLlmProfileId(state.config));
  const [selectedImageProfileId, setSelectedImageProfileId] = useState(() => activeImageProfileId(state.config));
  const [selectedTtsProfileId, setSelectedTtsProfileId] = useState(() => activeTtsProfileId(state.config));
  useEffect(() => {
    if (settingsDirty) return;
    const nextSignature = settingsConfigSignature(state.config);
    if (nextSignature === lastAppliedConfigSignature) return;
    setDraft(normalizeEditableConfigProviders(state.config));
    setLastAppliedConfigSignature(nextSignature);
  }, [lastAppliedConfigSignature, settingsDirty, state.config]);
  function setSettingsDraft(next: AppConfig | ((current: AppConfig) => AppConfig)) {
    setSettingsDirty(true);
    setDraft(next);
  }
  function commitSettingsDraft(next: AppConfig) {
    const normalized = normalizeEditableConfigProviders(next);
    setDraft(normalized);
    setSettingsDirty(false);
    setLastAppliedConfigSignature(settingsConfigSignature(normalized));
  }
  async function commitAndApplySettingsDraft(nextDraft: AppConfig, successMessage = '配置已保存') {
    setSavingConfig(true);
    try {
      const next = await api.saveConfig(normalizeEditableConfigProviders(nextDraft));
      commitSettingsDraft(next.config);
      applyState(next);
      setConfigTestResult(`[pass] ${successMessage}`);
      return next.config;
    } catch (error) {
      setConfigTestResult(`[fail] ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      setSavingConfig(false);
    }
  }
  function clearProviderModels(key: ModelListKey) {
    setModelLists((current) => ({ ...current, [key]: [] }));
    setModelListStatus((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  async function save() {
    await commitAndApplySettingsDraft(draft);
  }
  async function activateLlmProfile(id: string) {
    await commitAndApplySettingsDraft(enableLlmProfile(draft, id), '已启用 LLM 配置档案');
  }
  async function activateImageProfile(id: string) {
    await commitAndApplySettingsDraft(enableImageProfile(draft, id), '已启用绘图配置档案');
  }
  async function activateTtsProfile(id: string) {
    await commitAndApplySettingsDraft(enableTtsProfile(draft, id), '已启用 TTS 配置档案');
  }
  async function testCurrentConfig() {
    const target: ConfigTestTarget = section === 'llm' || section === 'image' || section === 'tts' || section === 'jianying' || section === 'creative' ? section : 'llm';
    setTestingConfig(true);
    setSavingConfig(true);
    setConfigTestResult('正在保存并测试当前配置...');
    try {
      const next = await api.saveConfig(normalizeEditableConfigProviders(draft));
      commitSettingsDraft(next.config);
      applyState(next);
      const testConfig = buildConfigForSelectedProfileTest(next.config, target, {
        llm: selectedLlmProfileId,
        image: selectedImageProfileId,
        tts: selectedTtsProfileId,
      });
      const result = await api.testAppConfig(target, testConfig);
      setConfigTestResult(`[${result.status}] ${result.detail}`);
    } catch (error) {
      setConfigTestResult(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSavingConfig(false);
      setTestingConfig(false);
    }
  }
  async function refreshProviderModels(
    key: ModelListKey,
    request: { baseUrl: string; apiKey: string },
    currentModel: string,
    applyModel?: (config: AppConfig, model: string) => AppConfig,
  ) {
    if (key === 'custom-image' && !request.baseUrl.trim()) {
      setModelListStatus((current) => ({ ...current, [key]: '[fail] Base URL is required before fetching models.' }));
      return;
    }
    setLoadingModelList(key);
    setModelListStatus((current) => ({ ...current, [key]: '正在获取模型清单...' }));
    try {
      const result = await api.listProviderModels(request);
      setModelListStatus((current) => ({ ...current, [key]: `[${result.status}] ${result.detail}` }));
      if (result.models.length) {
        setModelLists((current) => ({ ...current, [key]: result.models }));
        if (!currentModel.trim()) {
          setSettingsDraft((current) => (applyModel ? applyModel(current, result.models[0].id) : setDraftModel(current, key, result.models[0].id)));
        }
      }
    } catch (error) {
      setModelListStatus((current) => ({ ...current, [key]: `[fail] ${error instanceof Error ? error.message : String(error)}` }));
    } finally {
      setLoadingModelList((current) => (current === key ? null : current));
    }
  }
  async function refreshVolcengineSpeakers(profile: TtsProviderProfile) {
    const volcengine = ttsProfileVolcengine(profile);
    const accessKeyId = (volcengine.accessKeyId ?? '').trim();
    const secretAccessKey = (volcengine.secretAccessKey ?? '').trim();
    if (!accessKeyId || !secretAccessKey) {
      setVolcengineSpeakerStatus('[fail] AccessKey ID 和 SecretAccessKey 是加载火山音色列表必填项。');
      return;
    }

    const resourceId = (volcengine.resourceId ?? '').trim() || 'seed-tts-2.0';
    const limit = 100;
    setLoadingVolcengineSpeakers(true);
    setVolcengineSpeakerStatus('正在加载全部音色...');
    try {
      const first = await api.listVolcengineSpeakers({ accessKeyId, secretAccessKey, resourceId, page: 1, limit });
      let speakers = mergeVolcengineSpeakers([], first.speakers);
      const total = first.total || speakers.length;
      if (first.status !== 'fail' && total > speakers.length) {
        const pageCount = Math.min(Math.ceil(total / limit), 20);
        for (let page = 2; page <= pageCount; page += 1) {
          const next = await api.listVolcengineSpeakers({ accessKeyId, secretAccessKey, resourceId, page, limit });
          if (next.status === 'fail' || !next.speakers.length) break;
          speakers = mergeVolcengineSpeakers(speakers, next.speakers);
          if (speakers.length >= total) break;
        }
      }
      setVolcengineSpeakers(speakers);
      const loadedText = speakers.length > first.speakers.length ? `，已合并 ${speakers.length}/${total} 个` : '';
      setVolcengineSpeakerStatus(`[${first.status}] ${first.detail}${loadedText}`);
    } catch (error) {
      setVolcengineSpeakerStatus(`[fail] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoadingVolcengineSpeakers(false);
    }
  }
  async function runDiagnostics() {
    const report = await api.runDiagnostics();
    setDiagnostics(JSON.stringify(report, null, 2));
  }
  async function uploadBgmFromSettings() {
    const audioPath = await api.selectLocalAudio();
    if (!audioPath) return;
    const nextBgm = addUploadedBgm(draft, audioPath);
    await commitAndApplySettingsDraft(nextBgm.config, '已添加 BGM 文件');
  }
  function setDefaultBgm(id: string) {
    setSettingsDraft({ ...draft, jianying: { ...draft.jianying, defaultBgmId: id } });
  }
  function updateBgmVolume(id: string, volume: number) {
    setSettingsDraft({
      ...draft,
      jianying: {
        ...draft.jianying,
        bgmLibrary: draft.jianying.bgmLibrary.map((bgm) => (bgm.id === id ? { ...bgm, volume } : bgm)),
      },
    });
  }
  function removeBgm(id: string) {
    const bgmLibrary = draft.jianying.bgmLibrary.filter((bgm) => bgm.id !== id);
    const nextConfig = { ...draft, jianying: { ...draft.jianying, bgmLibrary, defaultBgmId: draft.jianying.defaultBgmId === id ? '' : draft.jianying.defaultBgmId } };
    setSettingsDraft({ ...nextConfig, jianying: { ...nextConfig.jianying, defaultBgmId: resolveDefaultBgmId(nextConfig) } });
  }
  const selectedProviderProfileIds = {
    llm: selectedLlmProfileId,
    image: selectedImageProfileId,
    tts: selectedTtsProfileId,
  };
  const selectedLlmTestConfig = buildConfigForSelectedProfileTest(draft, 'llm', selectedProviderProfileIds);
  const selectedImageTestConfig = buildConfigForSelectedProfileTest(draft, 'image', selectedProviderProfileIds);
  const selectedTtsTestConfig = buildConfigForSelectedProfileTest(draft, 'tts', selectedProviderProfileIds);
  const settingsBgms = validBgmItems(draft);
  const sections = [
    ['llm', Sparkles, 'LLM', '文案与分镜', settingsStatusLabel(configTargetStatus('llm', draft))],
    ['image', ImageIcon, 'AI 绘图', '分镜图片', settingsStatusLabel(configTargetStatus('image', draft))],
    ['tts', Bot, 'TTS 配音', '每镜语音', settingsStatusLabel(configTargetStatus('tts', draft))],
    ['jianying', FolderOpen, '剪映', '草稿目录 · BGM', settingsStatusLabel(configTargetStatus('jianying', draft))],
    ['activation', KeyRound, '激活与订阅', '试用 · 激活码', state.activation.status],
    ['creative', Wand2, 'AI 创作', 'IMA 知识库', settingsStatusLabel(configTargetStatus('creative', draft))],
    ['about', Info, '关于 · 诊断', '日志 · 重置', '已配置'],
  ] as const;
  return (
    <div className="settings-layout">
      <section className="settings-menu">
        {sections.map(([id, Icon, label, hint, status]) => (
          <button key={id} className={section === id ? 'settings-tab active' : 'settings-tab'} onClick={() => setSection(id)}>
            <Icon size={16} />
            <strong>{label}</strong>
            <span>{hint}</span>
            <small>{status}</small>
          </button>
        ))}
      </section>
      <section className="settings-content panel">
        <div className="panel-title-row">
          <div className="settings-heading">
            <div className="square-icon"><Sparkles size={18} /></div>
            <div><h2>{sections.find(([id]) => id === section)?.[2]}</h2><span>配置 API 凭证与本地路径</span></div>
          </div>
          <div className="button-row">
            <button className="ghost-action" disabled={testingConfig || savingConfig} onClick={testCurrentConfig}>
              {testingConfig ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
              保存并测试
            </button>
            <button className="primary-action slim" disabled={savingConfig} onClick={save}>
              {savingConfig ? <Loader2 className="spin" size={15} /> : <Save size={15} />}
              保存配置
            </button>
          </div>
        </div>
        {configTestResult ? <div className="test-result">{configTestResult}</div> : null}
        {section === 'llm' ? (
          <SettingsCard title="LLM 配置档案" status={maskConfigured(selectedLlmTestConfig.llm.apiKey)}>
            <LlmProfileManager
              config={draft}
              selectedProfileId={selectedLlmProfileId}
              models={modelLists.llm}
              loadingModels={loadingModelList === 'llm'}
              modelStatus={modelListStatus.llm}
              saving={savingConfig}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedLlmProfileId}
              onActivate={activateLlmProfile}
              onClearModels={() => clearProviderModels('llm')}
              onRefreshModels={(profile) => refreshProviderModels('llm', { baseUrl: profile.baseUrl, apiKey: profile.apiKey }, profile.model)}
            />
          </SettingsCard>
        ) : null}
        {section === 'image' ? (
          <SettingsCard title="AI 绘图" status={settingsStatusLabel(configTargetStatus('image', selectedImageTestConfig))}>
            <ImageProfileManager
              config={draft}
              selectedProfileId={selectedImageProfileId}
              gptModels={modelLists['gpt-image']}
              customModels={modelLists['custom-image']}
              loadingModelList={loadingModelList}
              modelStatus={modelListStatus}
              saving={savingConfig}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedImageProfileId}
              onActivate={activateImageProfile}
              onClearModels={clearProviderModels}
              onRefreshModels={refreshProviderModels}
            />
          </SettingsCard>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="TTS 配音" status={settingsStatusLabel(configTargetStatus('tts', selectedTtsTestConfig))}>
            <TtsProfileManager
              config={draft}
              selectedProfileId={selectedTtsProfileId}
              cloneVoiceCount={state.minimaxCloneVoices.length}
              volcengineSpeakers={volcengineSpeakers}
              loadingVolcengineSpeakers={loadingVolcengineSpeakers}
              volcengineSpeakerStatus={volcengineSpeakerStatus}
              saving={savingConfig}
              onChange={setSettingsDraft}
              onSelectedProfileIdChange={setSelectedTtsProfileId}
              onActivate={activateTtsProfile}
              onRefreshVolcengineSpeakers={refreshVolcengineSpeakers}
            />
          </SettingsCard>
        ) : null}
        {section === 'jianying' ? (
          <SettingsCard title="剪映草稿与 BGM" status={draft.jianying.draftPath ? '已配置' : '待配置'}>
            <ConfigInput label="Draft Path" value={draft.jianying.draftPath} onChange={(value) => setSettingsDraft({ ...draft, jianying: { ...draft.jianying, draftPath: value } })} />
            <LocalInfo title="BGM 库" value={settingsBgms.length ? settingsBgms.map((bgm) => bgm.title).join('、') : 'BGM 库为空'} />
            <button className="ghost-action" type="button" onClick={uploadBgmFromSettings}><Upload size={15} />+ 添加 BGM 文件</button>
            <div className="bgm-library-list">
              {settingsBgms.length === 0 ? <div className="bgm-library-empty">BGM 库为空</div> : null}
              {settingsBgms.map((bgm) => (
                <div key={bgm.id} className="bgm-library-item">
                  <div>
                    <strong>{bgm.title}</strong>
                    <span>{bgm.path}</span>
                  </div>
                  <label>
                    音量
                    <input type="number" min="0" max="1" step="0.05" value={bgm.volume} onChange={(event) => updateBgmVolume(bgm.id, Number(event.target.value))} />
                  </label>
                  <button className={draft.jianying.defaultBgmId === bgm.id ? 'mini-button active' : 'mini-button'} type="button" onClick={() => setDefaultBgm(bgm.id)}>
                    {draft.jianying.defaultBgmId === bgm.id ? '默认' : '设为默认'}
                  </button>
                  <button className="mini-button" type="button" onClick={() => removeBgm(bgm.id)}>移除</button>
                </div>
              ))}
            </div>
          </SettingsCard>
        ) : null}
        {section === 'activation' ? <LocalInfo title="激活与订阅" value={state.activation.message} /> : null}
        {section === 'creative' ? (
          <SettingsCard title="AI 创作 / IMA 知识库" status={draft.ima.apiKey ? '已配置' : '待配置'}>
            <ConfigInput label="Client ID" value={draft.ima.clientId} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, clientId: value } })} />
            <ConfigInput label="API Key" value={draft.ima.apiKey} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, apiKey: value } })} />
            <ConfigInput label="Knowledge Base" value={draft.ima.kbName} onChange={(value) => setSettingsDraft({ ...draft, ima: { ...draft.ima, kbName: value } })} />
            <button className="ghost-action">测试并拉取知识库</button>
          </SettingsCard>
        ) : null}
        {section === 'about' ? (
          <div className="diagnostics-card">
            <LocalInfo title="视频故事创作助手" value="v0.10.4 · beta · Windows · 本地数据目录" />
            <div className="button-row">
              <button className="ghost-action" onClick={runDiagnostics}>检查诊断</button>
              <button className="ghost-action" onClick={() => navigator.clipboard?.writeText(diagnostics)}>
                <Copy size={15} />
                复制诊断报告
              </button>
              <button className="danger-action"><XCircle size={15} />清理历史</button>
            </div>
            <pre>{diagnostics || '点击检查诊断后显示 LLM、TTS、BGM、剪映目录、账户状态等检查结果。'}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function LlmProfileManager({
  config,
  selectedProfileId,
  models,
  loadingModels,
  modelStatus,
  saving,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  models: ProviderModel[];
  loadingModels: boolean;
  modelStatus?: string;
  saving: boolean;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: () => void;
  onRefreshModels: (profile: AppConfig['llm']) => void;
}) {
  const profiles = config.llmProfiles.length ? config.llmProfiles : [config.llm];
  const activeId = activeLlmProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];

  function updateSelectedProfile(profile: AppConfig['llm']) {
    onChange(saveLlmProfile(config, profile));
  }

  function addProfile() {
    const next = addLlmProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.llmProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: AppConfig['llm']) {
    const next = copyLlmProfile(config, profile.id!);
    onChange(next);
    const currentIndex = config.llmProfiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.llmProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: AppConfig['llm']) {
    const next = removeLlmProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeLlmProfileId(next));
  }

  if (!selectedProfile) return <ArtifactEmpty text="暂无 LLM 配置档案" />;

  const selectedProvider = editableLlmProfileProvider(selectedProfile);
  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>配置档案</strong>
          <span>可保存多个 OpenAI 兼容接口，启用一个作为任务运行配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'C'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名配置'}</strong>
                <span>{profile.baseUrl || 'https://api.openai.com'}</span>
                <small>{profile.model || '未选择模型'}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <ConfigNumberInput
          label="请求超时（秒）"
          value={Math.round((selectedProfile.timeoutMs ?? defaultConfig.llm.timeoutMs ?? 120000) / 1000)}
          min={10}
          step={10}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, timeoutMs: value * 1000 })}
        />
        <Segmented
          label="Provider"
          value={selectedProvider}
          options={['openai', 'custom']}
          labels={['OpenAI', '自定义']}
          onChange={(value) => {
            onClearModels();
            updateSelectedProfile({
              ...selectedProfile,
              provider: value,
              baseUrl: value === 'openai' ? 'https://api.openai.com' : selectedProfile.baseUrl === 'https://api.openai.com' ? defaultConfig.llm.baseUrl : selectedProfile.baseUrl,
            });
          }}
        />
        {selectedProvider === 'openai' ? (
          <>
            <ProviderConfigNote title="OpenAI Chat Completions" value="使用官方 /v1/chat/completions，填写 API Key 与模型。" />
            <ConfigInput label="OpenAI API Key" value={selectedProfile.apiKey} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, apiKey: value }); }} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="OpenAI 模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
          </>
        ) : (
          <>
            <ProviderConfigNote title="OpenAI-compatible LLM" value="自定义接口按 /chat/completions 调用，需要 Base URL、API Key 与模型。" />
            <ConfigInput label="Base URL" value={selectedProfile.baseUrl} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, baseUrl: value }); }} />
            <ConfigInput label="API Key" value={selectedProfile.apiKey} onChange={(value) => { onClearModels(); updateSelectedProfile({ ...selectedProfile, apiKey: value }); }} />
            <ModelPicker
              key={`llm-${selectedProfile.id}`}
              label="模型"
              value={selectedProfile.model}
              models={models}
              loading={loadingModels}
              status={modelStatus}
              onRefresh={() => onRefreshModels(selectedProfile)}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, model: value })}
            />
          </>
        )}
      </div>
    </div>
  );
}

function ImageProfileManager({
  config,
  selectedProfileId,
  gptModels,
  customModels,
  loadingModelList,
  modelStatus,
  saving,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onClearModels,
  onRefreshModels,
}: {
  config: AppConfig;
  selectedProfileId: string;
  gptModels: ProviderModel[];
  customModels: ProviderModel[];
  loadingModelList: ModelListKey | null;
  modelStatus: Partial<Record<ModelListKey, string>>;
  saving: boolean;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onClearModels: (key: ModelListKey) => void;
  onRefreshModels: (key: ModelListKey, request: { baseUrl: string; apiKey: string }, currentModel: string, applyModel?: (config: AppConfig, model: string) => AppConfig) => void;
}) {
  const profiles = normalizedImageProfiles(config);
  const activeId = activeImageProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  if (!selectedProfile) return <ArtifactEmpty text="暂无绘图配置档案" />;

  const provider = selectedProfile.provider;
  const gptImage = imageProfileGptImage(selectedProfile);
  const jimeng = imageProfileJimeng(selectedProfile);
  const customImage = imageProfileCustomImage(selectedProfile);

  function updateSelectedProfile(profile: ImageProviderProfile) {
    onChange(saveImageProfile(config, profile));
  }

  function addProfile() {
    const next = addImageProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.imageProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: ImageProviderProfile) {
    const next = copyImageProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.imageProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: ImageProviderProfile) {
    const next = removeImageProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeImageProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>绘图档案</strong>
          <span>可保存 GPT Image、即梦和自定义图片接口，启用一个作为任务生图配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'I'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名绘图配置'}</strong>
                <span>{imageProviderLabel(profile.provider)}</span>
                <small>{imageProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="Provider"
          value={provider}
          options={['gpt_image', 'jimeng', 'custom']}
          labels={['GPT Image', '即梦', '自定义']}
          onChange={(value) => {
            onClearModels('gpt-image');
            onClearModels('custom-image');
            updateSelectedProfile({ ...selectedProfile, provider: value as ImageProviderProfile['provider'] });
          }}
        />
        {provider === 'gpt_image' ? (
          <>
            <ProviderConfigNote title="OpenAI Image API" value="API Key 与模型必填；Base URL 为空时使用官方默认端点。" />
            <ConfigInput label="GPT Image Base URL（可选）" value={gptImage.baseUrl} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, baseUrl: value } }); }} />
            <ConfigInput label="GPT Image API Key" value={gptImage.apiKey} onChange={(value) => { onClearModels('gpt-image'); updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, apiKey: value } }); }} />
            <ModelPicker
              key={`gpt-image-${selectedProfile.id}`}
              label="GPT Image 模型"
              value={gptImage.model}
              models={gptModels}
              loading={loadingModelList === 'gpt-image'}
              status={modelStatus['gpt-image']}
              onRefresh={() => onRefreshModels(
                'gpt-image',
                { baseUrl: gptImage.baseUrl || 'https://api.openai.com', apiKey: gptImage.apiKey },
                gptImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, gptImage: { ...gptImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, model: value } })}
            />
            <Segmented label="分辨率" value={gptImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={gptImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, gptImage: { ...gptImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'jimeng' ? (
          <>
            <ProviderConfigNote title="火山视觉 API" value={`Endpoint ${jimeng.endpoint || 'https://visual.volcengineapi.com'} · Region ${jimeng.region || 'cn-north-1'} · Service ${jimeng.service || 'cv'}`} />
            <ConfigInput label="即梦 AccessKey ID" value={jimeng.accessKeyId ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, accessKeyId: value } })} />
            <ConfigInput label="即梦 SecretAccessKey" value={jimeng.secretAccessKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, secretAccessKey: value } })} />
            <ConfigInput label="即梦 Req Key" value={jimeng.reqKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, reqKey: value } })} />
            <Segmented label="分辨率" value={jimeng.resolution} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={jimeng.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, jimeng: { ...jimeng, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
        {provider === 'custom' ? (
          <>
            <ProviderConfigNote title="OpenAI-compatible" value="自定义图片接口按 /images/generations 调用，需要 Base URL、API Key 与模型。" />
            <ConfigInput label="自定义 Base URL" value={customImage.baseUrl} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, baseUrl: value } }); }} />
            <ConfigInput label="自定义 API Key" value={customImage.apiKey} onChange={(value) => { onClearModels('custom-image'); updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, apiKey: value } }); }} />
            <ModelPicker
              key={`custom-image-${selectedProfile.id}`}
              label="自定义模型"
              value={customImage.model}
              models={customModels}
              loading={loadingModelList === 'custom-image'}
              status={modelStatus['custom-image']}
              onRefresh={() => onRefreshModels(
                'custom-image',
                { baseUrl: customImage.baseUrl, apiKey: customImage.apiKey },
                customImage.model,
                (current, model) => saveImageProfile(current, { ...selectedProfile, customImage: { ...customImage, model } }),
              )}
              onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, model: value } })}
            />
            <Segmented label="分辨率" value={customImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, resolution: value as ImageResolution } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={customImage.concurrency} onChange={(event) => updateSelectedProfile({ ...selectedProfile, customImage: { ...customImage, concurrency: Number(event.target.value) } })} /></Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

function TtsProfileManager({
  config,
  selectedProfileId,
  cloneVoiceCount,
  volcengineSpeakers,
  loadingVolcengineSpeakers,
  volcengineSpeakerStatus,
  saving,
  onChange,
  onSelectedProfileIdChange,
  onActivate,
  onRefreshVolcengineSpeakers,
}: {
  config: AppConfig;
  selectedProfileId: string;
  cloneVoiceCount: number;
  volcengineSpeakers: VolcengineSpeaker[];
  loadingVolcengineSpeakers: boolean;
  volcengineSpeakerStatus?: string;
  saving: boolean;
  onChange: (config: AppConfig) => void;
  onSelectedProfileIdChange: (id: string) => void;
  onActivate: (id: string) => Promise<void>;
  onRefreshVolcengineSpeakers: (profile: TtsProviderProfile) => void;
}) {
  const profiles = normalizedTtsProfiles(config);
  const activeId = activeTtsProfileId(config);
  const profileIds = profiles.map((profile) => profile.id).join('|');

  useEffect(() => {
    if (!profiles.some((profile) => profile.id === selectedProfileId)) {
      onSelectedProfileIdChange(activeId);
    }
  }, [activeId, onSelectedProfileIdChange, profileIds, profiles, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  const availableVolcengineVoices = useMemo(() => buildVolcengineVoiceOptions(volcengineSpeakers), [volcengineSpeakers]);
  if (!selectedProfile) return <ArtifactEmpty text="暂无 TTS 配置档案" />;

  const provider = selectedProfile.provider;
  const volcengine = ttsProfileVolcengine(selectedProfile);
  const minimax = ttsProfileMinimax(selectedProfile);
  const voiceSelection = volcenginePresetVoiceValue(volcengine.speaker, availableVolcengineVoices);

  function updateSelectedProfile(profile: TtsProviderProfile) {
    onChange(saveTtsProfile(config, profile));
  }

  function updateVolcengineVoice(voiceType: string) {
    updateSelectedProfile({ ...selectedProfile, speaker: voiceType, volcengine: { ...volcengine, speaker: voiceType } });
  }

  function addProfile() {
    const next = addTtsProfile(config);
    onChange(next);
    onSelectedProfileIdChange(next.ttsProfiles[0]?.id ?? activeId);
  }

  function duplicateProfile(profile: TtsProviderProfile) {
    const next = copyTtsProfile(config, profile.id!);
    onChange(next);
    const currentIndex = profiles.findIndex((item) => item.id === profile.id);
    onSelectedProfileIdChange(next.ttsProfiles[Math.max(0, currentIndex + 1)]?.id ?? profile.id!);
  }

  function deleteProfile(profile: TtsProviderProfile) {
    const next = removeTtsProfile(config, profile.id!);
    onChange(next);
    onSelectedProfileIdChange(activeTtsProfileId(next));
  }

  return (
    <div className="llm-profile-manager">
      <div className="profile-switcher-head">
        <div>
          <strong>TTS 档案</strong>
          <span>可保存火山引擎与 MiniMax 配音配置，启用一个作为任务配音配置。</span>
        </div>
        <button className="ghost-action" type="button" onClick={addProfile}>
          <Plus size={15} />
          新增配置
        </button>
      </div>

      <div className="profile-switcher-list">
        {profiles.map((profile) => {
          const isActive = profile.id === activeId;
          const isSelected = profile.id === selectedProfile.id;
          return (
            <article
              className={isActive ? 'provider-profile-card active' : isSelected ? 'provider-profile-card selected' : 'provider-profile-card'}
              data-profile-card
              key={profile.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectedProfileIdChange(profile.id!)}
              onKeyDown={(event) => event.key === 'Enter' && onSelectedProfileIdChange(profile.id!)}
            >
              <div className="profile-drag-dot">⋮⋮</div>
              <div className="profile-avatar">{profile.name?.slice(0, 1).toUpperCase() || 'T'}</div>
              <div className="profile-copy">
                <strong>{profile.name || '未命名 TTS 配置'}</strong>
                <span>{ttsProviderLabel(profile.provider)}</span>
                <small>{ttsProfileSummary(profile)}</small>
              </div>
              <div className="profile-actions">
                {isActive ? (
                  <span className="profile-active-badge">启用中</span>
                ) : (
                  <button
                    className="primary-action slim"
                    type="button"
                    disabled={saving}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectedProfileIdChange(profile.id!);
                      void onActivate(profile.id!);
                    }}
                  >
                    {saving ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
                    启用
                  </button>
                )}
                <button className="icon-button" type="button" title="编辑" onClick={(event) => { event.stopPropagation(); onSelectedProfileIdChange(profile.id!); }}>
                  <Palette size={14} />
                </button>
                <button className="icon-button" type="button" title="复制" onClick={(event) => { event.stopPropagation(); duplicateProfile(profile); }}>
                  <Copy size={14} />
                </button>
                <button className="icon-button" type="button" title="删除" disabled={profiles.length <= 1} onClick={(event) => { event.stopPropagation(); deleteProfile(profile); }}>
                  <XCircle size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="profile-editor-grid">
        <ConfigInput label="配置名称" value={selectedProfile.name ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, name: value })} />
        <Segmented
          label="引擎"
          value={provider}
          options={['volcengine', 'minimax']}
          labels={['火山引擎', 'MiniMax']}
          onChange={(value) => updateSelectedProfile({ ...selectedProfile, provider: value as TtsProviderProfile['provider'] })}
        />
        {provider === 'volcengine' ? (
          <>
            <ProviderConfigNote title="火山引擎 TTS" value="V3 HTTP Chunked 使用新版控制台 API Key、Resource ID 和 voice_type。" />
            <ConfigInput label="火山 API Key" value={volcengine.apiKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, volcengine: { ...volcengine, apiKey: value } })} />
            <ConfigInput label="AccessKey ID（音色列表）" value={volcengine.accessKeyId ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, volcengine: { ...volcengine, accessKeyId: value } })} />
            <ConfigInput label="SecretAccessKey（音色列表）" value={volcengine.secretAccessKey ?? ''} onChange={(value) => updateSelectedProfile({ ...selectedProfile, volcengine: { ...volcengine, secretAccessKey: value } })} />
            <ConfigInput label="Resource ID" value={volcengine.resourceId ?? 'seed-tts-2.0'} onChange={(value) => updateSelectedProfile({ ...selectedProfile, volcengine: { ...volcengine, resourceId: value } })} />
            <ConfigInput label="Endpoint" value={volcengine.endpoint ?? 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'} onChange={(value) => updateSelectedProfile({ ...selectedProfile, volcengine: { ...volcengine, endpoint: value } })} />
            <Field label="默认音色">
              <div className="model-picker">
                <select value={voiceSelection} onChange={(event) => updateVolcengineVoice(event.target.value === 'custom' ? '' : event.target.value)}>
                  <option value="custom">自定义 voice_type</option>
                  {availableVolcengineVoices.map((voice) => (
                    <option key={voice.voiceType} value={voice.voiceType}>
                      {voice.label}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button model-refresh-button"
                  title="加载全部音色"
                  aria-label="加载全部音色"
                  disabled={loadingVolcengineSpeakers}
                  onClick={() => onRefreshVolcengineSpeakers(selectedProfile)}
                  type="button"
                >
                  {loadingVolcengineSpeakers ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
                </button>
              </div>
              {volcengineSpeakerStatus ? <small className="model-list-status">{volcengineSpeakerStatus}</small> : null}
            </Field>
            {voiceSelection === 'custom' ? (
              <ConfigInput label="自定义 voice_type" value={volcengine.speaker} onChange={updateVolcengineVoice} />
            ) : null}
          </>
        ) : null}
        {provider === 'minimax' ? (
          <>
            <ProviderConfigNote title="MiniMax TTS" value="填写 API Key、模型和音色 ID。" />
            <ConfigInput label="MiniMax API Key" value={minimax.apiKey} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, apiKey: value } })} />
            <ConfigInput label="MiniMax 模型" value={minimax.model} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, model: value } })} />
            <ConfigInput label="MiniMax 音色 ID" value={minimax.voiceId} onChange={(value) => updateSelectedProfile({ ...selectedProfile, minimax: { ...minimax, voiceId: value } })} />
            <LocalInfo title="克隆音色" value={`${cloneVoiceCount} 个本地记录，可后续接入 MiniMax 克隆接口。`} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function AccountPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [draft, setDraft] = useState(state.account);
  useEffect(() => setDraft(state.account), [state.account]);
  return (
    <section className="panel account-panel">
      <div className="profile-card">
        <div className="avatar">{draft.avatarInitial || 'S'}</div>
        <div>
          <h2>{draft.displayName}</h2>
          <span>{draft.email} · {draft.deviceId}</span>
        </div>
        <strong>{draft.balance.toFixed(2)} 积分</strong>
      </div>
      <ConfigInput label="显示名称" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value, avatarInitial: value.slice(0, 1).toUpperCase() || 'S' })} />
      <ConfigInput label="邮箱" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} />
      <ConfigInput label="工作区" value={draft.workspace} onChange={(value) => setDraft({ ...draft, workspace: value })} />
      <button className="primary-action slim" onClick={async () => applyState(await api.saveAccount(draft))}><Save size={15} />保存资料</button>
      <LocalInfo title="账号与激活关系" value="本地复刻版只显示设备、账户和余额状态，不连接真实登录或付费系统。" />
    </section>
  );
}

function ActivationPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [draft, setDraft] = useState(state.activation);
  useEffect(() => setDraft(state.activation), [state.activation]);
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title-row">
          <h2>激活状态</h2>
          <StatusPill status={draft.status === 'active' ? 'completed' : 'paused'} />
        </div>
        <ConfigInput label="激活码" value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
        <Segmented label="计划" value={draft.plan} options={['trial', 'local', 'inactive']} labels={['试用', '本地激活', '未激活']} onChange={(value) => setDraft({ ...draft, plan: value as ActivationState['plan'] })} />
        <ConfigInput label="状态说明" value={draft.message} onChange={(value) => setDraft({ ...draft, message: value })} />
        <button className="primary-action slim" onClick={async () => applyState(await api.saveActivation(draft))}><Save size={15} />保存状态</button>
      </section>
      <section className="panel faq-panel">
        <LocalInfo title="立即激活" value="这里是本地模拟状态页，不做真实购买、登录或付费限制。" />
        <LocalInfo title="FAQ" value="激活码、订阅、设备解绑均为本地 UI 状态，可用于后续接入真实服务。" />
      </section>
    </div>
  );
}

function SettingsCard({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <div className="config-card">
      <div className="config-card-head"><div><strong>{title}</strong><span>使用中</span></div><small>{status}</small></div>
      <div className="form-grid">{children}</div>
    </div>
  );
}

function ConfigInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="config-input"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ConfigNumberInput({
  label,
  value,
  min,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="config-input">
      <span>{label}</span>
      <input type="number" min={min} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function ModelPicker({
  label,
  value,
  models,
  loading,
  status,
  onRefresh,
  onChange,
}: {
  label: string;
  value: string;
  models: ProviderModel[];
  loading: boolean;
  status?: string;
  onRefresh: () => void;
  onChange: (value: string) => void;
}) {
  const hasModels = models.length > 0;
  const options = hasModels && value && !models.some((model) => model.id === value) ? [{ id: value }, ...models] : models;
  return (
    <div className="field model-picker-field">
      <span>{label}</span>
      <div className="model-picker">
        {hasModels ? (
          <select value={value} onChange={(event) => onChange(event.target.value)}>
            {!value ? <option value="">选择模型</option> : null}
            {options.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={(event) => onChange(event.target.value)} />
        )}
        <button className="icon-button model-refresh-button" title="获取模型" aria-label="获取模型" disabled={loading} onClick={onRefresh} type="button">
          {loading ? <Loader2 className="spin" size={15} /> : <RotateCcw size={15} />}
        </button>
      </div>
      {status ? <small className="model-list-status">{status}</small> : null}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function Segmented({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels?: string[]; onChange: (value: string) => void }) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="segmented">
        {options.map((option, index) => (
          <button key={option} className={option === value ? 'selected' : ''} onClick={() => onChange(option)} type="button">
            {labels?.[index] ?? option}
          </button>
        ))}
      </div>
    </div>
  );
}

function OptionCloud({ title, options, value, onChange }: { title: string; options: string[][]; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="field-title">{title}</span>
      <div className="option-cloud">
        {options.map(([id, label, hint]) => (
          <button key={id} className={value === id ? 'option-pill active' : 'option-pill'} onClick={() => onChange(id)}>
            <strong>{label}</strong>
            {hint ? <small>{hint}</small> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function Accordion({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <div className={expanded ? 'accordion open' : 'accordion'}>
      <button onClick={() => setExpanded(!expanded)}>› {title}</button>
      {expanded ? <div>{children}</div> : null}
    </div>
  );
}

function EventTimeline({ events }: { events: TaskEvent[] }) {
  if (events.length === 0) return <EmptyState title="暂无事件" />;
  return (
    <div className="event-list">
      {events.map((event, index) => (
        <div className="event-item" key={`${event.seq ?? index}-${event.ts}`}>
          <span>{event.step ?? '-'}</span>
          {event.type === 'step_error' ? <ErrorSummaryButton fullMessage={event.detail} title={`步骤 ${event.step ?? '-'} 错误`} compact /> : <p>{event.detail}</p>}
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`status-pill ${status}`}>{statusLabel(status)}</span>;
}

function EmptyState({ title }: { title: string }) {
  return <div className="empty-state"><Database size={20} /><span>{title}</span></div>;
}

function LocalInfo({ title, value }: { title: string; value: string }) {
  return <div className="local-info"><Info size={18} /><div><strong>{title}</strong><span>{value}</span></div></div>;
}

function ErrorSummaryButton({ fullMessage, title, compact = false }: { fullMessage: string; title: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!fullMessage.trim()) return null;
  const summary = summarizeErrorMessage(fullMessage);
  return (
    <>
      <button
        type="button"
        className={compact ? 'error-summary-button compact' : 'error-summary-button'}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <span className="error-mark">!</span>
        <span>{summary}</span>
      </button>
      {open ? <ErrorDetailDialog title={title} summary={summary} fullMessage={fullMessage} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ErrorDetailDialog({ title, summary, fullMessage, onClose }: { title: string; summary: string; fullMessage: string; onClose: () => void }) {
  return (
    <div className="error-dialog-backdrop" onClick={onClose}>
      <section className="error-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="error-dialog-head">
          <div>
            <span className="error-mark">!</span>
            <strong>{title}</strong>
          </div>
          <button className="mini-button" type="button" onClick={onClose}>关闭</button>
        </div>
        <p>{summary}</p>
        <pre>{fullMessage}</pre>
      </section>
    </div>
  );
}

function ProviderConfigNote({ title, value }: { title: string; value: string }) {
  return (
    <div className="provider-config-note">
      <Info size={16} />
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function resolvePromptTemplateForTrack(templates: PromptTemplate[], track: string, overrideId?: string | null): PromptTemplate | null {
  return selectTaskPromptTemplate(templates, { track, promptTemplateId: overrideId ?? null });
}

function splitListInput(value: string): string[] {
  return value
    .split(/[,，、\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function validBgmItems(config: AppConfig): BgmItem[] {
  return config.jianying.bgmLibrary.filter((bgm) => bgm.id.trim() && bgm.path.trim());
}

function resolveDefaultBgmId(config: AppConfig): string {
  const bgms = validBgmItems(config);
  return bgms.some((bgm) => bgm.id === config.jianying.defaultBgmId) ? config.jianying.defaultBgmId : bgms[0]?.id ?? '';
}

function addUploadedBgm(config: AppConfig, audioPath: string): { config: AppConfig; bgmId: string } {
  const id = `bgm-${crypto.randomUUID()}`;
  const item: BgmItem = {
    id,
    title: audioTitleFromPath(audioPath),
    path: audioPath,
    durationMs: 0,
    volume: 0.25,
  };
  const existingDefaultId = resolveDefaultBgmId(config);
  const bgmLibrary = [...validBgmItems(config), item];
  const nextConfig = {
    ...config,
    jianying: {
      ...config.jianying,
      bgmLibrary,
      defaultBgmId: existingDefaultId || id,
    },
  };
  return { config: nextConfig, bgmId: id };
}

function audioTitleFromPath(path: string): string {
  const filename = path.split(/[\\/]/u).pop() || 'BGM';
  return filename.replace(/\.[^.]+$/u, '') || filename;
}

function pageSubtitle(view: ShellView): string {
  const map: Record<ShellView, string> = {
    'new-task': '粘贴一段人物故事，几分钟后在剪映里打开',
    queue: '查看当前任务、步骤事件、失败重试和输出状态',
    history: '按时间浏览已完成、失败、取消和草稿任务',
    'task-detail': '查看单个任务的独立执行状态和流水线',
    'image-lab': '单独测试文生图、图像参考和分镜图片提示词',
    'prompt-templates': '管理系统模板、克隆、导入 JSON 和本地编辑',
    'draft-templates': '调整画布、图片区域、字幕、免责声明和音频参数',
    settings: '配置 API 凭证、本地路径、TTS、IMA 与诊断',
    account: '管理本机账号资料、设备和模拟余额',
    activation: '管理本地激活状态与试用说明',
  };
  return map[view];
}

function pipelineStepStatus(task: Task, step: number): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
  if (task.status === 'paused' && task.failedStep === step) return 'failed';
  if (task.status === 'failed') return step === task.currentStep ? 'failed' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'cancelled') return step === task.currentStep ? 'cancelled' : step < task.currentStep ? 'completed' : 'pending';
  if (task.status === 'completed') return 'completed';
  if (task.status === 'running') return step < task.currentStep ? 'completed' : step === task.currentStep ? 'running' : 'pending';
  return step < task.currentStep ? 'completed' : 'pending';
}

function statusLabelForStep(status: ReturnType<typeof pipelineStepStatus>): string {
  return {
    pending: '等待中',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

function artifactPanelTitle(task: Task, tab: 'preview' | 'storyboard' | 'audio'): string {
  if (tab === 'storyboard') return task.currentStep >= 2 ? '分镜画廊已跟随流水线准备' : '等待分镜生成';
  if (tab === 'audio') return task.currentStep >= 5 ? '配音与字幕时间轴' : '等待配音生成';
  return task.currentStep >= 7 ? '最终剪映草稿目录' : '等待当前步骤产物落盘';
}

function formatDuration(start: string, end: string | null, now = Date.now()): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return '--';
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `0:${String(rest).padStart(2, '0')}`;
}

function statusLabel(status: TaskStatus | 'all'): string {
  return {
    all: '全部',
    draft: '草稿',
    pending: '等待',
    running: '运行中',
    paused: '暂停',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status];
}

function maskConfigured(value: string): string {
  if (!value) return '待配置';
  return value.length > 8 ? `${value.slice(0, 2)}••••${value.slice(-4)}` : '已配置';
}

function settingsStatusLabel(status: 'pass' | 'warn' | 'fail'): string {
  return status === 'pass' ? '已配置' : status === 'warn' ? '需确认' : '待配置';
}

function summarizeErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '发生错误';
  const imageApiStatus = normalized.match(/Image provider API error \((\d+)\)/i)?.[1];
  if (imageApiStatus) return `生图接口错误 ${imageApiStatus}`;
  if (/Browser preview cannot run the real provider pipeline/i.test(normalized)) return '浏览器预览无法执行真实任务';
  if (/Image provider API key is missing/i.test(normalized)) return '生图 API Key 缺失';
  if (/Image provider is not configured/i.test(normalized)) return '生图配置不完整';
  if (/Jimeng submit failed/i.test(normalized)) return '即梦提交失败';
  if (/Jimeng poll failed/i.test(normalized)) return '即梦结果获取失败';
  if (/LLM provider is not configured/i.test(normalized)) return 'LLM 配置不完整';
  if (/TTS provider is not configured/i.test(normalized)) return 'TTS 配置不完整';
  const firstSentence = normalized.split(/[。.!?]/)[0] || normalized;
  return trimForPreview(firstSentence, 42);
}

type ImageResolution = '1K' | '2K' | '4K';

function settingsConfigSignature(config: AppConfig): string {
  return JSON.stringify(normalizeEditableConfigProviders(config));
}

function imageProviderLabel(provider: ImageProviderProfile['provider']): string {
  return provider === 'gpt_image' ? 'GPT Image' : provider === 'jimeng' ? '即梦' : '自定义图片';
}

function imageProfileSummary(profile: ImageProviderProfile): string {
  if (profile.provider === 'jimeng') return imageProfileJimeng(profile).reqKey || imageProfileJimeng(profile).model || '未配置 Req Key';
  if (profile.provider === 'custom') return imageProfileCustomImage(profile).model || '未选择模型';
  return imageProfileGptImage(profile).model || '未选择模型';
}

function ttsProviderLabel(provider: TtsProviderProfile['provider']): string {
  return provider === 'minimax' ? 'MiniMax' : '火山引擎';
}

function ttsProfileSummary(profile: TtsProviderProfile): string {
  if (profile.provider === 'minimax') return ttsProfileMinimax(profile).model || '未选择模型';
  const speaker = ttsProfileVolcengine(profile).speaker;
  return volcengineVoicePresetLabel(speaker) || speaker || '未选择音色';
}

type VolcengineVoiceOption = {
  voiceType: string;
  label: string;
};

function mergeVolcengineSpeakers(current: VolcengineSpeaker[], incoming: VolcengineSpeaker[]): VolcengineSpeaker[] {
  const byVoiceType = new Map(current.map((speaker) => [speaker.voiceType, speaker]));
  incoming.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (voiceType) byVoiceType.set(voiceType, { ...speaker, voiceType });
  });
  return [...byVoiceType.values()];
}

function buildVolcengineVoiceOptions(speakers: VolcengineSpeaker[]): VolcengineVoiceOption[] {
  const byVoiceType = new Map<string, VolcengineVoiceOption>();
  volcengineVoicePresets.forEach(([label, voiceType]) => {
    byVoiceType.set(voiceType, { voiceType, label });
  });
  speakers.forEach((speaker) => {
    const voiceType = speaker.voiceType.trim();
    if (!voiceType) return;
    byVoiceType.set(voiceType, {
      voiceType,
      label: speaker.name.trim() || volcengineStaticPresetLabel(voiceType) || voiceType,
    });
  });
  return [...byVoiceType.values()];
}

function volcenginePresetVoiceValue(speaker: string, options: VolcengineVoiceOption[] = buildVolcengineVoiceOptions([])): string {
  return options.some((option) => option.voiceType === speaker) ? speaker : 'custom';
}

function volcengineVoicePresetLabel(speaker: string, speakers: VolcengineSpeaker[] = []): string {
  return buildVolcengineVoiceOptions(speakers).find((option) => option.voiceType === speaker)?.label ?? '';
}

function volcengineStaticPresetLabel(speaker: string): string {
  return volcengineVoicePresets.find(([, voiceType]) => voiceType === speaker)?.[0] ?? '';
}

function DraftCanvasText({
  className,
  x,
  y,
  style,
  children,
}: {
  className: string;
  x: number;
  y: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <div className={className} style={{ ...draftLayerPositionStyle(x, y), ...style }}>
      {children}
    </div>
  );
}

function applyDraftCanvasRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const canvas = draftCanvasSizeForRatio(ratio);
  return applyDraftImageRatio({ ...template, canvas: { ...template.canvas, ...canvas, ratio } }, template.image.ratio);
}

function draftCanvasSizeForRatio(ratio: string): Pick<DraftTemplate['canvas'], 'width' | 'height'> {
  if (ratio === '16:9') return { width: 1920, height: 1080 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  if (ratio === '1:1') return { width: 1080, height: 1080 };
  return { width: 1080, height: 1920 };
}

function applyDraftImageRatio(template: DraftTemplate, ratio: string): DraftTemplate {
  const height = clamp(draftImageHeightForCanvas(template.canvas, ratio), 0.1, 1);
  return {
    ...template,
    image: {
      ...template.image,
      ratio,
      height,
      top: clamp((1 - height) / 2, -0.2, 1 - Math.min(0.1, height)),
    },
  };
}

function draftImageHeightForCanvas(canvas: DraftTemplate['canvas'], imageRatio: string): number {
  const ratio = ratioToNumber(imageRatio);
  if (!ratio) return 1;
  return (canvas.width / ratio) / canvas.height;
}

function draftTemplateCanvasStyle(template: DraftTemplate): React.CSSProperties {
  const backgroundImage = template.canvas.backgroundImage.trim();
  const style: React.CSSProperties & Record<string, string | number | undefined> = {
    '--draft-preview-width': `${draftPreviewWidth(template)}px`,
    aspectRatio: `${template.canvas.width} / ${template.canvas.height}`,
    backgroundColor: template.canvas.backgroundColor,
    backgroundImage: backgroundImage ? `url("${toLocalImageUrl(backgroundImage).replace(/"/g, '\\"')}")` : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
  };
  return style;
}

function draftPreviewWidth(template: DraftTemplate): number {
  const ratio = ratioToNumber(template.canvas.ratio) || template.canvas.width / template.canvas.height;
  if (ratio >= 1.5) return 640;
  if (ratio >= 1.2) return 560;
  if (ratio >= 0.95) return 520;
  return Math.max(300, Math.round(ratio * 560));
}

function draftImageMediaStyle(template: DraftTemplate): React.CSSProperties {
  const aspectRatio = draftImageAspectRatio(template.image.ratio);
  if (template.image.fit === 'contain') {
    return {
      aspectRatio,
      height: 'auto',
      maxHeight: '100%',
      maxWidth: '100%',
      width: '100%',
    };
  }
  return {
    aspectRatio,
    height: '100%',
    width: '100%',
  };
}

function draftImageAspectRatio(ratio: string): string {
  const parts = ratio.split(':').map((item) => Number(item));
  if (parts.length === 2 && parts.every((item) => Number.isFinite(item) && item > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '9 / 16';
}

function ratioToNumber(ratio: string): number {
  const [width, height] = ratio.split(':').map((item) => Number(item));
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

function normalizeColorInput(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : '#000000';
}

function updateDraftLayerPosition(template: DraftTemplate, layer: DraftCanvasLayer, deltaX: number, deltaY: number): DraftTemplate {
  if (layer === 'image') {
    return {
      ...template,
      image: {
        ...template.image,
        top: clamp(template.image.top + deltaY / 2, -0.2, 1 - Math.min(0.1, template.image.height)),
      },
    };
  }
  if (layer === 'title') {
    return { ...template, title: { ...template.title, x: clamp(template.title.x + deltaX, -0.9, 0.9), y: clamp(template.title.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'subtitle') {
    return { ...template, subtitle: { ...template.subtitle, x: clamp(template.subtitle.x + deltaX, -0.9, 0.9), y: clamp(template.subtitle.y + deltaY, -0.9, 0.9) } };
  }
  if (layer === 'caption') {
    return { ...template, caption: { ...template.caption, x: clamp(template.caption.x + deltaX, -0.9, 0.9), y: clamp(template.caption.y + deltaY, -0.9, 0.9) } };
  }
  return { ...template, disclaimer: { ...template.disclaimer, x: clamp(template.disclaimer.x + deltaX, -0.9, 0.9), y: clamp(template.disclaimer.y + deltaY, -0.95, 0.95) } };
}

function draftLayerPositionStyle(x: number, y: number): React.CSSProperties {
  return {
    left: `${((x + 1) / 2) * 100}%`,
    top: `${((y + 1) / 2) * 100}%`,
    transform: 'translate(-50%, -50%)',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function setDraftModel(config: AppConfig, key: ModelListKey, model: string): AppConfig {
  if (key === 'gpt-image') {
    return { ...config, gptImage: { ...config.gptImage, model } };
  }
  if (key === 'custom-image') {
    return { ...config, customImage: { ...config.customImage, model } };
  }
  return saveLlmProfile(config, { ...config.llm, model });
}

function setImageResolution(config: AppConfig, resolution: ImageResolution): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, resolution } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, resolution } };
  }
  return { ...config, image: { ...config.image, resolution }, gptImage: { ...config.gptImage, resolution } };
}

function activeImageResolution(config: AppConfig): ImageResolution {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

function setImageConcurrency(config: AppConfig, concurrency: number): AppConfig {
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, concurrency } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, concurrency } };
  }
  return { ...config, image: { ...config.image, concurrency }, gptImage: { ...config.gptImage, concurrency } };
}

function activeImageConcurrency(config: AppConfig): number {
  if (config.imageProvider === 'custom') return config.customImage.concurrency;
  if (config.imageProvider === 'jimeng') return config.jimeng.concurrency;
  return config.gptImage.concurrency ?? config.image.concurrency;
}

function snapshotStepStatus(snapshot: TaskArtifactSnapshot | null, step: number): string {
  return snapshot?.steps[String(step)]?.status ?? 'pending';
}

function imageProgressLabel(totalScenes: number, generatedImages: number, stepStatus: string): string {
  const total = totalScenes || generatedImages;
  if (total === 0) return '等待分镜';
  const statusText = stepStatus === 'completed' ? '已完成' : stepStatus === 'running' ? '生成中' : stepStatus === 'failed' ? '生成失败' : '等待生图';
  return `${generatedImages}/${total} 张 · ${statusText}`;
}

function toLocalImageUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

function countChars(value?: string): number {
  return value?.trim().length ?? 0;
}

function trimForPreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function cloneDraftTemplate(template: DraftTemplate): DraftTemplate {
  return JSON.parse(JSON.stringify(template)) as DraftTemplate;
}

function toggleArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function sourceKey(source: AiSourceSection, index: number): string {
  return source.url || `${source.title}-${index}`;
}

declare global {
  interface Window {
    __storyboundReactRoot?: Root;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

window.__storyboundReactRoot ??= createRoot(rootElement);
window.__storyboundReactRoot.render(<App />);
