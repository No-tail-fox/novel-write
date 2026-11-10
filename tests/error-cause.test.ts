import { describe, expect, it } from 'vitest';
import { describeErrorCause, normalizeAppError } from '../src/shared/app-error';
import { summarizeErrorMessage } from '../src/components/ErrorDetails';
import { htmlVideoUserFacingError } from '../src/shared/html-video-workflow';

describe('underlying error causes stay visible (G-4 / U-2)', () => {
  it('describes the cause chain with system code, host and status, redacted', () => {
    const socket = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET', hostname: 'openspeech.bytedance.com' });
    const fetchError = new Error('fetch failed', { cause: socket });
    expect(describeErrorCause(fetchError)).toBe('fetch failed ← read ECONNRESET (openspeech.bytedance.com)');
    expect(describeErrorCause(Object.assign(new Error('bad gateway'), { status: 524 }))).toBe('bad gateway (HTTP 524)');
    expect(describeErrorCause(new Error('Authorization: Bearer sk-abcdefghijklmnop'))).not.toContain('sk-abcdefghijklmnop');
    expect(describeErrorCause(new Error('x'.repeat(1000)))!.length).toBeLessThanOrEqual(400);
  });
  it('does not change normalizeAppError semantics for coded errors', () => {
    expect(normalizeAppError(new Error('LEMO_X: detail'), { message: 'fallback' }).message).toBe('detail');
    expect(normalizeAppError(new Error('plain'), { message: 'fallback' }).message).toBe('fallback');
  });
  it('shows host and code in summaries and keeps step causes in HTML video messages', () => {
    expect(summarizeErrorMessage('HTML video voice step failed: fetch failed ← read ECONNRESET (openspeech.bytedance.com)')).toBe('与 openspeech.bytedance.com 连接中断（ECONNRESET）');
    expect(summarizeErrorMessage('socket hang up ECONNRESET')).toBe('网络连接中断');
    expect(summarizeErrorMessage('Image provider API error (524) at vllmproxy.example.com')).toContain('524');
    expect(summarizeErrorMessage('failed to load index.html ECONNRESET')).toBe('网络连接中断');
    expect(htmlVideoUserFacingError('HTML video voice step failed: read ECONNRESET (openspeech.bytedance.com)')).toBe('配音生成失败：read ECONNRESET (openspeech.bytedance.com)。请从配音生成重试。');
    expect(htmlVideoUserFacingError('HTML video voice step failed.')).toBe('配音生成失败。请从配音生成重试。');
  });
});
