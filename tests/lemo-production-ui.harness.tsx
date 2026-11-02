import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, StoryDreamProvider } from '../src/ui';
import { LemoCapabilityPanel } from '../src/features/settings/LemoCapabilityPanel';
import { LemoBudgetFields } from '../src/features/editorial-collage/LemoBudgetFields';
import { VoxProductionProgress } from '../src/features/editorial-collage/VoxProductionProgress';
import type { LemoCapabilityApi, LemoCapabilityProfile } from '../src/shared/lemo-provider-capabilities';
import type { VoxProductionControl } from '../src/shared/vox-production';
import { lemoUiPreflight, lemoUiProfile, lemoUiRun, lemoUiShots } from './lemo-production-ui.fixture';
import '../src/styles.css';

const fixture = {
  missing: true, hold: false, fail: false, calls: [] as Array<{ name: string; input?: unknown }>,
  cancel: undefined as (() => void) | undefined, finishTest: undefined as (() => void) | undefined,
  finishRepair: undefined as (() => void) | undefined, profile: null as LemoCapabilityProfile | null,
  snapshot: {} as Record<string, unknown>,
};
Object.assign(window, { __lemoUiHarness: fixture });
const api: LemoCapabilityApi = {
  async preflightLemoProvider(input) {
    fixture.calls.push({ name: 'preflight', input });
    return { ...lemoUiPreflight(input.maxOutputTokens), staticReady: !fixture.missing,
      blockers: fixture.missing ? ['请先保存专用 Messages 配置与密钥。'] : [], profile: fixture.profile };
  },
  async testLemoProvider(input) {
    fixture.calls.push({ name: 'test', input });
    if (fixture.hold) await new Promise<void>((resolve, reject) => {
      fixture.cancel = () => reject(new Error('LEMO_CAPABILITY_CANCELLED: 已在本机取消能力测试；远端计费由服务商决定。'));
      fixture.finishTest = resolve;
    });
    if (fixture.fail) throw new Error('LEMO_CAPABILITY_PROVIDER_REJECTED: 服务商不支持所需的输出额度参数。');
    return fixture.profile = lemoUiProfile(input.testId, input.outputBudget);
  },
  async cancelLemoProviderTest(input) { fixture.calls.push({ name: 'cancel', input }); fixture.cancel?.(); fixture.cancel = undefined; },
};
function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [profileId, setProfileId] = useState('profile-1');
  const [budget, setBudget] = useState(lemoUiRun().settings.lemoBudget!);
  const [run, setRun] = useState(lemoUiRun());
  const [progressOpen, setProgressOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.dataset.themeReady = 'true'; }, [theme]);
  fixture.snapshot = { budget, run, busy, profileId };
  async function control(action: VoxProductionControl['action'], extra?: Pick<VoxProductionControl, 'nodeId' | 'evidence' | 'shotId' | 'instructions'>) {
    fixture.calls.push({ name: 'control', input: { action, ...extra } });
    if (action === 'repair-shot') {
      setBusy(true);
      await new Promise<void>(resolve => { fixture.finishRepair = resolve; });
      setRun(current => ({ ...current, nodes: [...current.nodes, { id: 'official-repair:1', kind: 'film-edit', dependencies: ['official-authoring'], status: 'completed', paid: true, attempt: 1, shotId: extra?.shotId }], message: '离线界面验收：镜头修复回执已保存。' }));
      setBusy(false);
    } else if (action === 'reconcile') {
      setRun(current => ({ ...current, message: '离线界面验收：未找到完整回执，仍须核对原官方会话。' }));
    }
  }
  return <StoryDreamProvider theme={theme}><main style={{ height: '100vh', boxSizing: 'border-box', overflow: 'auto', padding: 24, background: 'var(--shell-bg)', color: 'var(--shell-text)' }}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>切换主题</Button>
      <Button onClick={() => { setRun(current => ({ ...current, settings: { ...current.settings, lemoBudget: budget } })); setProgressOpen(true); }}>查看制作进度</Button>
      <Button onClick={() => { const next = lemoUiRun(); next.status = 'paused'; next.nodes[3].status = 'unknown'; next.nodes[3].error = '请求结果待核对：保留原官方会话。'; for (const node of next.nodes.slice(4)) node.status = 'pending'; setRun(next); setProgressOpen(true); }}>载入不确定结果</Button>
      <Button onClick={() => setProfileId(profileId === 'profile-1' ? 'profile-2' : 'profile-1')}>切换已保存配置</Button>
    </div>
    <h1>Lemo · 能力与制作界面验收</h1><p>离线 UI fixture，真实组件与交互；不调用服务商、不产生费用。</p>
    <div style={{ maxWidth: 960, display: 'grid', gap: 24 }}>
      <LemoCapabilityPanel api={api} profileId={profileId} />
      <LemoBudgetFields value={budget} onChange={setBudget} />
    </div>
    <VoxProductionProgress open={progressOpen} run={run} shots={lemoUiShots} busy={busy} onClose={() => setProgressOpen(false)} onControl={control} />
  </main></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
