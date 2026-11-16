import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpenText,
  Check,
  Clapperboard,
  Download,
  FileText,
  Images,
  Layers3,
  Plus,
  Save,
  Scissors,
  Sparkles,
  Video,
  Volume2,
} from 'lucide-react';
import type { MotionComicPipelineData, MotionComicWorkflowStage } from '../../shared/motion-comic';
import { Button, IconButton, Tabs, Toolbar } from '../../ui';
import { motionComicOverviewRows } from './motion-comic-overview';
import { motionComicBackTarget } from './motion-comic-navigation';

export interface MotionComicStageState {
  ready: boolean;
  complete: boolean;
  detail: string;
}

interface MotionComicProductionWorkspaceProps {
  document: MotionComicPipelineData;
  stage: MotionComicWorkflowStage;
  stageState: Record<MotionComicWorkflowStage, MotionComicStageState>;
  dirty: boolean;
  busy: boolean;
  showProjectHeader?: boolean;
  /** Current episode shown as a badge in the project header, e.g. "EP01 · 标题". */
  episodeLabel?: string;
  navigationMemory?: { current: { projectId: string; stages: Record<string, MotionComicWorkflowStage> } };
  feedback?: string;
  errorMessage?: string;
  /** Project-level controls (models, tasks) rendered inside the single project header. */
  headerActions?: ReactNode;
  children: ReactNode;
  onStageChange: (stage: MotionComicWorkflowStage) => void;
  onSave: () => void;
  onNewProject: () => void;
  onBack: () => void;
}

const STAGES: Array<{ id: MotionComicWorkflowStage; label: string; shortLabel: string; icon: ReactElement }> = [
  { id: 'source', label: '剧本导入', shortLabel: '剧本', icon: <FileText size={15} /> },
  { id: 'episodes', label: '分集拆解', shortLabel: '分集', icon: <Scissors size={15} /> },
  { id: 'scenes', label: '分幕分场', shortLabel: '分幕', icon: <Layers3 size={15} /> },
  { id: 'storyboard', label: '分镜图', shortLabel: '分镜图', icon: <Images size={15} /> },
  { id: 'video', label: '视频生成', shortLabel: '视频', icon: <Video size={15} /> },
  { id: 'audio', label: '配音合成', shortLabel: '配音', icon: <Volume2 size={15} /> },
  { id: 'export', label: '成片导出', shortLabel: '导出', icon: <Download size={15} /> },
];

export function nextMotionComicWorkflowStage(
  stage: MotionComicWorkflowStage,
  stageState: Record<MotionComicWorkflowStage, MotionComicStageState>,
): MotionComicWorkflowStage | undefined {
  const domains: Array<{ id: string; stages: MotionComicWorkflowStage[] }> = [
    { id: 'script', stages: ['episodes', 'scenes'] },
    { id: 'assets', stages: ['assets'] },
    { id: 'production', stages: ['video', 'storyboard'] },
    { id: 'preview', stages: ['export'] },
  ];
  const currentDomain = domains.findIndex((domain) => domain.stages.includes(stage));
  const order = [...domains.slice(Math.max(0, currentDomain + 1)), ...domains.slice(0, Math.max(0, currentDomain + 1))];
  const next = order.flatMap((domain) => domain.stages).find((id) => id !== 'storyboard' && stageState[id].ready && !stageState[id].complete);
  return next ?? undefined;
}

const DOMAINS = [
  { id: 'script', label: '剧本', stages: ['source', 'episodes', 'scenes'] },
  { id: 'assets', label: '资产', stages: ['assets'] },
  { id: 'production', label: '制作', stages: ['video', 'storyboard'] },
  { id: 'preview', label: '预览', stages: ['export'] },
] as const;

