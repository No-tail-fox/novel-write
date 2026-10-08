import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { VoxAnimationEditor } from '../src/features/vox-animation/VoxAnimationEditor';
import { VoxAnimationPreview, type VoxApi } from '../src/features/vox-animation/VoxAnimationPreview';
import { createVoxAnimation, VOX_TEMPLATES } from '../src/shared/vox-animation';
import '../src/styles.css';

const api: VoxApi = {
  getVoxAnimationRuntime: async () => (await fetch('/runtime.js')).text(),
  readVoxAnimationAsset: async () => { throw new Error('Sample preview must not read project assets'); },
  compileVoxAnimation: async () => { throw new Error('No code model in catalog preview'); },
  generateVoxAnimation: async () => { throw new Error('No paid model in catalog preview'); },
  cancelVoxAnimation: async () => {}, listVoxTemplates: async () => {
    const animation = createVoxAnimation('个人字幕样式', '保存的个人内容');
    animation.template.id = 'audio-captions';
    const crossProjectAnimation = createVoxAnimation('另一个项目的纸片镜头', '保留我的个人模板内容');
    crossProjectAnimation.template.id = 'paper-actors';
    crossProjectAnimation.template.props.assetIds = ['other-project-background', 'other-project-subject'];
    return [
      { id: 'saved-captions', name: '我的字幕模板', animation, updatedAt: '2026-09-16T00:00:00.000Z' },
      { id: 'saved-missing-assets', name: '跨项目纸片模板', animation: crossProjectAnimation, updatedAt: '2026-09-16T00:00:00.000Z' },
    ];
  },
  saveVoxTemplate: async () => [], deleteVoxTemplate: async () => [],
};
function Host() {
  const [animation, setAnimation] = useState(createVoxAnimation('我的原始镜头标题', '我的草稿说明'));
  const [ratio, setRatio] = useState('16:9'), [ready, setReady] = useState(false);
  Object.assign(window, { catalogQA: { templates: VOX_TEMPLATES.map(({ id, name }) => ({ id, name })), snapshot: () => animation, setRatio } });
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 24, padding: 24, color: 'var(--shell-text)', background: 'var(--shell-bg)', minHeight: '100vh' }}>
    <div><h2>当前镜头草稿</h2><div style={{ position: 'relative', aspectRatio: '16/9' }}><VoxAnimationPreview animation={animation} api={api} assets={[]} ratio={ratio} durationMs={6000} timeMs={2000} onReady={setReady} /></div></div>
    <VoxAnimationEditor shotId="catalog-qa" animation={animation} title="我的原始镜头标题" subtitle="我的草稿说明" api={api} assets={[]} ratio={ratio} durationMs={6000} busy={false} onChange={setAnimation} previewReady={ready} onExport={async () => true} />
  </div>;
}
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme={theme}><Host /></StoryDreamProvider>);
