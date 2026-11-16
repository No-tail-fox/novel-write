import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { DirectorDeskWorkspace, type DirectorDeskWorkspaceProps } from '../src/features/director-desk/DirectorDeskWorkspace';
import '../src/styles.css';

const controls = {
  requests: [] as string[],
  pending: [] as { resolve: (value: boolean) => void; reject: (error: Error) => void }[],
  release(value: boolean) { this.pending.shift()!.resolve(value); },
  fail() { this.pending.shift()!.reject(new Error('QA export destination unavailable')); },
};
const props: DirectorDeskWorkspaceProps = {
  mode: 'motion-comic', projectTitle: '历史版本另存 QA', projectMeta: '本地 mock · 无外部服务',
  episodeTitle: '第一集', stageLabel: '导出', selectedShotId: 'shot-qa', dirty: false,
  shots: [{ id: 'shot-qa', index: 1, title: '测试镜头', scene: '场景一', durationMs: 4000,
    framing: '中景', characterLabel: '', prompt: '', motionPrompt: '', subtitle: '', status: 'idle' }],
  outputHistory: [
    { id: 'asset-history-A-exact', createdAt: '2026-01-01T10:00:00Z', current: false, status: 'unavailable', error: 'QA 未载入媒体（仅验证另存交互）' },
    { id: 'asset-history-B-exact', createdAt: '2026-01-02T10:00:00Z', current: false, status: 'unavailable', error: 'QA 未载入媒体（仅验证另存交互）' },
  ],
  onSelectShot: () => {}, onUpdateShot: () => {}, onSave: () => {},
  onExportOutputVersion: async (id) => {
    controls.requests.push(id);
    return await new Promise<boolean>((resolve, reject) => controls.pending.push({ resolve, reject }));
  },
};
Object.assign(window, { historyExportQA: controls });
createRoot(document.getElementById('root')!).render(<StoryDreamProvider theme="dark"><DirectorDeskWorkspace {...props} /></StoryDreamProvider>);
