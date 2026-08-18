import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  Clapperboard,
  Clock3,
  Film,
  FolderOpen,
  Images,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { Button, Pane, Toolbar } from '../../ui';
import type { DirectorDeskMode, DirectorProjectOption } from './DirectorDeskWorkspace';

export const DIRECTOR_CREATE_STEPS = ['内容结构', '生成与一致性', '声音与输出'] as const;

export interface DirectorProjectLibraryProps {
  mode: DirectorDeskMode;
  projects: readonly DirectorProjectOption[];
  busy?: boolean;
  feedback?: string;
  errorMessage?: string;
  onOpenProject: (id: string) => void;
  onNewProject: () => void;
  onBackHome: () => void;
  onSwitchMode: (mode: DirectorDeskMode) => void;
}

export function DirectorProjectLibrary({
  mode,
  projects,
  busy = false,
  feedback,
  errorMessage,
  onOpenProject,
  onNewProject,
  onBackHome,
  onSwitchMode,
}: DirectorProjectLibraryProps) {
  const copy = workflowCopy(mode);
  const lastProject = projects[0];
  return (
    <div className="director-start" data-director-project-library data-director-mode={mode}>
      <header className="director-start-header">
        <Toolbar aria-label="视频工作流导航">
          <Button variant="subtle" icon={<ArrowLeft size={14} />} onClick={onBackHome}>返回首页</Button>
          <Button variant={mode === 'vox' ? 'primary' : 'subtle'} icon={<Clapperboard size={14} />} onClick={() => onSwitchMode('vox')}>VOX 视频</Button>
          <Button variant={mode === 'motion-comic' ? 'primary' : 'subtle'} icon={<Images size={14} />} onClick={() => onSwitchMode('motion-comic')}>AI 漫剧</Button>
        </Toolbar>
        <div className="director-start-title">
          <span className="director-start-mark">{mode === 'vox' ? <Film size={20} /> : <BookOpenCheck size={20} />}</span>
          <div>
            <span>{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.description}</p>
          </div>
        </div>
        <Toolbar aria-label="项目操作" className="director-start-actions">
          {lastProject ? <Button variant="secondary" icon={<ArrowRight size={15} />} disabled={busy} onClick={() => onOpenProject(lastProject.id)}>继续上次项目</Button> : null}
          <Button variant="primary" icon={<Plus size={15} />} disabled={busy} onClick={onNewProject}>新建项目</Button>
        </Toolbar>
      </header>

      <main className="director-library-body">
        <div className="director-library-heading">
          <div><h2>项目库</h2><span>{projects.length > 0 ? `${projects.length} 个本地项目` : '还没有项目'}</span></div>
          <span><ShieldCheck size={14} />项目只保存在本机，打开后继续上次镜头与版本。</span>
        </div>
        {projects.length > 0 ? (
          <div className="director-project-list" aria-label={`${copy.shortLabel}项目列表`}>
            {projects.map((project, index) => (
              <Button key={project.id} variant="subtle" className="director-project-card" onClick={() => onOpenProject(project.id)} disabled={busy}>
                <span className="director-project-card__thumb">{mode === 'vox' ? <Clapperboard size={19} /> : <Images size={19} />}</span>
                <span className="director-project-card__copy"><strong>{project.title}</strong><small>{project.meta}</small></span>
                {index === 0 ? <span className="director-project-card__recent">最近编辑</span> : null}
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            ))}
          </div>
        ) : (
          <div className="director-library-empty">
            <FolderOpen size={32} />
            <strong>从第一个项目开始</strong>
            <span>{copy.emptyHint}</span>
            <Button variant="primary" icon={<Plus size={15} />} onClick={onNewProject}>新建项目</Button>
          </div>
        )}
        {busy ? <div className="director-start-feedback" role="status"><Loader2 className="director-spin" size={15} />正在恢复项目和本地素材...</div> : null}
        {feedback ? <div className="director-start-feedback is-success" role="status"><Check size={15} />{feedback}</div> : null}
        {errorMessage ? <div className="director-start-feedback is-error" role="alert">{errorMessage}</div> : null}
      </main>
    </div>
  );
}

export interface DirectorCreateWizardProps {
  mode: DirectorDeskMode;
  step: number;
  busy?: boolean;
  canContinue: boolean;
  canCreate: boolean;
  providerConnected: boolean;
  providerLabel: string;
  voiceConnected: boolean;
  voiceLabel: string;
  summary: readonly { label: string; value: string }[];
  children: ReactNode;
  feedback?: string;
  errorMessage?: string;
  onBackLibrary: () => void;
  onSwitchMode: (mode: DirectorDeskMode) => void;
  onStepChange: (step: number) => void;
  onConfigureImage: () => void;
  onConfigureVoice: () => void;
  onCreate: () => void;
}

