import { z } from 'zod';
import { lemoCreativeTextSchema, lemoResponseTextSchema, checkLemoPayloadResource } from './creative-text';

export const LEMO_EDIT_MAX_ROUNDS = 16;
export const LEMO_EDIT_PAYLOAD_LIMIT = 24000;
export const LEMO_EDIT_REPLACEMENT_LIMIT = 16000;
const replySchema = z.object({
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  edits: z.array(z.object({ search: z.string().max(90000), replace: z.string() }).strict()).max(12),
  done: z.boolean(), summary: lemoCreativeTextSchema,
}).strict().superRefine(checkLemoPayloadResource);

/** Apply a bounded transaction to the exact saved source. Validation/execution belongs to the host. */
export function applyLemoEdits(source: string, baseHash: string, raw: string) {
  const trimmed = raw.trim();
  let reply: z.infer<typeof replySchema>;
  try {
    lemoResponseTextSchema.parse(raw);
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch {
      // Extract one complete JSON fence; never repair strings or choose between patches.
      const fences = [...trimmed.matchAll(/(?:^|\r?\n)[ \t]*```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```[ \t]*(?=\r?\n|$)/gi)];
      if (fences.length !== 1) throw new Error('Expected one complete JSON patch.');
      parsed = JSON.parse(fences[0][1]);
    }
    reply = replySchema.parse(parsed);
  }
  catch (error) {
    const resourceIssue = error instanceof z.ZodError
      ? error.issues.find(issue => issue.message.startsWith('LEMO_RESOURCE_LIMIT:')) : undefined;
    if (resourceIssue) throw new Error(resourceIssue.message);
    if (trimmed && !trimmed.includes('{') && !trimmed.includes('[') && !trimmed.includes('```')) {
      throw new Error('LEMO_EDIT_NO_ACTION: 模型只返回了说明，没有交付可执行的代码修改。源码和上下文已在请求中提供；请直接提交本批 JSON 补丁，不要只描述下一步。上一批源码保持可用。');
    }
    throw new Error('LEMO_EDIT_INVALID: 本批修改格式不完整，已保留上一批可用源码。');
  }
  if (reply.baseHash !== baseHash) throw new Error('LEMO_EDIT_STALE: 本批修改对应的源码版本不一致，未写入工程。');
  for (const [index, edit] of reply.edits.entries()) {
    if (edit.replace.length > LEMO_EDIT_REPLACEMENT_LIMIT) throw new Error(`LEMO_EDIT_SIZE: 第 ${index + 1} 处替换有 ${edit.replace.length} 字符，超过单处 ${LEMO_EDIT_REPLACEMENT_LIMIT} 字符限制。请拆成更小批次，每批只实现一个绘图能力；上一批源码保持可用。`);
  }
  if (reply.edits.reduce((n, e) => n + e.search.length + e.replace.length, 0) > LEMO_EDIT_PAYLOAD_LIMIT) throw new Error('LEMO_EDIT_SIZE: 本批修改超过 24000 字符，请分成更小的批次。');
  if (!reply.edits.length && (!reply.done || !source.trim())) throw new Error('LEMO_EDIT_EMPTY: 本批未提交修改，也未完成已有文件。');
  let next = source;
  for (const { search, replace } of reply.edits) {
    if (search === replace) throw new Error('LEMO_EDIT_NOOP: 本批包含无效的重复修改。');
    if (!search) {
      if (next || reply.edits.length !== 1) throw new Error('LEMO_EDIT_AMBIGUOUS: 空查找只可用于首次建立文件。');
      next = replace;
    } else {
      const at = next.indexOf(search);
      if (at < 0 || next.indexOf(search, at + 1) >= 0) throw new Error('LEMO_EDIT_AMBIGUOUS: 修改位置缺失或不唯一，未写入工程。');
      next = next.slice(0, at) + replace + next.slice(at + search.length);
    }
  }
  if (!next.trim() || next.length > 90000) throw new Error('LEMO_EDIT_SIZE: 修改后的文件为空或超过 90000 字符。');
  return { source: next, done: reply.done, summary: reply.summary };
}
