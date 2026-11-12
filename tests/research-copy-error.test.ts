import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrustedIpcRegistrar } from '../electron/ipc';
import { AppError, appErrorFromPayload, formatAppErrorMessage, serializeAppErrorForBridge, type AppErrorPayload } from '../src/shared/app-error';
import { defaultConfig } from '../src/shared/config';
import { createConfiguredTextLlm } from '../src/shared/llm-provider';
import { composeCopyFromSources, normalizeResearchCopyError } from '../src/shared/research';
import { normalizeDirectorCopyAssistError } from '../src/features/director-desk/director-copy-assist';

const input = { keyword: '旧书店', selectedSources: [], useBuiltinKnowledge: true, extraRequirements: '' };
const diagnosticId = 'copy-test-diagnostic';
const providerBody = 'PRIVATE_PROVIDER_BODY api_key=secret-key Authorization: Bearer secret-token https://user:password@private.example/?token=private-token';
const withDiagnostic = (error: Error) => Object.assign(error, { diagnosticId });
const httpError = (status: number) => withDiagnostic(new Error(`LLM API error (${status}) at step 0 research-copy via https://private.example/: ${providerBody}`));

// Exercise the real IPC envelope and preload serialization, without starting Electron or making requests.
async function throughBridge(error: unknown): Promise<AppError> {
  let invoke: ((event: unknown, raw?: unknown) => Promise<unknown>) | undefined;
  const mainFrame = { url: 'file:///app/dist-renderer/index.html' };
  const webContents = { mainFrame, getURL: () => mainFrame.url };
  const register = createTrustedIpcRegistrar({
    register: (_channel, handler) => { invoke = handler; },
    getWindow: () => ({ isDestroyed: () => false, webContents }),
    getPolicy: () => ({ mode: 'production', entryUrl: mainFrame.url }),
  });
  register('research:compose-copy', async () => { throw normalizeResearchCopyError(error); });
  const result = await invoke!({ sender: webContents, senderFrame: mainFrame }, input) as { ok: false; error: AppErrorPayload };
  expect(result.ok).toBe(false);
  return normalizeDirectorCopyAssistError(new Error(serializeAppErrorForBridge(appErrorFromPayload(result.error))));
}

afterEach(() => vi.unstubAllGlobals());

