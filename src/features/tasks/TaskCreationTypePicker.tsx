import { Clapperboard, Code2, Images, WandSparkles } from 'lucide-react';
import type { ShellView } from '../../shared/types';
import { Button } from '../../ui';

export type TaskCreationType = 'smart-video' | 'vox' | 'motion-comic' | 'html-video';

const taskCreationTypes = [
  { id: 'smart-video', label: '智能成片', description: '文案、分镜、配音与剪映草稿', icon: WandSparkles },
  { id: 'vox', label: 'VOX 视频', description: '解释型拼贴与视觉叙事', icon: Clapperboard },
  { id: 'motion-comic', label: 'AI 漫剧', description: '系列、角色一致性与分镜', icon: Images },
  { id: 'html-video', label: 'HTML 动画', description: '代码动画与可编辑场景', icon: Code2 },
] as const satisfies readonly { id: TaskCreationType; label: string; description: string; icon: typeof WandSparkles }[];

export function taskCreationTarget(type: TaskCreationType): ShellView {
  if (type === 'vox') return 'editorial-collage';
  if (type === 'motion-comic') return 'motion-comic';
  if (type === 'html-video') return 'html-video';
  return 'new-task';
}

export function TaskCreationTypePicker({
  activeType,
  navigate,
}: {
  activeType: TaskCreationType;
  navigate: (view: ShellView) => void;
}) {
  return (
    <section className="new-task-type-picker" aria-labelledby="new-task-type-label">
      <span id="new-task-type-label" className="new-task-type-label">创作类型</span>
      <div className="new-task-type-options">
        {taskCreationTypes.map((type) => {
          const Icon = type.icon;
          return (
            <Button
              key={type.id}
              variant={type.id === activeType ? 'primary' : 'subtle'}
              density="compact"
              aria-pressed={type.id === activeType}
              data-task-creation-type={type.id}
              icon={<Icon size={16} />}
              onClick={() => navigate(taskCreationTarget(type.id))}
            >
              <span><strong>{type.label}</strong><small>{type.description}</small></span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
