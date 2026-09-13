import type { ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CircleAlert,
  Clock3,
  Film,
  Images,
  Loader2,
  PencilLine,
  Plus,
  Settings2,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { Button, Pane, Toolbar } from '../../ui';
import type { DirectorDeskMode } from './DirectorDeskWorkspace';

export const DIRECTOR_CREATE_STEPS = ['内容结构', '生成与一致性', '声音与输出'] as const;

export interface DirectorCopyAssistProps {
  activeIntent: 'create' | 'revise' | null;
  canCreate: boolean;
  canRevise: boolean;
  feedback?: { tone: 'error' | 'success'; message: string } | null;
  onCreate: () => void;
  onRevise: () => void;
}

export function DirectorCopyAssist({ activeIntent, canCreate, canRevise, feedback, onCreate, onRevise }: DirectorCopyAssistProps) {
  return (
    <div className="director-copy-assist" data-director-copy-assist>
      <Toolbar aria-label="AI 文案辅助">
        <Button variant="secondary" icon={activeIntent === 'create' ? <Loader2 className="director-spin" size={14} /> : <Sparkles size={14} />} disabled={!canCreate || activeIntent !== null} onClick={onCreate}>
          {activeIntent === 'create' ? '创作中' : 'AI 创作'}
        </Button>
        <Button variant="subtle" icon={activeIntent === 'revise' ? <Loader2 className="director-spin" size={14} /> : <PencilLine size={14} />} disabled={!canRevise || activeIntent !== null} onClick={onRevise}>
          {activeIntent === 'revise' ? '修改中' : 'AI 修改'}
        </Button>
      </Toolbar>
      {feedback ? <span className={`director-copy-assist-feedback is-${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>{feedback.message}</span> : null}
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
  onBack: () => void;
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
  onBack,
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
            <Button variant="subtle" icon={<ArrowLeft size={14} />} onClick={onBack}>返回新建任务</Button>
          </Toolbar>
          <div className="director-create-heading">
            {mode === 'vox' ? <Film size={19} /> : <BookOpenCheck size={19} />}
            <div><h2>{copy.createTitle}</h2><span>{copy.createDescription}</span></div>
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
      <Button variant="subtle" onClick={onCancel}>返回全部任务</Button>
    </div>
  );
}

export function DirectorProjectRecovery({
  mode,
  errorMessage,
  returnLabel = '返回全部任务',
  onReturnTasks,
  onNewProject,
}: {
  mode: DirectorDeskMode;
  errorMessage?: string;
  returnLabel?: string;
  onReturnTasks: () => void;
  onNewProject: () => void;
}) {
  return (
    <div className="director-project-recovery" data-director-project-recovery data-director-mode={mode}>
      <CircleAlert size={24} />
      <strong>{mode === 'vox' ? '无法打开 VOX 项目' : '无法打开 AI 漫剧项目'}</strong>
      <span role={errorMessage ? 'alert' : undefined}>{errorMessage || '项目不存在、已归档或本地数据暂时不可用。'}</span>
      <Toolbar aria-label="项目恢复操作">
        <Button variant="secondary" icon={<ArrowLeft size={14} />} onClick={onReturnTasks}>{returnLabel}</Button>
        <Button variant="primary" icon={<Plus size={14} />} onClick={onNewProject}>{mode === 'vox' ? '新建 VOX 项目' : '新建 AI 漫剧系列'}</Button>
      </Toolbar>
    </div>
  );
}

function workflowCopy(mode: DirectorDeskMode) {
  if (mode === 'vox') return {
    createTitle: '新建 VOX 项目',
    createDescription: '先确认内容结构，再锁定生成、一致性、声音和输出。',
  };
  return {
    createTitle: '新建 AI 漫剧系列',
    createDescription: '创建前锁定系列方向、角色身份、场景和生成服务。',
  };
}
