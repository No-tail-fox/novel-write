import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactNode } from 'react';
import { serializeAppErrorForBridge } from '../src/shared/app-error';
const hooks = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], effects: [] as any[], cursor: 0, refCursor: 0 }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: any) => { const i = hooks.cursor++; if (!(i in hooks.values)) hooks.values[i] = typeof initial === 'function' ? initial() : initial; return [hooks.values[i], (value: any) => { hooks.values[i] = typeof value === 'function' ? value(hooks.values[i]) : value; }]; },
  useRef: (initial: any) => hooks.refs[hooks.refCursor++] ??= { current: initial }, useEffect: (effect: any) => hooks.effects.push(effect),
}));
vi.mock('../src/ui', () => ({ Button: 'Button', CheckboxField: 'CheckboxField', TextField: 'TextField' }));
import { LemoCapabilityPanel } from '../src/features/settings/LemoCapabilityPanel';
type Props = Parameters<typeof LemoCapabilityPanel>[0];
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); return isValidElement<{ children?: ReactNode }>(node) ? [node, ...nodes(node.props.children)] : []; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(''); return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''; }
function render(props: Props) { hooks.cursor = 0; hooks.refCursor = 0; hooks.effects = []; return nodes(LemoCapabilityPanel(props)); }
function button(tree: any[], label: string) { const node = tree.find(n => n.type === 'Button' && text(n.props.children) === label); expect(node, label).toBeTruthy(); return node; }
function deferred<T = any>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const settle = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const preflight = { fingerprint: 'a'.repeat(64), endpoint: 'https://fixture.invalid/v1/messages', model: 'test-model', staticReady: true, blockers: [], profile: null, testPlan: { maxRequests: 6, maxOutputTokensTotal: 16832, outputBudget: 16384 } };
function fixture() { const api = { preflightLemoProvider: vi.fn(async () => preflight), testLemoProvider: vi.fn(), cancelLemoProviderTest: vi.fn(async () => {}) }; return { api, props: { api: api as any, profileId: 'saved-profile' } satisfies Props }; }
async function approve(props: Props) { await button(render(props), '免费检查已保存配置').props.onClick(); render(props).find(n => n.type === 'CheckboxField').props.onChange({}, { checked: true }); }
beforeEach(() => { hooks.values = []; hooks.refs = []; hooks.effects = []; hooks.cursor = 0; hooks.refCursor = 0; });
describe('Lemo saved-provider capability panel', () => {
  it('preflightLemoProvider uses the saved selected profile and visible token limit without making a paid request', async () => {
    const { api, props } = fixture(); await button(render(props), '免费检查已保存配置').props.onClick(); expect(api.preflightLemoProvider).toHaveBeenCalledExactlyOnceWith({ profileId: 'saved-profile', maxOutputTokens: 16384 });
    expect(api.testLemoProvider).not.toHaveBeenCalled(); expect(button(render(props), '验证 Lemo 渠道能力').props.disabled).toBe(true);
    expect(render(props).some(n => n.type === 'p' && text(n.props.children).includes('最多 6 次模型请求'))).toBe(true);
  });
  it('testLemoProvider requires acknowledgment, submits the exact approved budget and locks double clicks synchronously', async () => {
    const { api, props } = fixture(); await approve(props); const pending = deferred(); api.testLemoProvider.mockReturnValue(pending.promise);
    const click = button(render(props), '验证 Lemo 渠道能力').props.onClick; const run = click(); click(); expect(api.testLemoProvider).toHaveBeenCalledTimes(1);
    expect(api.testLemoProvider.mock.calls[0][0]).toMatchObject({ profileId: 'saved-profile', expectedFingerprint: preflight.fingerprint, acknowledgePotentialCharges: true, ...preflight.testPlan });
    expect(button(render(props), '验证 Lemo 渠道能力').props.disabled).toBe(true); pending.reject(new Error('LEMO_CAPABILITY_TEST: 测试中断')); await run; expect(render(props).some(n => n.props.role === 'alert')).toBe(true);
  });
  it('cancelLemoProviderTest is wired to visible cancellation and cleanup without accepting late completion', async () => {
    const { api, props } = fixture(); render(props); const cleanup = hooks.effects[0](); await approve(props); const pending = deferred(); api.testLemoProvider.mockReturnValue(pending.promise);
    const run = button(render(props), '验证 Lemo 渠道能力').props.onClick(); const id = api.testLemoProvider.mock.calls[0][0].testId;
    await button(render(props), '取消能力测试').props.onClick(); expect(api.cancelLemoProviderTest).toHaveBeenCalledWith({ testId: id }); cleanup();
    expect(api.cancelLemoProviderTest).toHaveBeenCalledTimes(2); const before = hooks.values.slice(); pending.resolve({ checks: {} }); await run; expect(hooks.values).toEqual(before);
  });
  it('discards a preflight response after switching the selected saved profile', async () => {
    const { api, props } = fixture(); const pending = deferred(); api.preflightLemoProvider.mockReturnValue(pending.promise);
    const run = button(render(props), '免费检查已保存配置').props.onClick(); render({ ...props, profileId: 'new-profile' }); hooks.effects[1](); pending.resolve(preflight); await run;
    expect(render({ ...props, profileId: 'new-profile' }).some(n => n.type === 'CheckboxField')).toBe(false);
  });
  it('shows cancellation errors rather than leaving an unhandled promise', async () => {
    const { api, props } = fixture(); await approve(props); const pending = deferred(); api.testLemoProvider.mockReturnValue(pending.promise); api.cancelLemoProviderTest.mockRejectedValue(new Error('取消失败'));
    const run = button(render(props), '验证 Lemo 渠道能力').props.onClick(); await button(render(props), '取消能力测试').props.onClick(); expect(render(props).some(n => n.props.role === 'alert')).toBe(true);
    pending.reject(new Error('测试已停止')); await run; await settle();
  });
  it('retains the full safe provider error and decodes the IPC envelope', async () => {
    const { api, props } = fixture(); await approve(props);
    api.testLemoProvider.mockRejectedValue(new Error(serializeAppErrorForBridge(new Error('LEMO_CAPABILITY_PROVIDER_REJECTED: 服务商不支持所需的输出额度参数，请检查已保存模型配置。'))));
    await button(render(props), '验证 Lemo 渠道能力').props.onClick();
    const alert = render(props).find(n => n.props.role === 'alert');
    expect(text(alert.props.children)).toContain('服务商不支持所需的输出额度参数，请检查已保存模型配置。');
    expect(text(alert.props.children)).not.toContain('__STORYDREAM');
  });
  it('does not apply a stale failure to a newly selected profile', async () => {
    const { api, props } = fixture(); const pending = deferred(); api.preflightLemoProvider.mockReturnValue(pending.promise);
    const run = button(render(props), '免费检查已保存配置').props.onClick(); render({ ...props, profileId: 'new-profile' }); hooks.effects[1]();
    pending.reject(new Error('LEMO_CAPABILITY_REJECTED: 旧配置失败')); await run;
    expect(render({ ...props, profileId: 'new-profile' }).some(n => n.props.role === 'alert')).toBe(false);
  });
});
