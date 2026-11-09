import { describe, expect, it } from 'vitest';
import { summarizeErrorMessage } from '../src/components/ErrorDetails';
import { formatOpenAiImageProviderError } from '@shared/openai-image';
import { isDefinitiveImageProviderFailure } from '@shared/image-provider-error';

describe('image provider error presentation', () => {
  it.each([
    ['连接 api.example 超时（UND_ERR_CONNECT_TIMEOUT）', '服务连接超时'],
    ['连接中断（UND_ERR_SOCKET）', '网络连接中断'],
    ['无法解析 api.example（EAI_AGAIN）', '服务域名解析失败'],
  ])('identifies transport failures separately from generation deadlines', (message, expected) => {
    expect(summarizeErrorMessage(message)).toBe(expected);
    expect(isDefinitiveImageProviderFailure(message)).toBe(false);
  });

  it.each([
    ['Image provider request timed out after 180000ms.', '生图等待超时（180 秒）'],
    ['Image provider edit request timed out after 600000ms.', '生图等待超时（600 秒）'],
  ])('explains the actual image deadline in stored errors: %s', (message, expected) => {
    expect(summarizeErrorMessage(message)).toBe(expected);
    expect(isDefinitiveImageProviderFailure(message)).toBe(false);
  });

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

  it.each([
    'I can create the bedroom background in the requested wax-crayon children’s picture-book style, but the image generation did not complete successfully. Please send the request again.',
    '当前无法在这个对话中直接生成图片，但我可以帮你整理成可直接用于图像生成工具的最终提示词。',
  ])('explains a text-only upstream rejection and also recognizes old stored errors', detail => {
    const legacy = `Image provider API error (400): ${detail}`;
    const message = formatOpenAiImageProviderError({ status: 400, bodyText: JSON.stringify({ error: { message: detail } }), model: 'gpt-image-2.5-sunburst', operation: 'generation' });
    expect(message).toContain('图片服务未生成图片，仅返回文字说明');
    expect(message).toContain(detail);
    expect(summarizeErrorMessage(message)).toBe('图片服务未返回图片');
    expect(summarizeErrorMessage(legacy)).toBe('图片服务未返回图片');
    expect(isDefinitiveImageProviderFailure(legacy)).toBe(true);
  });

  it('explains a disabled image group without treating every 403 as the same permission issue', () => {
    const detail = 'Image generation is not enabled for this group';
    const message = formatOpenAiImageProviderError({ status: 403, bodyText: JSON.stringify({ error: { message: detail } }), model: 'gpt-image-2', operation: 'generation' });
    expect(message).toContain('当前 API Key 所属分组未开通生图');
    expect(summarizeErrorMessage(message)).toBe('图片服务分组未开通生图');
    expect(summarizeErrorMessage(`Image provider API error (403): ${detail}`)).toBe('图片服务分组未开通生图');
    expect(summarizeErrorMessage('Image provider API error (403): Content policy rejected')).toBe('生图接口错误 403');
  });

  it('explains an unavailable model route as an explicit rejection', () => {
    const message = formatOpenAiImageProviderError({ status: 503, bodyText: JSON.stringify({ error: { message: 'No available channel for model gpt-image-2-Official under group distributor' } }), model: 'gpt-image-2-Official', operation: 'generation' });
    expect(message).toContain('上游账号或通道');
    expect(summarizeErrorMessage(message)).toBe('图片服务暂无可用账号');
  });

  it('keeps invalid request details distinct from text-only responses', () => {
    const message = formatOpenAiImageProviderError({ status: 400, bodyText: '{"error":{"message":"Invalid size: 1536x1024"}}', model: 'image', operation: 'generation' });
    expect(message).toBe('Image provider API error (400): Invalid size: 1536x1024');
    expect(summarizeErrorMessage(message)).toBe('生图接口错误 400');
  });

  it.each([
    ['Image provider API error (400): generation did not complete', true],
    ['Image provider edit API error (422): invalid input', true],
    ['Image provider async submit error (429): rate limited', true],
    ['Image provider async task failed: upstream task failed', true],
    ['Image provider async poll error (400): task not found', false],
    ['Image provider API error (408): timed out', false],
    ['Image provider API error (502): lost upstream response', false],
    ['Image provider API error (503): unavailable', false],
    ['Image provider API error (503): No available compatible accounts', true],
    ['Image provider edit API error (503): No available compatible accounts', true],
    ['Image provider async submit error (503): No available compatible accounts', true],
    ['Image provider async poll error (503): No available compatible accounts', false],
    ['Image provider API error (503): No available channel for model gpt-image-2-Official under group distributor', true],
    ['Image provider async submit error (503): No available channel for model image under group x', true],
    ['Image provider async poll error (503): No available channel for model image under group x', false],
    ['Image provider API error (502): No available channel for model image under group x', false],
    ['download failed: Image provider API error (400): invalid url', false],
    ['network closed after submit', false],
  ])('classifies submission failure without treating polling or lost responses as rejection: %s', (message, expected) => {
    expect(isDefinitiveImageProviderFailure(message)).toBe(expected);
  });
});
