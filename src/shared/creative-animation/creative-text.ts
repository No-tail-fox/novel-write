import { z } from 'zod';
import { LLM_RESPONSE_MAX_BYTES } from '../llm-response-limits';

const encoder = new TextEncoder();
const resourceMessage = 'LEMO_RESOURCE_LIMIT: 创作数据超过 8 MiB 资源保护范围。已保留此前检查点，请拆分当前阶段；这不是创意字数要求。';

/** Keep original text intact. Length guidance must not reject valid creative prose. */
export const lemoResponseTextSchema = z.string().refine(
  text => encoder.encode(text).byteLength <= LLM_RESPONSE_MAX_BYTES, { message: resourceMessage },
);
export const lemoCreativeTextSchema = lemoResponseTextSchema.refine(
  text => text.trim().length > 0, { message: '创作内容不能为空。' },
);

/** Bound aggregate JSON resources, not each sentence's character count. */
export function checkLemoPayloadResource(value: unknown, context: z.RefinementCtx) {
  if (encoder.encode(JSON.stringify(value)).byteLength > LLM_RESPONSE_MAX_BYTES) {
    context.addIssue({ code: 'custom', message: resourceMessage });
  }
}
