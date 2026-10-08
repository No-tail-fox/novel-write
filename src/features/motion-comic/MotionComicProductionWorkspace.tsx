import type { ReactElement, ReactNode } from 'react';
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
  Users,
  Video,
  Volume2,
} from 'lucide-react';
import type { MotionComicPipelineData, MotionComicWorkflowStage } from '../../shared/motion-comic';
import { Button, IconButton, Toolbar } from '../../ui';

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
  feedback?: string;
  errorMessage?: string;
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
  { id: 'assets', label: '角色资产', shortLabel: '资产', icon: <Users size={15} /> },
  { id: 'storyboard', label: '分镜图', shortLabel: '分镜图', icon: <Images size={15} /> },
  { id: 'video', label: '视频生成', shortLabel: '视频', icon: <Video size={15} /> },
  { id: 'audio', label: '配音合成', shortLabel: '配音', icon: <Volume2 size={15} /> },
  { id: 'export', label: '成片导出', shortLabel: '导出', icon: <Download size={15} /> },
];

export function MotionComicProductionWorkspace({
  document,
  stage,
  stageState,
  dirty,
  busy,
  showProjectHeader = true,
  feedback,
  errorMessage,
  children,
  onStageChange,
  onSave,
  onNewProject,
  onBack,
}: MotionComicProductionWorkspaceProps): ReactElement {
  const active = STAGES.find((item) => item.id === stage) ?? STAGES[0];
  return (
    <div className={`motion-comic-production is-${stage}`} data-motion-comic-production data-stage={stage}>
      {showProjectHeader ? <header className="motion-comic-production__header">
        <div className="motion-comic-production__identity">
          <IconButton label="返回项目列表" icon={<ArrowLeft size={15} />} variant="subtle" density="compact" onClick={onBack} />
          <span className="motion-comic-production__mark"><BookOpenText size={17} /></span>
          <div><strong>{document.title}</strong><small>{active.label} · {document.sourceDocument?.episodes.length ?? document.episodes.length} 集</small></div>
        </div>
        <Toolbar aria-label="漫剧项目操作">
          <span className="motion-comic-production__save-state" data-dirty={dirty}>{dirty ? '未保存' : '已保存'}</span>
          <IconButton label="新建 AI 漫剧" icon={<Plus size={15} />} variant="subtle" density="compact" disabled={busy} onClick={onNewProject} />
          <Button variant={dirty ? 'primary' : 'subtle'} density="compact" icon={<Save size={14} />} disabled={!dirty || busy} onClick={onSave}>保存</Button>
        </Toolbar>
      </header> : null}

      <nav className="motion-comic-production__stages" aria-label="AI 漫剧制作流程">
        {STAGES.map((item, index) => {
          const status = stageState[item.id];
          return <Button
            key={item.id}
            density="compact"
            variant="subtle"
            className={item.id === stage ? 'is-active' : status.complete ? 'is-complete' : ''}
            aria-current={item.id === stage ? 'step' : undefined}
            aria-label={`${index + 1}. ${item.label}，${status.complete ? '已完成' : status.ready ? '可开始' : '等待前序步骤'}`}
            title={`${item.label} · ${status.detail}`}
            disabled={!status.ready || busy}
            icon={status.complete ? <Check size={14} /> : item.icon}
            onClick={() => onStageChange(item.id)}
          >
            <span>{index + 1}</span>{item.shortLabel}
          </Button>;
        })}
      </nav>

      {feedback || errorMessage ? <div className={`motion-comic-production__notice ${errorMessage ? 'is-error' : 'is-success'}`} role={errorMessage ? 'alert' : 'status'}>
        {errorMessage ? <Clapperboard size={15} /> : <Sparkles size={15} />}
        <span>{errorMessage ?? feedback}</span>
      </div> : null}

      <div className="motion-comic-production__body">{children}</div>
    </div>
  );
}
