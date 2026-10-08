import { PreviewSelectField } from '../../ui';
import { resolveDirectorTransition, type DirectorTransition } from '../../shared/director-transitions';
import type { DirectorDeskWorkspaceProps, DirectorShot } from './DirectorDeskWorkspace';
import './director-option-preview.css';

const options: { value: DirectorTransition['type']; label: string; description: string }[] = [
  { value: 'dissolve', label: '短叠化', description: '用 0.2 秒柔和衔接前后镜头，保持旁白和整片时长。' },
  { value: 'cut', label: '直接切换', description: '在镜头边界立即切换画面，适合明确的节奏或观点变化。' },
];

export function DirectorTransitionSample({ type }: { type: DirectorTransition['type'] }) {
  return <div className={`director-transition-sample is-${type}`} data-preview-kind="transition" data-preview-value={type} aria-label={`${type === 'dissolve' ? '短叠化' : '直接切换'}转场示例`}>
    <div className="director-transition-scene director-transition-scene--before"><span>01</span><strong>从城市出发</strong></div>
    <div className="director-transition-scene director-transition-scene--after"><span>02</span><strong>走进街区生活</strong></div>
    <small>两镜衔接示例 · {type === 'dissolve' ? '0.2 秒叠化' : '直接切换'}</small>
  </div>;
}

export function DirectorTransitionField({ shot, onUpdate, busy }: { shot: DirectorShot; onUpdate: DirectorDeskWorkspaceProps['onUpdateShot']; busy: boolean }) {
  const transition = resolveDirectorTransition(shot.transitionIn);
  return <PreviewSelectField label="入场转场" value={transition.type} disabled={busy || shot.index === 1}
    options={options.map(option => ({ ...option, preview: () => <DirectorTransitionSample type={option.value} /> }))}
    hint={shot.index === 1 ? '首镜无需转场；从第二镜开始设置。' : '合成整片时生效；只过渡画面，不重叠或截短旁白。'}
    onChange={value => onUpdate(shot.id, { transitionIn: { type: value as DirectorTransition['type'], durationMs: value === 'cut' ? 0 : 200 } })} />;
}
