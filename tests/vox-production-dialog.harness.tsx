import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, StoryDreamProvider } from '../src/ui';
import { useAsyncAction } from '../src/ui/async-action';
import { AsyncActionFeedback } from '../src/components/AsyncActionFeedback';
import { VoxProductionDialog } from '../src/features/editorial-collage/VoxProductionDialog';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { voxProductionSettings, type VoxProductionSettings } from '../src/shared/vox-production';
import '../src/styles.css';
import '../src/styles/features/director-desk.css';
import '../src/styles/features/vox-process-workspace.css';

const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'production-feedback-qa', title: '城市热岛', ratio: '16:9' }), '道路与建筑吸收阳光。树荫可以降低地表温度。', '2026-11-03T00:00:00.000Z', 15000);
document.productionSettings = { ...voxProductionSettings(), narration: false, generateImages: false, authoring: { mode: 'ai-code', styleId: 'caption-news' } };
const control = {
  failure: 'LEMO_CAPABILITY_NOT_TESTED: 当前项目模型尚未完成 Lemo 能力验证，请先在系统设置中验证工具调用、图片输入和多轮反馈。',
  hold: false,
  finish: undefined as (() => void) | undefined,
  calls: [] as { action: string; settings: VoxProductionSettings }[],
};
Object.assign(window, { productionFeedbackQA: control });

function App() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => { window.document.documentElement.dataset.theme = theme; }, [theme]);
  const action = useAsyncAction();
  async function submit(name: string, settings: VoxProductionSettings) {
    const result = await action.run(async () => {
      control.calls.push({ action: name, settings });
      if (control.hold) await new Promise<void>(resolve => { control.finish = resolve; });
      if (control.failure) throw new Error(control.failure);
      document.productionSettings = settings;
    });
    if (result.ok) setOpen(false);
  }
  return <StoryDreamProvider theme={theme}>
    <main style={{ minHeight: '100vh', padding: 24, boxSizing: 'border-box', background: 'var(--shell-bg)', color: 'var(--shell-text)' }}>
      <h1>自动制作 · 失败反馈验收</h1>
      <p>离线测试项目，使用真实弹窗与异步状态；不会提交模型请求。</p>
      <Button onClick={() => { action.clearFeedback(); setOpen(true); }}>自动制作…</Button>
      <Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>切换主题</Button>
      <AsyncActionFeedback feedback={action.feedback} />
    </main>
    <VoxProductionDialog open={open} document={document} busy={action.busy} feedback={action.feedback} onClose={() => setOpen(false)}
      onStart={settings => submit('start', settings)} onSave={settings => submit('save', settings)} onApply={settings => submit('apply', settings)}
      onOpenUrl={async () => { throw new Error('离线验收不播放网络样片'); }} musicLibrary={[]} api={{ importBgmAudio: async () => null }} />
  </StoryDreamProvider>;
}
createRoot(window.document.getElementById('root')!).render(<App />);
