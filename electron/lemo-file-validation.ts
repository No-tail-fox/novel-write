import ts from 'typescript';
import type { LemoProjectFile } from '../src/shared/creative-animation/native-project';
import type { LlmTextResult } from '../src/shared/llm-provider';
import { compileLemoNative } from './lemo-native-compiler';

export function lemoTruncationDiagnostic(response: LlmTextResult): string {
  const usage = response.usage ?? {};
  const total = Number(usage.completion_tokens ?? usage.output_tokens);
  const details = (usage.completion_tokens_details ?? usage.output_tokens_details ?? {}) as Record<string, unknown>;
  const reasoning = Number(details.reasoning_tokens), visible = Number(details.text_tokens);
  const counts = Number.isFinite(total) ? ' 输出预算已用 ' + total + ' token' +
    (Number.isFinite(reasoning) ? '，其中思考 ' + reasoning : '') + (Number.isFinite(visible) ? '、代码 ' + visible : '') + '。' : '';
  return 'LEMO_FILE_TRUNCATED: 模型回复达到输出上限，已保存不完整源码。' + counts + '请增加输出预算；重试会保留前序已完成步骤。';
}

export function validateLemoFile(source: string, kind: LemoProjectFile['kind']) {
  if (!source.trim() || source.length > 90000) throw new Error('LEMO_FILE_INCOMPLETE: 文件为空或超过 90000 字符。');
  const file = ts.createSourceFile('unit.js', 'async function factory(input,shared,scenes,core,THREE){\n' + source + '\n}', ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const fn = file.statements[0];
  if (!fn || !ts.isFunctionDeclaration(fn)) throw new Error('LEMO_FILE_INCOMPLETE: 缺少创作函数。');
  // A factory return can be followed by hoisted helpers, but never initialization.
  const statements = fn.body?.statements ?? [];
  const returnIndex = statements.findIndex(statement => ts.isReturnStatement(statement));
  const last = statements[returnIndex];
  if (!last || !ts.isReturnStatement(last) || !last.expression || !ts.isObjectLiteralExpression(last.expression)) throw new Error('LEMO_FILE_INCOMPLETE: 源码必须含有完整的 return { ... }，不能接受被截断的响应。');
  const unreachable = statements.slice(returnIndex + 1).find(statement => !ts.isFunctionDeclaration(statement) && !ts.isEmptyStatement(statement));
  if (unreachable) {
    const excerpt = unreachable.getText(file).replace(/\s+/g, ' ').slice(0, 160);
    throw new Error('LEMO_FILE_INCOMPLETE: 工厂 return 之后存在无法执行的语句：' + excerpt + '。请将所有变量、类和资源初始化移到最终 return { ... } 之前；return 之后仅允许提升的 function 声明。返回尚未初始化的 const/let 会触发运行错误。');
  }
  if (kind !== 'shared') for (const name of ['render', 'texts']) {
    if (!last.expression.properties.some(p => p.name?.getText(file).replace(/['"]/g, '') === name)) throw new Error('LEMO_FILE_CONTRACT: 缺少 ' + name + '(absoluteSeconds)。');
  }
  compileLemoNative('<html><head></head><body><script type="module">async function unit(input,shared,scenes,core,THREE){\n' + source.replace(/<\/script/gi, '<\\/script') + '\n} window.render=()=>{};window.DUR=1;window.READY=true;</script></body></html>');
}

