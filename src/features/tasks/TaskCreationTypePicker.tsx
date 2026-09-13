import { Clapperboard, Code2, Images, Music, WandSparkles } from 'lucide-react';
import type { ShellView } from '../../shared/types';
import { Button } from '../../ui';

export type TaskCreationType = 'smart-video' | 'vox' | 'motion-comic' | 'html-video' | 'music-mv';

const taskCreationTypes = [
  { id: 'smart-video', label: '智能成片', description: '文案 · 分镜 · 配音', icon: WandSparkles },
  { id: 'vox', label: 'VOX 视频', description: '节拍 · 拼贴 · 运镜', icon: Clapperboard },
  { id: 'motion-comic', label: 'AI 漫剧', description: '系列 · 角色 · 分集', icon: Images },
  { id: 'html-video', label: 'HTML 动画', description: '场景 · 动画 · 代码', icon: Code2 },
  { id: 'music-mv', label: '音乐 MV', description: '歌曲 · 歌词 · 节奏', icon: Music },
] as const satisfies readonly { id: TaskCreationType; label: string; description: string; icon: typeof WandSparkles }[];

export function taskCreationTarget(type: TaskCreationType): ShellView {
  if (type === 'vox') return 'editorial-collage';
  if (type === 'motion-comic') return 'motion-comic';
  if (type === 'html-video') return 'html-video';
  if (type === 'music-mv') return 'music-mv';
  return 'new-task';
}

export function TaskCreationTypePicker({
  activeType,
  navigate,
  onSelect,
}: {
  activeType: TaskCreationType;
  navigate: (view: ShellView) => void;
  onSelect?: (type: TaskCreationType) => void;
}) {
  return (
    <section className="new-task-type-picker" aria-labelledby="new-task-type-label">
      <span id="new-task-type-label" className="new-task-type-label">制作类型</span>
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
              onClick={() => {
                if (onSelect) {
                  onSelect(type.id);
                  return;
                }
                navigate(taskCreationTarget(type.id));
              }}
            >
              <span><strong>{type.label}</strong><small>{type.description}</small></span>
            </Button>
          );
        })}
      </div>
    </section>
  );
}