describe('research-copy safe error boundary', () => {
  it.each([
    [withDiagnostic(new Error('LLM API key is missing; cannot run real task content generation.')), 'RESEARCH_COPY_API_KEY_MISSING', '系统设置', false],
    [httpError(401), 'RESEARCH_COPY_AUTH_FAILED', 'API Key', false],
    [httpError(403), 'RESEARCH_COPY_ACCESS_DENIED', '模型权限', false],
    [httpError(429), 'RESEARCH_COPY_RATE_LIMITED', '额度', true],
    [httpError(402), 'RESEARCH_COPY_QUOTA_EXHAUSTED', '计费状态', false],
    [httpError(404), 'RESEARCH_COPY_ENDPOINT_NOT_FOUND', 'API 协议', false],
    [httpError(400), 'RESEARCH_COPY_REQUEST_REJECTED', '自定义请求参数', false],
    [withDiagnostic(new Error(`LLM API error (404) at step 0 research-copy: model_not_found ${providerBody}`)), 'RESEARCH_COPY_MODEL_UNAVAILABLE', '模型名称', false],
    [withDiagnostic(new Error(`LLM API error (503) at step 0 research-copy: no available channel ${providerBody}`)), 'RESEARCH_COPY_MODEL_UNAVAILABLE', '可用通道', false],
    [withDiagnostic(new Error(`LLM API error (400) at step 0 research-copy: insufficient_quota ${providerBody}`)), 'RESEARCH_COPY_QUOTA_EXHAUSTED', '配额', false],
    ...[500, 502, 503, 504, 529].map(status => [httpError(status), 'RESEARCH_COPY_SERVICE_UNAVAILABLE', `HTTP ${status}`, true]),
    [withDiagnostic(new Error('fetch failed', { cause: Object.assign(new Error('connection timeout'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) })), 'RESEARCH_COPY_TIMEOUT', '代理', true],
    [withDiagnostic(new Error('NETWORK_TIMEOUT: Network request timed out after 120000ms.')), 'RESEARCH_COPY_TIMEOUT', '结果可能未知', true],
    [withDiagnostic(new Error('fetch failed', { cause: Object.assign(new Error('read failed'), { code: 'ECONNRESET' }) })), 'RESEARCH_COPY_NETWORK_FAILED', '网络', true],
    [withDiagnostic(new Error('fetch failed', { cause: Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }) })), 'RESEARCH_COPY_NETWORK_FAILED', '接口地址', true],
    [withDiagnostic(new Error('LLM step 0 research-copy returned empty content.')), 'RESEARCH_COPY_EMPTY_RESPONSE', '文本输出', true],
    [withDiagnostic(new Error('LLM 流式回复没有返回文本。')), 'RESEARCH_COPY_EMPTY_RESPONSE', '切换模型', true],
    [withDiagnostic(new Error(providerBody)), 'RESEARCH_COPY_FAILED', '测试当前 LLM', false],
    [withDiagnostic(new Error(`PROVIDER_FAILED: ${providerBody}`)), 'RESEARCH_COPY_FAILED', '诊断号', false],
  ])('keeps safe actionable classification through IPC: %s', async (original, code, hint, retryable) => {
    const error = await throughBridge(original);
    expect(error).toMatchObject({ code, retryable, diagnosticId });
    expect(error.message).toContain(hint as string);
    const shown = formatAppErrorMessage(error);
    expect(shown).toContain(`诊断号：${diagnosticId}`);
    for (const secret of ['PRIVATE_PROVIDER_BODY', 'secret-key', 'secret-token', 'private.example', 'private-token', 'user:password']) {
      expect(shown).not.toContain(secret);
    }
  });

  it.each([
    ['LLM_PROFILE_MISSING', '重新选择'],
    ['PROJECT_LLM_PROFILE_MISSING', '项目模型设置'],
    ['PROJECT_IMAGE_PROFILE_MISSING', '项目模型设置'],
    ['PROJECT_VIDEO_PROFILE_MISSING', '项目模型设置'],
    ['CREDENTIAL_ENCRYPTION_UNAVAILABLE', '原操作系统账户'],
    ['CREDENTIAL_VAULT_READ_FAILED', '访问权限'],
    ['CREDENTIAL_VAULT_CORRUPT', '重新填写密钥'],
    ['CREDENTIAL_VAULT_INVALID_SECRETS', '格式无效'],
    ['CREDENTIAL_VAULT_ENCRYPT_FAILED', '加密'],
    ['CREDENTIAL_VAULT_WRITE_FAILED', '可用空间'],
  ])('preserves allowlisted internal code %s without trusting its message', async (code, hint) => {
    const error = await throughBridge(withDiagnostic(new Error(`${code}: ${providerBody}`)));
    expect(error).toMatchObject({ code, retryable: false, diagnosticId });
    expect(error.message).toContain(hint);
    expect(error.message).not.toContain('PRIVATE_PROVIDER_BODY');
    expect(error.message).not.toContain('secret-key');
    expect(error.message).not.toContain('private.example');
  });

  it('recognizes the bare internal credential code but not prefix lookalikes', () => {
    expect(normalizeResearchCopyError(new Error('CREDENTIAL_VAULT_INVALID_SECRETS')).code).toBe('CREDENTIAL_VAULT_INVALID_SECRETS');
    for (const code of ['CREDENTIAL_VAULT_PROVIDER_ERROR', 'LLM_PROFILE_MISSING_EVIL', 'PROJECT_LLM_PROVIDER_FAILED']) {
      const result = normalizeResearchCopyError(new Error(`${code}: ${providerBody}`));
      expect(result.code).toBe('RESEARCH_COPY_FAILED');
      expect(result.message).not.toContain('PRIVATE_PROVIDER_BODY');
    }
  });

  it('uses structured nested HTTP status when the message is uninformative', () => {
    const error = new Error('request failed', { cause: Object.assign(new Error('rejected'), { status: 403 }) });
    expect(normalizeResearchCopyError(error).code).toBe('RESEARCH_COPY_ACCESS_DENIED');
  });

  it('preserves existing AppError metadata rather than reclassifying its text', async () => {
    const original = new AppError('LICENSE_NOT_READY', '授权尚未准备好。', false, diagnosticId, 'license');
    expect(await throughBridge(original)).toMatchObject({
      code: original.code, message: original.message, retryable: false, diagnosticId, field: 'license',
    });
  });

  it.each([
    Object.assign(new Error('private cancellation text'), { name: 'AbortError' }),
    Object.assign(new Error('private cancellation text'), { code: 'ABORT_ERR' }),
    Object.assign(new Error('private cancellation text'), { code: 'ERR_CANCELED' }),
    new AppError('ACTION_CANCELLED', '操作已取消。', false, diagnosticId),
    new Error('fetch failed', { cause: Object.assign(new Error('private cancellation text'), { name: 'AbortError' }) }),
  ])('preserves cancellation and diagnostic id: %s', async original => {
    expect(await throughBridge(withDiagnostic(original))).toMatchObject({
      code: 'ACTION_CANCELLED', message: '操作已取消。', retryable: false, diagnosticId,
    });
  });

  it.each([undefined, null, 'arbitrary private provider text', { message: providerBody }])('handles non-Error rejections safely: %s', original => {
    const error = normalizeResearchCopyError(original);
    expect(error.code).toBe('RESEARCH_COPY_FAILED');
    expect(error.diagnosticId).toBeTruthy();
    expect(error.message).not.toContain('private');
    expect(error.message).not.toContain('PRIVATE_PROVIDER_BODY');
  });

  it('handles cyclic causes and long provider bodies without echoing them', () => {
    const original = httpError(401);
    original.cause = original;
    original.message += providerBody.repeat(1000);
    const result = normalizeResearchCopyError(original);
    expect(result.code).toBe('RESEARCH_COPY_AUTH_FAILED');
    expect(result.message.length).toBeLessThan(200);
    expect(result.message).not.toContain('PRIVATE_PROVIDER_BODY');
  });

  it('reports an actual configured-provider missing key before any network request', async () => {
    const fetch = vi.fn(() => { throw new Error('Network access prohibited in this test'); });
    vi.stubGlobal('fetch', fetch);
    const llm = createConfiguredTextLlm({ ...defaultConfig.llm, apiKey: '', fallbackModels: [] });
    const error = await composeCopyFromSources(llm, input).catch(normalizeResearchCopyError);
    expect(error).toMatchObject({ code: 'RESEARCH_COPY_API_KEY_MISSING' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a cleaned empty response without exposing raw model output', async () => {
    const error = await composeCopyFromSources({ protocol: 'openai', run: async () => ({
      text: '   ', raw: providerBody, requestId: null,
    }) }, input).catch(normalizeResearchCopyError);
    expect(error).toMatchObject({ code: 'RESEARCH_COPY_EMPTY_RESPONSE', retryable: true });
    expect(JSON.stringify(error)).not.toContain('PRIVATE_PROVIDER_BODY');
  });

  it('leaves successful copy generation unchanged', async () => {
    expect(await composeCopyFromSources({ protocol: 'openai', run: async () => ({
      text: '街角书店的故事。', raw: '街角书店的故事。', requestId: 'copy-request',
    }) }, input)).toEqual({ title: '旧书店', copy: '街角书店的故事。', raw: '街角书店的故事。', requestId: 'copy-request' });
  });

  it('catches the entire config/provider/compose boundary while preserving reservation release', async () => {
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const start = main.indexOf("trustedHandle('research:compose-copy'");
    const handler = main.slice(start, main.indexOf('\n});', start));
    expect(handler).toMatch(/try\s*\{[\s\S]*getProjectRuntimeConfig[\s\S]*composeCopyFromSources\(createConfiguredTextLlm[\s\S]*catch \(error\)\s*\{\s*throw normalizeResearchCopyError\(error\);/u);
    expect(handler).toContain('finally { release(); }');
  });
});
