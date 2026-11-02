import { useEffect, useRef, useState } from 'react';
import { Button, CheckboxField, TextField } from '../../ui';
import { decideLemoProviderCapability, type LemoCapabilityApi, type LemoCapabilityPreflight, type LemoCapabilityProfile } from '../../shared/lemo-provider-capabilities';
import { formatAppErrorMessage, normalizeAppError } from '../../shared/app-error';
import '../../styles/features/vox-process-workspace.css';

const labels = { 'tool-roundtrip': '工具调用与结果返回', 'image-input': '图像理解', sse: '完整流式响应', 'client-cancel': '本机取消', 'output-budget': '输出额度参数' };
const statuses = { 'not-tested': '未测试', pass: '通过', fail: '失败', unknown: '结果待核对' };
const blockerLabels: Record<string, string> = {
  LEMO_CAPABILITY_MESSAGES_REQUIRED: '当前配置不使用 Messages 协议，请选择支持 Messages 的已保存配置。',
  LEMO_CAPABILITY_CREDENTIAL_REQUIRED: '当前已保存配置缺少密钥，请补充并保存后再检查。',
  LEMO_CAPABILITY_PROFILE_DISABLED: '当前模型配置未启用，请启用并保存后再检查。',
};
export function LemoCapabilityPanel({ api, profileId, disabled = false }: { api: LemoCapabilityApi; profileId: string; disabled?: boolean }) {
  const [tokens, setTokens] = useState(16384);
  const [preflight, setPreflight] = useState<LemoCapabilityPreflight | null>(null);
  const [profile, setProfile] = useState<LemoCapabilityProfile | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'preflight' | 'test' | null>(null);
  const [error, setError] = useState('');
  const active = useRef<string | null>(null);
  const alive = useRef(true);
  const currentSelection = useRef({ profileId, tokens }); currentSelection.current = { profileId, tokens };
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (active.current) void api.cancelLemoProviderTest({ testId: active.current }).catch(() => undefined); }; }, [api]);
  useEffect(() => { setPreflight(null); setProfile(null); setAcknowledged(false); setError(''); }, [profileId, tokens]);
  async function refreshCapabilities() {
    setBusy('preflight'); setError('');
    try { const result = await api.preflightLemoProvider({ profileId, maxOutputTokens: tokens }); if (alive.current && currentSelection.current.profileId === profileId && currentSelection.current.tokens === tokens) { setPreflight(result); setProfile(result.profile); } }
    catch (e) { if (alive.current && currentSelection.current.profileId === profileId && currentSelection.current.tokens === tokens) setError(formatAppErrorMessage(normalizeAppError(e))); }
    finally { if (alive.current) setBusy(null); }
  }
  async function testCapabilities() {
    if (!preflight || !acknowledged || busy || active.current) return;
    const testId = crypto.randomUUID(); active.current = testId; setBusy('test'); setError('');
    try {
      const result = await api.testLemoProvider({ profileId, testId, expectedFingerprint: preflight.fingerprint,
        acknowledgePotentialCharges: true, ...preflight.testPlan });
      if (alive.current && currentSelection.current.profileId === profileId && currentSelection.current.tokens === tokens) setProfile(result);
    } catch (e) { if (alive.current && currentSelection.current.profileId === profileId && currentSelection.current.tokens === tokens) setError(formatAppErrorMessage(normalizeAppError(e))); }
    finally { active.current = null; if (alive.current) setBusy(null); }
  }
  async function cancelCapabilities() {
    try { if (active.current) await api.cancelLemoProviderTest({ testId: active.current }); }
    catch (e) { if (alive.current && currentSelection.current.profileId === profileId && currentSelection.current.tokens === tokens) setError(formatAppErrorMessage(normalizeAppError(e))); }
  }
  const validTokens = Number.isSafeInteger(tokens) && tokens >= 256 && tokens <= 1000000;
  const ready = preflight && decideLemoProviderCapability({ fingerprint: preflight.fingerprint, protocol: 'anthropic', maxOutputTokens: tokens, profile }).ready;
  return <section className="vox-production-fields" aria-label="Lemo 模型能力验证">
    <h3>Lemo 模型能力验证</h3>
    <p className="vox-hint">使用当前选中的已保存配置。修改模型或密钥后请先保存，再检查；只有能力验证通过的 Messages 通道可以开始创意动画。</p>
    <TextField label="需要验证的最大输出 Token" type="number" min={256} max={1000000} disabled={disabled || Boolean(busy)}
      value={Number.isFinite(tokens) ? String(tokens) : ''} onChange={(_, event) => setTokens(event.value.trim() ? Number(event.value) : NaN)} />
    <Button disabled={disabled || Boolean(busy) || !validTokens} onClick={refreshCapabilities}>免费检查已保存配置</Button>
    {preflight ? <>
      <p>{preflight.model} · {preflight.endpoint}</p>
      <p role="status">{ready ? '能力验证通过，可用于当前输出额度的创意动画。' : '尚未满足生产要求，请完成或重新验证。'}</p>
      {preflight.blockers.length ? <p role="alert">{preflight.blockers.map(code => blockerLabels[code] ?? code).join('；')}</p> : null}
      <p className="vox-hint">主动测试最多 {preflight.testPlan.maxRequests} 次模型请求，输出额度总上限 {preflight.testPlan.maxOutputTokensTotal} Token。检查工具、图片、流式响应、取消和额度参数；参数被接受不代表完整长输出已验收。取消后远端是否计费由服务商决定。</p>
      <CheckboxField label="我确认执行上述有额度限制的真实模型测试，可能产生服务商费用" checked={acknowledged} disabled={disabled || Boolean(busy)} onChange={(_, event) => setAcknowledged(event.checked === true)} />
      <div className="vox-production-fields"><Button variant="primary" disabled={disabled || Boolean(busy) || !acknowledged || !preflight.staticReady} onClick={testCapabilities}>验证 Lemo 渠道能力</Button>
        {busy === 'test' ? <Button disabled={!active.current} onClick={cancelCapabilities}>取消能力测试</Button> : null}</div>
    </> : null}
    {busy ? <p role="status">{busy === 'test' ? '正在验证真实模型能力，结果逐项保存。' : '正在读取已保存配置和能力记录。'}</p> : null}
    {profile ? <ul>{Object.entries(profile.checks).map(([key, check]) => <li key={key}>{labels[key as keyof typeof labels]}：{statuses[check.status]}</li>)}</ul> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