export function DirectorCreateWizard({
  mode,
  step,
  busy = false,
  canContinue,
  canCreate,
  providerConnected,
  providerLabel,
  voiceConnected,
  voiceLabel,
  summary,
  children,
  feedback,
  errorMessage,
  onBackLibrary,
  onSwitchMode,
  onStepChange,
  onConfigureImage,
  onConfigureVoice,
  onCreate,
}: DirectorCreateWizardProps) {
  const copy = workflowCopy(mode);
  return (
    <div className="director-create-panel" data-director-create-wizard data-director-mode={mode}>
      <div className="director-create-page">
        <header className="director-create-header">
          <Toolbar aria-label="视频工作流导航">
            <Button variant="subtle" icon={<ArrowLeft size={14} />} onClick={onBackLibrary}>返回项目库</Button>
            <Button variant={mode === 'vox' ? 'primary' : 'subtle'} icon={<Clapperboard size={14} />} onClick={() => onSwitchMode('vox')}>VOX 视频</Button>
            <Button variant={mode === 'motion-comic' ? 'primary' : 'subtle'} icon={<Images size={14} />} onClick={() => onSwitchMode('motion-comic')}>AI 漫剧</Button>
          </Toolbar>
          <div className="director-create-heading">
            {mode === 'vox' ? <Film size={19} /> : <BookOpenCheck size={19} />}
            <div><h1>{copy.createTitle}</h1><span>{copy.createDescription}</span></div>
          </div>
        </header>

        <nav className="director-create-steps" aria-label="创建步骤">
          {DIRECTOR_CREATE_STEPS.map((label, index) => (
            <Button key={label} variant="subtle" className={index === step ? 'is-active' : index < step ? 'is-complete' : ''} aria-current={index === step ? 'step' : undefined} disabled={index > step || busy} onClick={() => onStepChange(index)}>
              <span>{index < step ? <Check size={13} /> : index + 1}</span><strong>{label}</strong>
            </Button>
          ))}
        </nav>

        <div className="director-create-layout">
          <Pane as="main" tone="base" className="director-create-form">
            <div className="director-create-section-heading"><span>步骤 {step + 1} / 3</span><h2>{DIRECTOR_CREATE_STEPS[step]}</h2></div>
            <div className="director-create-fields">{children}</div>
            {feedback ? <div className="director-start-feedback is-success" role="status"><Check size={15} />{feedback}</div> : null}
            {errorMessage ? <div className="director-start-feedback is-error" role="alert">{errorMessage}</div> : null}
            <Toolbar aria-label="创建步骤操作" className="director-create-footer">
              <Button variant="subtle" disabled={step === 0 || busy} onClick={() => onStepChange(step - 1)}>上一步</Button>
              {step < DIRECTOR_CREATE_STEPS.length - 1 ? <Button variant="primary" icon={<ArrowRight size={14} />} disabled={!canContinue || busy} onClick={() => onStepChange(step + 1)}>下一步</Button> : mode === 'vox' ? <Button variant="primary" icon={busy ? <Loader2 className="director-spin" size={15} /> : <Sparkles size={15} />} disabled={!canCreate || busy} onClick={onCreate}>创建 VOX 项目</Button> : <Button variant="primary" icon={busy ? <Loader2 className="director-spin" size={15} /> : <Sparkles size={15} />} disabled={!canCreate || busy} onClick={onCreate}>创建 AI 漫剧系列</Button>}
            </Toolbar>
          </Pane>

          <aside className="director-create-summary" aria-label="创建预检">
            <section>
              <h2>创建摘要</h2>
              <dl>{summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value || '待填写'}</dd></div>)}</dl>
            </section>
            <section className="director-preflight-services">
              <h2>服务预检</h2>
              <div className={providerConnected ? 'is-ready' : 'is-warning'}><Images size={15} /><span><strong>图片服务</strong><small>{providerConnected ? `${providerLabel} 已连接` : '尚未连接，创建后不能生成镜头'}</small></span>{providerConnected ? <Check size={15} /> : <Button variant="subtle" icon={<Settings2 size={13} />} onClick={onConfigureImage}>去配置</Button>}</div>
              <div className={voiceConnected ? 'is-ready' : 'is-warning'}><Volume2 size={15} /><span><strong>旁白服务</strong><small>{voiceConnected ? `${voiceLabel} 已连接` : '尚未连接，可先创建本地项目'}</small></span>{voiceConnected ? <Check size={15} /> : <Button variant="subtle" icon={<Settings2 size={13} />} onClick={onConfigureVoice}>去配置</Button>}</div>
            </section>
            <div className="director-create-cost"><Clock3 size={14} /><span><strong>创建项目本身不调用付费生成</strong><small>进入导演台后，每次生成前都会显示当前服务和接口计费说明。</small></span></div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function DirectorProjectLoading({ mode, onCancel }: { mode: DirectorDeskMode; onCancel: () => void }) {
  return (
    <div className="director-project-loading" role="status" aria-live="polite">
      <Loader2 className="director-spin" size={24} />
      <strong>正在恢复{mode === 'vox' ? ' VOX ' : ' AI 漫剧'}项目</strong>
      <span>正在读取镜头、版本和本地素材，完成前不会显示空白工作台。</span>
      <Button variant="subtle" onClick={onCancel}>返回项目库</Button>
    </div>
  );
}

function workflowCopy(mode: DirectorDeskMode) {
  if (mode === 'vox') return {
    eyebrow: '解释型短视频工作流',
    title: 'VOX 视觉导演',
    shortLabel: 'VOX',
    description: '从文案结构、画面一致性到旁白与本地成片，在一个导演台内完成。',
    emptyHint: '粘贴一段文案，完成生成服务与输出预检后进入四镜头导演台。',
    createTitle: '新建 VOX 项目',
    createDescription: '先确认内容结构，再锁定生成、一致性、声音和输出。',
  };
  return {
    eyebrow: '系列化 AI 漫剧工作流',
    title: 'AI 漫剧导演',
    shortLabel: 'AI 漫剧',
    description: '先建立系列圣经、角色与场景，再按分集推进镜头、对白和成片。',
    emptyHint: '创建系列、主角和核心场景，首集会生成可继续编辑的三场六镜结构。',
    createTitle: '新建 AI 漫剧系列',
    createDescription: '创建前锁定系列方向、角色身份、场景和生成服务。',
  };
}
