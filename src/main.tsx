import React, { useEffect, useMemo, useState } from 'react';
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
  Mic2,
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
  XCircle,
} from 'lucide-react';
import type {
  AccountProfile,
  ActivationState,
  AppConfig,
  AppState,
  CreateTaskInput,
  DraftTemplate,
  ImageLabRecord,
  PausePoint,
  PromptTemplate,
  RewriteIntensity,
  ShellView,
  Task,
  TaskEvent,
  TaskMode,
  TaskStatus,
  UiPreferences,
} from './shared/types';
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
import { draftTemplates as builtinDraftTemplates, imageAnimations } from './shared/templates';
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
const voiceOptions = ['东方浩然', '灿博小叔', '温柔小雅', '爽快思思', '更多音色...'];
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

function cloneState(state: AppState): AppState {
  return JSON.parse(JSON.stringify(state)) as AppState;
}

function hydrateState(state: Partial<AppState>): AppState {
  return {
    ...cloneState(initialState),
    ...state,
    config: { ...defaultConfig, ...(state.config ?? {}) } as AppConfig,
    tasks: state.tasks ?? [],
    events: state.events ?? [],
    promptTemplates: state.promptTemplates ?? defaultPromptTemplates,
    draftTemplates: state.draftTemplates ?? builtinDraftTemplates,
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
        status: input.status ?? 'mock',
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
        bgmId: input.bgmId ?? '__builtin__',
        pausePoints: input.pausePoints ?? [],
        outputDir: '',
        errorMessage: browserPipelineError,
        createdAt: new Date().toISOString(),
        completedAt: null,
        mode: input.mode ?? 'paste',
        aiKeyword: input.aiKeyword ?? '',
        aiSources: input.aiSources ?? [],
        extraRequirements: input.extraRequirements ?? '',
        promptTemplateId: input.promptTemplateId ?? null,
        promptTemplateType: input.promptTemplateType ?? null,
        referenceImagePath: input.referenceImagePath ?? '',
        rewriteIntensity: input.rewriteIntensity ?? 'standard',
        narrativePov: input.narrativePov ?? 'keep-original',
        keepPromotion: input.keepPromotion ?? false,
        ttsProvider: input.ttsProvider ?? 'volcengine',
        ttsSpeed: input.ttsSpeed ?? 1,
        step3PromptSnapshot: input.step3PromptSnapshot ?? '',
        failedStep: 0,
        retryFromStep: 0,
        artifactStatePath: '',
      };
      const events: TaskEvent[] = [
        { taskId: task.id, type: 'step_error', step: 0, agent: 'Reviewer', tool: null, detail: browserPipelineError, dataJson: null, ts: Date.now() },
      ];
      const state = read();
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
    async runDiagnostics() {
      const state = read();
      return {
        generatedAt: new Date().toISOString(),
        checks: [
          { id: 'llm-config', label: 'LLM 配置完整性', status: state.config.llm.apiKey ? 'pass' : 'warn', detail: state.config.llm.model },
          { id: 'tts-config', label: 'TTS APP ID & ACCESS TOKEN 已填写', status: state.config.tts.accessKey ? 'pass' : 'warn', detail: state.config.tts.provider },
          { id: 'jianying-sidecar', label: '剪映草稿目录', status: state.config.jianying.draftPath ? 'pass' : 'warn', detail: state.config.jianying.draftPath },
          { id: 'account-state', label: '账户状态', status: 'pass', detail: state.activation.message },
        ],
      };
    },
    openPath: async () => undefined,
    onTaskEvent: () => () => undefined,
  };
}

