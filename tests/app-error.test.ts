import { describe, expect, it } from 'vitest';

async function loadAppError() {
  return import('../src/shared/app-error').catch(() => null);
}

describe('application errors', () => {
  it('redacts credentials, headers, query secrets, and JSON secret fields', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const unsafe = [
      'Authorization: Bearer sk-live-authorization-secret',
      'Cookie: session=cookie-session-secret; refresh=cookie-refresh-secret',
      'https://api.example.test/v1?token=query-token-secret&api_key=query-api-secret&safe=value',
      '{"apiKey":"json-api-secret","secretAccessKey":"json-access-secret","password":"json-password-secret"}',
    ].join('\n');
    const redacted = appError.redactErrorText(unsafe);

    for (const secret of [
      'sk-live-authorization-secret',
      'cookie-session-secret',
      'cookie-refresh-secret',
      'query-token-secret',
      'query-api-secret',
      'json-api-secret',
      'json-access-secret',
      'json-password-secret',
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('safe=value');
  });

  it('never exposes credentials held by nested error causes', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const deepest = new Error('Cookie: auth=nested-cookie-secret');
    const cause = new Error('request failed for https://example.test/?access_token=nested-query-secret', { cause: deepest });
    const error = new Error('PROVIDER_REQUEST_FAILED: 上游服务请求失败。', { cause });
    const payload = appError.toAppErrorPayload(error);
    const serialized = JSON.stringify(payload);

    expect(serialized).not.toContain('nested-cookie-secret');
    expect(serialized).not.toContain('nested-query-secret');
    expect(payload.code).toBe('PROVIDER_REQUEST_FAILED');
    expect(payload.message).toBe('上游服务请求失败。');
    expect(payload.diagnosticId).toMatch(/^[a-zA-Z0-9-]{8,}$/);
  });

  it('preserves explicit safe metadata through payload round trips', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const source = new appError.AppError('CONFIG_INVALID', '请检查接口地址。', false, 'diag-fixed-1234', 'baseUrl');
    const payload = appError.toAppErrorPayload(source);
    const restored = appError.appErrorFromPayload(payload);

    expect(payload).toEqual({
      code: 'CONFIG_INVALID',
      message: '请检查接口地址。',
      retryable: false,
      diagnosticId: 'diag-fixed-1234',
      field: 'baseUrl',
    });
    expect(restored).toBeInstanceOf(appError.AppError);
    expect(restored).toMatchObject(payload);
  });

  it('classifies cancellation without showing it as a failure', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const abort = new DOMException('The operation was aborted.', 'AbortError');
    const coded = Object.assign(new Error('cancelled'), { code: 'ERR_CANCELED' });

    expect(appError.isCancellation(abort)).toBe(true);
    expect(appError.isCancellation(coded)).toBe(true);
    expect(appError.isCancellation(new Error('ordinary failure'))).toBe(false);
    expect(appError.normalizeAppError(abort).code).toBe('ACTION_CANCELLED');
  });

  it('maps unknown values to a safe generic error with a diagnostic id', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const normalized = appError.normalizeAppError({
      message: 'Authorization: Bearer unknown-object-secret',
      apiKey: 'unknown-field-secret',
    });

    expect(normalized.code).toBe('UNEXPECTED_ERROR');
    expect(normalized.message).toBe('操作失败，请重试。');
    expect(normalized.diagnosticId).toMatch(/^[a-zA-Z0-9-]{8,}$/);
    expect(JSON.stringify(normalized)).not.toContain('unknown-object-secret');
    expect(JSON.stringify(normalized)).not.toContain('unknown-field-secret');
  });

  it('rejects unsafe diagnostic ids instead of reflecting them to the UI', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const restored = appError.appErrorFromPayload({
      code: 'IPC_HANDLER_FAILED',
      message: '请求失败。',
      retryable: true,
      diagnosticId: 'Authorization: Bearer diagnostic-secret',
    });

    expect(restored.diagnosticId).toMatch(/^[a-zA-Z0-9-]{8,}$/);
    expect(restored.diagnosticId).not.toContain('diagnostic-secret');
    expect(appError.formatAppErrorMessage(restored)).not.toContain('diagnostic-secret');
  });

  it('does not make a known validation error retryable through fallback defaults', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const normalized = appError.normalizeAppError(
      new Error('CONFIG_INVALID: 请检查接口地址。'),
      { code: 'IPC_HANDLER_FAILED', message: '请求失败。', retryable: true },
    );

    expect(normalized.code).toBe('CONFIG_INVALID');
    expect(normalized.retryable).toBe(false);
  });

  it('restores safe metadata after Electron contextBridge reduces errors to messages', async () => {
    const appError = await loadAppError();
    expect(appError).not.toBeNull();
    if (!appError) return;

    const source = new appError.AppError('ACCOUNT_SAVE_FAILED', '保存失败。', true, 'diag-bridge-1234');
    const transport = appError.serializeAppErrorForBridge(source);
    const bridged = new Error(`Error invoking remote method 'account:save': Error: ${transport}`);
    const restored = appError.normalizeAppError(bridged);

    expect(restored).toMatchObject({
      code: 'ACCOUNT_SAVE_FAILED',
      message: '保存失败。',
      retryable: true,
      diagnosticId: 'diag-bridge-1234',
    });
  });
});
