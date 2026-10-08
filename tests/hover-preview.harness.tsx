import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Dialog, HoverPreview, PreviewSelectField, StoryDreamProvider } from '../src/ui';
import { DirectorMotionSample } from '../src/features/director-desk/DirectorMotionPreview';
import { EDITORIAL_MOTION_STYLES } from '../src/shared/editorial-motion';
import '../src/styles.css';
function Host() {
  const [value, setValue] = useState('cutout-slide'), [open, setOpen] = useState(false);
  Object.assign(window, { hoverQA: { value: () => value } });
  return <main style={{ minHeight: '100vh', padding: 20, background: 'var(--shell-bg)', color: 'var(--shell-text)' }}>
    <HoverPreview title="边缘预览" renderPreview={() => <DirectorMotionSample style="comparison" />}><Button onClick={() => setOpen(true)}>边缘动作</Button></HoverPreview>
    <div style={{ width: 290, marginLeft: 'auto', marginTop: 150 }}>
      <PreviewSelectField label="叙事动作" value={value} options={EDITORIAL_MOTION_STYLES.map(style => ({ value: style.id, label: style.label, description: style.description, preview: () => <DirectorMotionSample style={style.id} /> }))} onChange={setValue} />
      <HoverPreview title="右侧预览" renderPreview={() => <DirectorMotionSample style="comparison" />}><Button onClick={() => setOpen(true)}>打开详细预览</Button></HoverPreview>
    </div>
    {open ? <Dialog open title="详细预览测试" onOpenChange={setOpen} actions={<Button onClick={() => setOpen(false)}>关闭详情</Button>}><p>详细预览继续可用</p></Dialog> : null}
  </main>;
}
const theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.dataset.theme = theme;
createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme={theme}><Host /></StoryDreamProvider>);