function App() {
  const [state, setState] = useState<AppState>(cloneState(initialState));
  const [activeView, setActiveView] = useState<ShellView>('new-task');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [saveTone, setSaveTone] = useState<'saved' | 'saving' | 'dirty'>('saved');
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
        <button className="activation-link" onClick={() => navigate('activation')}>获取激活码</button>
      </div>

      <div className="trial-strip">
        <span className="danger-dot" />
        <strong>试用已用尽</strong>
        <span>|</span>
        <span>旧任务可继续执行，激活后可新建任务。本地复刻版不做真实扣费阻断。</span>
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

          {activeView === 'new-task' ? <NewTaskPage api={api} state={state} applyState={applyState} openTaskDetail={openTaskDetail} /> : null}
          {activeView === 'queue' ? <QueuePage api={api} state={state} applyState={applyState} openNewTask={() => navigate('new-task')} openTaskDetail={openTaskDetail} /> : null}
          {activeView === 'history' ? <HistoryPage api={api} state={state} openTaskDetail={openTaskDetail} /> : null}
          {activeView === 'task-detail' ? <TaskDetailPage api={api} state={state} task={selectedTask} applyState={applyState} close={() => navigate('history')} /> : null}
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

function NewTaskPage({ api, state, applyState, openTaskDetail }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void; openTaskDetail: (taskId: string) => void }) {
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
  const [speaker, setSpeaker] = useState(state.config.tts.speaker);
  const [bgmId, setBgmId] = useState('__builtin__');
  const [referenceImagePath, setReferenceImagePath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pausePoint, setPausePoint] = useState<PausePoint>('none');
  const [rewriteIntensity, setRewriteIntensity] = useState<RewriteIntensity>('standard');
  const [narrativePov, setNarrativePov] = useState<Task['narrativePov']>('keep-original');
  const [keepPromotion, setKeepPromotion] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [running, setRunning] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');

  async function run() {
    setRunning(true);
    try {
      const next = await api.createAndRunTask({
        title,
        inputText: mode === 'paste' ? inputText : `${aiKeyword}\n\n${extraRequirements}`,
        mode,
        aiKeyword,
        aiSources,
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
              全网搜索 <small>从 Bing + 搜狗抓取相关文章作为参考素材</small>
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
              <textarea className="small-textarea" value={extraRequirements} onChange={(event) => setExtraRequirements(event.target.value)} />
            </Field>
            <button className="ghost-action">
              <Search size={15} />
              搜索
            </button>
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
          {state.config.jianying.bgmLibrary.map((bgm) => (
            <button key={bgm.id} className={bgmId === bgm.id ? 'chip active' : 'chip'} onClick={() => setBgmId(bgm.id)}>
              {bgm.title}
            </button>
          ))}
          <button className="chip">+ 添加</button>
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
            <Segmented label="暂停确认" value={pausePoint} options={pauseOptions.map(([id]) => id)} labels={pauseOptions.map(([, label]) => label)} onChange={(value) => setPausePoint(value as PausePoint)} />
            <Segmented label="改写强度" value={rewriteIntensity} options={rewriteOptions.map(([id]) => id)} labels={rewriteOptions.map(([, label]) => label)} onChange={(value) => setRewriteIntensity(value as RewriteIntensity)} />
            <Segmented label="叙事视角" value={narrativePov} options={povOptions.map(([id]) => id)} labels={povOptions.map(([, label]) => label)} onChange={(value) => setNarrativePov(value as Task['narrativePov'])} />
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
          <span className="danger-text">试用已用尽，复刻版仅本地模拟，不阻断生成</span>
          <div className="button-row">
            <button className="ghost-action" onClick={() => setDraftNotice('已保存为本地草稿预设')}>
              保存为草稿
            </button>
            <button className="primary-action" onClick={run} disabled={running || (mode === 'paste' ? inputText.trim().length === 0 : aiKeyword.trim().length === 0)}>
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

function QueuePage({ api, state, applyState, openNewTask, openTaskDetail }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void; openNewTask: () => void; openTaskDetail: (taskId: string) => void }) {
  const latestTask = state.tasks[0];
  const events = latestTask ? state.events.filter((event) => event.taskId === latestTask.id || event.taskId === 'live') : state.events;
  async function setStatus(task: Task, status: TaskStatus) {
    applyState(await api.updateTaskStatus(task.id, status));
  }
  return (
    <div className="two-column">
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
                {task.errorMessage ? <small className="danger-text">{task.errorMessage}</small> : null}
              </div>
              <StatusPill status={task.status} />
              <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                <button className="mini-button" onClick={() => setStatus(task, task.status === 'paused' ? 'running' : 'paused')}>{task.status === 'paused' ? '继续' : '暂停'}</button>
                <button className="mini-button" onClick={() => setStatus(task, 'cancelled')}>取消</button>
                <button className="mini-button" onClick={async () => applyState(await api.retryTask(task.id))}>重试</button>
                <button className="mini-button" disabled={!task.outputDir} onClick={() => task.outputDir && api.openPath(task.outputDir)}>
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
          {latestTask?.outputDir ? (
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

function TaskDetailPage({ api, state, task, applyState, close }: { api: StoryboundApi; state: AppState; task: Task | null; applyState: (state: AppState) => void; close: () => void }) {
  const [tab, setTab] = useState<'preview' | 'storyboard' | 'audio'>('preview');
  if (!task) {
    return (
      <section className="panel full-panel">
        <EmptyState title="暂无任务详情" />
      </section>
    );
  }

  const detailTask = task;
  const events = state.events.filter((event) => event.taskId === detailTask.id);
  const currentStep = Math.min(Math.max(detailTask.currentStep, 0), pipelineSteps.length - 1);
  const currentMeta = pipelineSteps[currentStep] ?? pipelineSteps[0];
  const latestEvent = [...events].reverse()[0] ?? null;
  const completedSteps = detailTask.status === 'completed' ? pipelineSteps.length : Math.max(0, detailTask.currentStep);

  async function cancelTask() {
    applyState(await api.updateTaskStatus(detailTask.id, 'cancelled'));
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
            <span>{task.id}</span>
            <button className="icon-button" title="复制任务 ID" onClick={() => navigator.clipboard?.writeText(task.id)}>
              <Copy size={14} />
            </button>
          </div>
          <div className="task-metrics">
            <div><strong>{formatDuration(task.createdAt, task.completedAt)}</strong><span>总耗时</span></div>
            <div><strong>{completedSteps}<small>/{pipelineSteps.length}</small></strong><span>当前步骤</span></div>
            <div><strong>{events.length || '-'}</strong><span>事件数</span></div>
          </div>
          <button className="cancel-task-button" disabled={task.status === 'completed' || task.status === 'cancelled'} onClick={cancelTask}>
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
              const status = pipelineStepStatus(task, step.index);
              const stepEvent = [...events].reverse().find((event) => event.step === step.index);
              return (
                <div className={`pipeline-step ${status}`} key={step.index}>
                  <div className="pipeline-node">{status === 'running' ? <Loader2 className="spin" size={14} /> : step.index + 1}</div>
                  <div>
                    <strong>{step.title}</strong>
                    <span>{step.hint}</span>
                    <small>{status === 'running' ? '进行中' : stepEvent?.detail ?? statusLabelForStep(status)}</small>
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
        <div className="artifact-preview">
          <div className="preview-empty-icon">{task.status === 'running' ? <Loader2 className="spin" size={24} /> : <Database size={24} />}</div>
          <strong>{artifactPanelTitle(task, tab)}</strong>
          <span>{latestEvent?.detail ?? '等待当前步骤产物落盘'}</span>
          <div className="preview-meta-grid">
            <div><small>任务</small><strong>{task.title || '未命名任务'}</strong></div>
            <div><small>状态</small><strong>{statusLabel(task.status)}</strong></div>
            <div><small>当前代理</small><strong>{currentMeta.agent}</strong></div>
            <div><small>输出目录</small><strong>{task.outputDir || '等待生成'}</strong></div>
            <div><small>失败步骤</small><strong>{task.failedStep ?? '-'}</strong></div>
            <div><small>状态文件</small><strong>{task.artifactStatePath || '等待生成'}</strong></div>
          </div>
          {task.outputDir ? (
            <button className="ghost-action" onClick={() => api.openPath(task.outputDir)}>
              <FolderOpen size={15} />
              打开输出
            </button>
          ) : null}
        </div>
      </section>
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

  async function addRecord() {
    const next = await api.addImageLabRecord({
      prompt,
      ratio,
      style,
      provider: state.config.imageProvider,
      imagePath: '',
      resolution,
      referenceImagePath,
      status: state.config.image.apiKey ? 'generated' : 'mock',
    });
    applyState(next);
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
        <div className="provider-line">Provider：{state.config.imageProvider} · 预计消耗：本地模拟</div>
        <button className="primary-action" onClick={addRecord}>
          <ImageIcon size={17} />
          开始生成
        </button>
      </section>
      <section className="image-grid-panel">
        {state.imageLabRecords.length === 0 ? <EmptyState title="暂无画图记录" /> : null}
        {state.imageLabRecords.map((record) => (
          <article className="image-record" key={record.id}>
            <div className="mock-image">
              <ImageIcon size={28} />
              <span>{record.ratio} · {record.resolution}</span>
            </div>
            <strong>{record.prompt}</strong>
            <small>{record.provider} · {formatDate(record.createdAt)}</small>
          </article>
        ))}
      </section>
    </div>
  );
}

function PromptTemplatesPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [selectedId, setSelectedId] = useState(state.promptTemplates[0]?.id ?? '');
  const selected = state.promptTemplates.find((template) => template.id === selectedId) ?? state.promptTemplates[0];
  const [draft, setDraft] = useState<PromptTemplate | null>(selected ? { ...selected } : null);
  const [importJson, setImportJson] = useState('');

  useEffect(() => setDraft(selected ? { ...selected } : null), [selected?.id]);

  async function save() {
    if (!draft) return;
    applyState(await api.savePromptTemplate(draft));
  }

  async function duplicate() {
    if (!draft) return;
    const copy = { ...draft, id: crypto.randomUUID(), name: `${draft.name} 副本`, isBuiltin: false, origin: 'custom' as const };
    applyState(await api.savePromptTemplate(copy));
    setSelectedId(copy.id);
  }

  async function importTemplate() {
    try {
      const imported = JSON.parse(importJson) as PromptTemplate;
      applyState(await api.savePromptTemplate({ ...imported, id: imported.id || crypto.randomUUID(), isBuiltin: false, updatedAt: new Date().toISOString() }));
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
          <button className="ghost-action" onClick={async () => applyState(await api.resetPromptTemplates())}>
            <RotateCcw size={14} />
            重置
          </button>
        </div>
        {state.promptTemplates.map((template) => (
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
                <button className="ghost-action" onClick={importTemplate}>
                  <FileJson size={15} />
                  导入 JSON
                </button>
                <button className="primary-action slim" onClick={save}>
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
            </div>
            <span className="field-title">默认画风</span>
            <div className="chip-row">{(draft.defaultStyles ?? []).map((item) => <span className="chip active" key={item}>{item}</span>)}</div>
            <span className="field-title">主角档案</span>
            <div className="chip-row">
              <span className="chip active">{draft.characterPolicy === 'force-extract' ? '强制提取' : draft.characterPolicy === 'force-skip' ? '强制跳过' : '跟随赛道'}</span>
              <span className="hint-text">Step 3 会先抽出主角身份/外貌/年代，注入到每句 desc_prompt。</span>
            </div>
            <span className="field-title">Step 3 骨架模块</span>
            <div className="chip-row">{(draft.step3SkeletonModules ?? []).map((item) => <span className="chip" key={item}>{item}</span>)}</div>
            <span className="field-title">参考图类型</span>
            <div className="chip-row"><span className="chip active">{draft.referenceKind === 'product' ? '产品' : draft.referenceKind === 'face' ? '人脸' : '无'}</span><span className="chip">市场模拟</span></div>
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

  useEffect(() => {
    setDraft(editingTemplate ? cloneDraftTemplate(editingTemplate) : null);
  }, [editingId, editingTemplate]);

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
            <DraftTemplatePreview template={draft} />
          </section>

          <section className="panel draft-controls">
            <Accordion title="画布设置" open>
              <Segmented label="比例" value={draft.canvas.ratio} options={['9:16', '4:3', '1:1', '16:9']} onChange={(value) => setDraft({ ...draft, canvas: { ...draft.canvas, ratio: value } })} />
              <Field label="底色"><input value={draft.canvas.backgroundColor} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundColor: event.target.value } })} /></Field>
              <Field label="背景图"><input value={draft.canvas.backgroundImage} onChange={(event) => setDraft({ ...draft, canvas: { ...draft.canvas, backgroundImage: event.target.value } })} /></Field>
            </Accordion>
            <Accordion title="图片区域" open>
              <Segmented label="图片比例" value={draft.image.ratio} options={['9:16', '4:3', '16:9']} onChange={(value) => setDraft({ ...draft, image: { ...draft.image, ratio: value } })} />
              <Segmented label="适配" value={draft.image.fit} options={['cover', 'contain']} onChange={(value) => setDraft({ ...draft, image: { ...draft.image, fit: value as 'cover' | 'contain' } })} />
              <Field label="垂直位置"><input type="range" min="-1" max="1" step="0.01" value={draft.image.top} onChange={(event) => setDraft({ ...draft, image: { ...draft.image, top: Number(event.target.value) } })} /></Field>
              <Field label="高度占比"><input type="range" min="0.1" max="1" step="0.01" value={draft.image.height} onChange={(event) => setDraft({ ...draft, image: { ...draft.image, height: Number(event.target.value) } })} /></Field>
              <Segmented label="动画效果" value={draft.image.animation} options={imageAnimations.slice(0, 8)} onChange={(value) => setDraft({ ...draft, image: { ...draft.image, animation: value } })} />
            </Accordion>
            <Accordion title="主标题">
              <Field label="文字"><input value={draft.title.text} onChange={(event) => setDraft({ ...draft, title: { ...draft.title, text: event.target.value } })} /></Field>
              <Field label="字号"><input type="number" value={draft.title.fontSize} onChange={(event) => setDraft({ ...draft, title: { ...draft.title, fontSize: Number(event.target.value) } })} /></Field>
              <Field label="颜色"><input value={draft.title.color} onChange={(event) => setDraft({ ...draft, title: { ...draft.title, color: event.target.value } })} /></Field>
            </Accordion>
            <Accordion title="副标题"><Field label="字号"><input type="number" value={draft.subtitle.fontSize} onChange={(event) => setDraft({ ...draft, subtitle: { ...draft.subtitle, fontSize: Number(event.target.value) } })} /></Field></Accordion>
            <Accordion title="字幕"><Field label="字号"><input type="number" value={draft.caption.fontSize} onChange={(event) => setDraft({ ...draft, caption: { ...draft.caption, fontSize: Number(event.target.value) } })} /></Field></Accordion>
            <Accordion title="免责声明"><Field label="文字"><input value={draft.disclaimer.text} onChange={(event) => setDraft({ ...draft, disclaimer: { ...draft.disclaimer, text: event.target.value } })} /></Field></Accordion>
            <Accordion title="音频设置">
              <Field label="旁白音量"><input type="number" value={draft.audio.narrationVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, narrationVolume: Number(event.target.value) } })} /></Field>
              <Field label="BGM 音量"><input type="number" value={draft.audio.bgmVolume} onChange={(event) => setDraft({ ...draft, audio: { ...draft.audio, bgmVolume: Number(event.target.value) } })} /></Field>
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
    <div className={compact ? 'draft-preview-mini' : 'draft-preview-large'} style={{ aspectRatio: `${template.canvas.width} / ${template.canvas.height}`, background: template.canvas.backgroundColor }}>
      <div className="draft-image" style={{ top: `${template.image.top * 100}%`, height: `${template.image.height * 100}%` }} />
      {template.title.visible ? <div className="draft-title" style={{ color: template.title.color, fontSize: titleSize }}>{template.title.text}</div> : null}
      {template.subtitle.visible ? <div className="draft-subtitle" style={{ color: template.subtitle.color, fontSize: subtitleSize }}>副标题示例文字</div> : null}
      {template.caption.visible ? <div className="draft-caption" style={{ color: template.caption.color, fontSize: captionSize }}>字幕预览</div> : null}
      {template.disclaimer.visible ? <div className="draft-disclaimer">{template.disclaimer.text}</div> : null}
    </div>
  );
}

function SettingsPage({ api, state, applyState }: { api: StoryboundApi; state: AppState; applyState: (state: AppState) => void }) {
  const [section, setSection] = useState('llm');
  const [draft, setDraft] = useState<AppConfig>(state.config);
  const [diagnostics, setDiagnostics] = useState('');
  useEffect(() => setDraft(state.config), [state.config]);
  async function save() {
    applyState(await api.saveConfig(draft));
  }
  async function runDiagnostics() {
    const report = await api.runDiagnostics();
    setDiagnostics(JSON.stringify(report, null, 2));
  }
  const sections = [
    ['llm', Sparkles, 'LLM', '文案与分镜', '已配置'],
    ['image', ImageIcon, 'AI 绘图', '分镜图片', draft.image.apiKey ? '已配置' : '待配置'],
    ['tts', Bot, 'TTS 配音', '每镜语音', draft.tts.accessKey ? '已配置' : '待配置'],
    ['jianying', FolderOpen, '剪映', '草稿目录 · BGM', draft.jianying.draftPath ? '已配置' : '待配置'],
    ['activation', KeyRound, '激活与订阅', '试用 · 激活码', state.activation.status],
    ['creative', Wand2, 'AI 创作', 'IMA 知识库', '待配置'],
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
          <button className="primary-action slim" onClick={save}><Save size={15} />保存配置</button>
        </div>
        {section === 'llm' ? (
          <SettingsCard title="LLM 配置档案" status={maskConfigured(draft.llm.apiKey)}>
            <ConfigInput label="Provider" value={draft.llm.provider} onChange={(value) => setDraft({ ...draft, llm: { ...draft.llm, provider: value } })} />
            <ConfigInput label="Base URL" value={draft.llm.baseUrl} onChange={(value) => setDraft({ ...draft, llm: { ...draft.llm, baseUrl: value } })} />
            <ConfigInput label="API Key" value={draft.llm.apiKey} onChange={(value) => setDraft({ ...draft, llm: { ...draft.llm, apiKey: value } })} />
            <ConfigInput label="模型" value={draft.llm.model} onChange={(value) => setDraft({ ...draft, llm: { ...draft.llm, model: value } })} />
            <ConfigInput label="代理 URL" value={draft.llm.proxyUrl} onChange={(value) => setDraft({ ...draft, llm: { ...draft.llm, proxyUrl: value } })} />
          </SettingsCard>
        ) : null}
        {section === 'image' ? (
          <SettingsCard title="AI 绘图" status={draft.image.apiKey ? '已配置' : '待配置'}>
            <Segmented label="Provider" value={draft.imageProvider} options={['gpt_image', 'jimeng', 'custom', 'mock']} labels={['全能绘图', '即梦', '自定义', 'mock']} onChange={(value) => setDraft({ ...draft, imageProvider: value as AppConfig['imageProvider'] })} />
            <ConfigInput label="GPT Image API Key" value={draft.gptImage.apiKey} onChange={(value) => setDraft({ ...draft, gptImage: { ...draft.gptImage, apiKey: value } })} />
            <ConfigInput label="即梦 SESSION ID" value={draft.jimeng.sessionId} onChange={(value) => setDraft({ ...draft, jimeng: { ...draft.jimeng, sessionId: value } })} />
            <ConfigInput label="自定义 Base URL" value={draft.customImage.baseUrl} onChange={(value) => setDraft({ ...draft, customImage: { ...draft.customImage, baseUrl: value } })} />
            <Segmented label="分辨率" value={draft.gptImage.resolution ?? '2K'} options={['1K', '2K', '4K']} onChange={(value) => setDraft({ ...draft, gptImage: { ...draft.gptImage, resolution: value as '1K' | '2K' | '4K' } })} />
            <Field label="并发"><input type="range" min="1" max="6" value={draft.image.concurrency} onChange={(event) => setDraft({ ...draft, image: { ...draft.image, concurrency: Number(event.target.value) } })} /></Field>
          </SettingsCard>
        ) : null}
        {section === 'tts' ? (
          <SettingsCard title="TTS 配音" status={draft.tts.accessKey ? '已配置' : '待配置'}>
            <Segmented label="引擎" value={draft.tts.provider} options={['volcengine', 'minimax', 'mock']} labels={['火山引擎', 'MiniMax', 'mock']} onChange={(value) => setDraft({ ...draft, tts: { ...draft.tts, provider: value as AppConfig['tts']['provider'] } })} />
            <ConfigInput label="火山 App ID" value={draft.tts.volcengine.appId} onChange={(value) => setDraft({ ...draft, tts: { ...draft.tts, volcengine: { ...draft.tts.volcengine, appId: value }, appId: value } })} />
            <ConfigInput label="Access Token" value={draft.tts.volcengine.accessKey} onChange={(value) => setDraft({ ...draft, tts: { ...draft.tts, volcengine: { ...draft.tts.volcengine, accessKey: value }, accessKey: value } })} />
            <ConfigInput label="MiniMax API Key" value={draft.tts.minimax.apiKey} onChange={(value) => setDraft({ ...draft, tts: { ...draft.tts, minimax: { ...draft.tts.minimax, apiKey: value } } })} />
            <ConfigInput label="默认音色" value={draft.tts.speaker} onChange={(value) => setDraft({ ...draft, tts: { ...draft.tts, speaker: value } })} />
            <LocalInfo title="克隆音色" value={`${state.minimaxCloneVoices.length} 个本地记录，可后续接入 MiniMax 克隆接口。`} />
          </SettingsCard>
        ) : null}
        {section === 'jianying' ? (
          <SettingsCard title="剪映草稿与 BGM" status={draft.jianying.draftPath ? '已配置' : '待配置'}>
            <ConfigInput label="Draft Path" value={draft.jianying.draftPath} onChange={(value) => setDraft({ ...draft, jianying: { ...draft.jianying, draftPath: value } })} />
            <LocalInfo title="BGM 库" value={draft.jianying.bgmLibrary.map((bgm) => bgm.title).join('、')} />
            <button className="ghost-action">+ 添加 BGM 文件</button>
          </SettingsCard>
        ) : null}
        {section === 'activation' ? <LocalInfo title="激活与订阅" value={state.activation.message} /> : null}
        {section === 'creative' ? (
          <SettingsCard title="AI 创作 / IMA 知识库" status={draft.ima.apiKey ? '已配置' : '待配置'}>
            <ConfigInput label="Client ID" value={draft.ima.clientId} onChange={(value) => setDraft({ ...draft, ima: { ...draft.ima, clientId: value } })} />
            <ConfigInput label="API Key" value={draft.ima.apiKey} onChange={(value) => setDraft({ ...draft, ima: { ...draft.ima, apiKey: value } })} />
            <ConfigInput label="Knowledge Base" value={draft.ima.kbName} onChange={(value) => setDraft({ ...draft, ima: { ...draft.ima, kbName: value } })} />
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
          <p>{event.detail}</p>
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

function formatDuration(start: string, end: string | null): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
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
