import { describe, expect, it } from 'vitest';
import { summarizeErrorMessage } from '../src/components/ErrorDetails';
import { formatOpenAiImageProviderError } from '@shared/openai-image';

describe('image provider error presentation', () => {
  it('identifies a remote 402 billing failure without blaming local request validation', () => {
    const message = formatOpenAiImageProviderError({
      status: 402,
      bodyText: JSON.stringify({ error: { message: '金币余额不足，请购买套餐充值金币: https://geekai.co/credit/plans' } }),
      model: 'gpt-image-2',
      operation: 'generation',
    });

    expect(message).toContain('远程图片服务账户余额不足');
    expect(message).toContain('不是本地参数校验错误');
    expect(message).toContain('降低生成质量只能减少后续消耗');
    expect(message).toContain('https://geekai.co/credit/plans');
    expect(summarizeErrorMessage(message)).toBe('图片服务余额不足');
  });
});
