export type OpenAiImageProviderOperation = 'generation' | 'edit' | 'async-submit' | 'async-poll' | 'model-test';

export function isImageProviderTextOnlyResponse(message: string): boolean {
  return /image generation did not complete|(?:cannot|can't|unable to) (?:directly )?(?:generate|create) (?:an? )?image|(?:无法|不能).{0,30}(?:生成图片|生成图像)|仅返回文字说明/iu.test(message);
}

function isUnavailableImageRoute(message: string): boolean {
  return /no available compatible accounts|no available channel for model\s/iu.test(message);
}

/** Submission rejections are distinct from a lost response or a failed poll of an accepted task. */
/** G-8: gateway idle cut-offs (Cloudflare 524, 504) leave the upstream generation outcome unknown. */
export const IMAGE_RESULT_UNKNOWN_PREFIX = 'IMAGE_RESULT_UNKNOWN:';
export function isImageGatewayIdleTimeout(status: number): boolean {
  return status === 524 || status === 504;
}

export function isImageResultUnknown(message: string): boolean {
  return message.includes(IMAGE_RESULT_UNKNOWN_PREFIX) || /^Image provider (?:request|edit request|async submit) timed out after \d+ms/iu.test(message);
}

export function isDefinitiveImageProviderFailure(message: string): boolean {
  const status = message.match(/^Image provider (?:API error|edit API error|async submit error) \((\d{3})\):/iu)?.[1];
  // A relay that has no compatible account or model route rejects before starting generation. Generic
  // 5xx errors and failed polls remain ambiguous because a task may already exist.
  return Boolean(status && ([400, 401, 402, 403, 404, 405, 413, 415, 422, 429].includes(Number(status))
    || Number(status) === 503 && isUnavailableImageRoute(message)))
    || message.startsWith('Image provider async task failed:');
}

export function formatOpenAiImageProviderError(input: {
  status: number;
  bodyText: string;
  model: string;
  operation: OpenAiImageProviderOperation;
}): string {
  const prefix = input.operation === 'edit'
    ? 'Image provider edit API error'
    : input.operation === 'async-submit'
      ? 'Image provider async submit error'
      : input.operation === 'async-poll'
        ? 'Image provider async poll error'
        : input.operation === 'model-test'
          ? 'Image model test error'
          : 'Image provider API error';
  const detail = extractImageProviderErrorDetail(input.bodyText);
  if (input.status === 400 && isImageProviderTextOnlyResponse(detail)) {
    return `${prefix} (${input.status}): 图片服务未生成图片，仅返回文字说明。可重试失败步骤；若反复发生，请切换图片服务或模型。上游信息: ${detail}`;
  }
  if (input.status === 403 && /image generation is not enabled for this group/iu.test(detail)) {
    return `${prefix} (${input.status}): 当前 API Key 所属分组未开通生图。请在供应商处开通图片权限，或切换已开通生图的配置；重试同一配置不能解决权限问题。上游信息: ${detail}`;
  }
  if (input.status === 402) {
    return `${prefix} (${input.status}): 远程图片服务账户余额不足或套餐额度不可用。此错误由图片服务供应商返回，不是本地参数校验错误；请充值供应商账户，或切换其他图片服务/模型。降低生成质量只能减少后续消耗，无法绕过已无余额的账户。上游信息: ${detail}`;
  }
  if (input.status === 503 && isUnavailableImageRoute(detail)) {
    return `${prefix} (${input.status}): 图片服务当前没有可用于模型 "${input.model}" 的上游账号或通道。API Key 和模型清单可能仍然正常；请稍后仅重试生图步骤，或切换其他图片服务/模型。上游信息: ${detail}`;
  }
  if (isImageGatewayIdleTimeout(input.status)) {
    return `${prefix} (${input.status}): ${IMAGE_RESULT_UNKNOWN_PREFIX} 网关在等待图片服务时超时断开（常见于中转站约 100 秒空闲上限），图片可能仍在服务商侧生成并已计费。本应用不会自动重发；请先到服务商后台核对。若经常发生，可在设置中为该图片服务开启异步模式，或降低分辨率/质量以缩短生成时间。上游信息: ${detail}`;
  }
  if (input.status === 503) {
    return `${prefix} (${input.status}): 图片服务暂时不可用，请稍后仅重试生图步骤，或切换其他图片服务。上游信息: ${detail}`;
  }
  return `${prefix} (${input.status}): ${detail}`;
}

function extractImageProviderErrorDetail(bodyText: string): string {
  const fallback = bodyText.replace(/\s+/gu, ' ').trim().slice(0, 600) || 'empty provider response';
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: string | { message?: unknown };
      message?: unknown;
    };
    const message = typeof parsed.error === 'string'
      ? parsed.error
      : typeof parsed.error?.message === 'string'
        ? parsed.error.message
        : typeof parsed.message === 'string'
          ? parsed.message
          : '';
    return message.replace(/\s+/gu, ' ').trim().slice(0, 600) || fallback;
  } catch {
    return fallback;
  }
}