export function MotionComicProductionWorkspace({
  document,
  stage,
  stageState,
  dirty,
  busy,
  showProjectHeader = true,
  episodeLabel,
  navigationMemory,
  feedback,
  errorMessage,
  headerActions,
  children,
  onStageChange,
  onSave,
  onNewProject,
  onBack,
}: MotionComicProductionWorkspaceProps): ReactElement {
  const active = stage === 'assets' ? { label: '项目资产' } : STAGES.find((item) => item.id === stage) ?? STAGES[0];
  const domain = DOMAINS.find((item) => (item.stages as readonly string[]).includes(stage)) ?? DOMAINS[0];
  const visibleStages = STAGES.filter((item) => (domain.stages as readonly string[]).includes(item.id) && item.id !== 'scenes' && item.id !== 'storyboard')
    .map((item) => item.id === 'video' ? { ...item, label: '分镜与视频制作', shortLabel: '制作' } : item);
  const activeStageId = stage === 'scenes' ? 'episodes' : stage === 'storyboard' ? 'video' : stage;
  const nextStage = nextMotionComicWorkflowStage(stage, stageState);
  const nextStageInfo = nextStage === 'assets' ? { id: 'assets' as const, label: '项目资产' } : STAGES.find((item) => item.id === nextStage);
  const localNavigationMemory = useRef<{ projectId: string; stages: Record<string, MotionComicWorkflowStage> }>({ projectId: document.id, stages: {} });
  const visited = navigationMemory ?? localNavigationMemory;
  useEffect(() => {
    if (visited.current.projectId !== document.id) visited.current = { projectId: document.id, stages: {} };
    visited.current.stages[domain.id] = stage;
  }, [document.id, domain.id, stage, visited]);
  const domainTabs = <div className="motion-comic-production__sections">
    <Tabs label="漫剧项目功能区" value={domain.id} onChange={(value) => {
      if (busy || value === domain.id) return;
      const target = DOMAINS.find((item) => item.id === value);
      const previous = visited.current.projectId === document.id ? visited.current.stages[value] : undefined;
      const next = previous && stageState[previous].ready ? previous
        : target?.stages.filter((item) => item !== 'scenes').find((item) => stageState[item].ready && !stageState[item].complete)
          ?? target?.stages.filter((item) => item !== 'scenes').find((item) => stageState[item].ready);
      if (next) onStageChange(next);
    }} items={DOMAINS.map((item) => ({
      value: item.id,
      label: item.label,
      disabled: busy || !item.stages.some((target) => stageState[target].ready),
    }))} />
    {showProjectHeader ? null : <small>{stageState.assets.detail}</small>}
  </div>;
  return (
    <div className={`motion-comic-production is-${stage}`} data-motion-comic-production data-stage={stage}>
      {showProjectHeader ? <header className="motion-comic-production__header is-unified">
        <div className="motion-comic-production__identity">
          <IconButton label={motionComicBackTarget(stage).label} icon={<ArrowLeft size={15} />} variant="subtle" density="compact" disabled={busy} onClick={onBack} />
          <span className="motion-comic-production__mark"><BookOpenText size={17} /></span>
          <div><strong title={document.title}>{document.title}</strong><small>{episodeLabel ? <span className="motion-comic-production__episode" title={episodeLabel}>{episodeLabel}</span> : null}{active.label} · {motionComicOverviewRows(document).length} 集 · {stageState.assets.detail}</small></div>
        </div>
        {domainTabs}
        <Toolbar aria-label="漫剧项目操作">
          {headerActions}
          <span className="motion-comic-production__save-state" data-dirty={dirty} title={dirty ? '有未保存改动' : '已保存'}>{dirty ? '未保存' : '已保存'}</span>
          <IconButton label="新建 AI 漫剧" icon={<Plus size={15} />} variant="subtle" density="compact" disabled={busy} onClick={onNewProject} />
          <Button className="motion-comic-production__save" variant={dirty ? 'primary' : 'subtle'} density="compact" icon={<Save size={14} />} disabled={!dirty || busy} onClick={onSave}>保存</Button>
        </Toolbar>
      </header> : domainTabs}
      {nextStage && nextStageInfo && stage !== 'export' ? <div className="motion-comic-production__next-step" role="status">
        <span><strong>下一步：{nextStageInfo.label}</strong><small>{stageState[nextStage].detail}</small></span>
        <Button density="compact" variant="secondary" disabled={busy} onClick={() => onStageChange(nextStage)}>前往</Button>
      </div> : stage !== 'export' ? <div className="motion-comic-production__next-step is-complete" role="status"><span><strong>当前分集流程已完成</strong><small>可回到任一阶段修改内容或检查成片。</small></span></div> : null}
      {visibleStages.length > 1 ? <nav className="motion-comic-production__stages" aria-label={`${domain.label}子流程`}>
        {visibleStages.map((item, index) => {
          const status = stageState[item.id];
          return <Button
            key={item.id}
            density="compact"
            variant="subtle"
            className={item.id === activeStageId ? 'is-active' : status.complete ? 'is-complete' : ''}
            aria-current={item.id === activeStageId ? 'step' : undefined}
            aria-label={`${index + 1}. ${item.label}，${status.complete ? '已完成' : status.ready ? '可开始' : '等待前序步骤'}`}
            title={`${item.label} · ${status.detail}`}
            disabled={!status.ready || busy}
            icon={status.complete ? <Check size={14} /> : item.icon}
            onClick={() => onStageChange(item.id)}
          >
            <span className="comic-stage-number">{index + 1}</span><span className="comic-stage-copy"><strong>{item.shortLabel}</strong><small>{status.detail}</small></span>
          </Button>;
        })}
      </nav> : null}

      {feedback || errorMessage ? <div className={`motion-comic-production__notice ${errorMessage ? 'is-error' : 'is-success'}`} role={errorMessage ? 'alert' : 'status'}>
        {errorMessage ? <Clapperboard size={15} /> : <Sparkles size={15} />}
        <span>{errorMessage ?? feedback}</span>
      </div> : null}

      <div className="motion-comic-production__body">{children}</div>
    </div>
  );
}
