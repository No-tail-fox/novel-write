import {expect,it} from 'vitest';
import {summarizeErrorMessage} from '../src/components/ErrorDetails';
it('shows a useful recovery summary instead of cutting a decimal timestamp at its first dot',()=>{
 expect(summarizeErrorMessage('LEMO_PROJECT_FAILED: CREATIVE_CODE_RUNTIME: LEMO_CANVAS_STATE: render(0.44445) 遗漏 1 次 restore()')).toBe('绘图状态未正确恢复，已阻止错误成片');
 expect(summarizeErrorMessage('LEMO_TEXTS: 字幕 cue-1 缺少当帧实际绘制的完整文案')).toBe('字幕未通过实际画面检查，需修复后继续');
});

it('explains a rejected director request without splitting the provider hostname', () => {
 expect(summarizeErrorMessage('LLM API error (400) at step 1 Lemo 全片导演方案 via https://cf.hetune.top/v1/messages: upstream_error')).toBe('文本模型服务拒绝请求（HTTP 400），请检查模型与接口配置');
});

it('distinguishes exhausted plan output, invalid JSON and interrupted reception', () => {
 expect(summarizeErrorMessage('LLM_JSON_TRUNCATED: plan 4096 tokens')).toBe('导演方案输出预算耗尽，请检查模型输出预算');
 expect(summarizeErrorMessage('LLM_JSON_INVALID: invalid JSON')).toBe('模型回复不是有效 JSON，未进入后续制作');
 expect(summarizeErrorMessage('LLM_STREAM_INTERRUPTED: closed')).toBe('文本接收中断，云端结果待核对');
});


it.each([
  'LLM_STREAM_INTERRUPTED: 流式回复中断，尚未收到正文，仅保留已收到的回执信息；服务商请求编号：msg_test',
  'LLM_STREAM_INTERRUPTED: 流式回复中断，已保留 123 个正文字符（不代表完整结果）',
  'LLM_STREAM_INTERRUPTED: 流式回复中断，已保留收到的文本和请求编号；云端最终结果仍待核对。',
])('keeps interrupted-stream summaries neutral for zero, partial and legacy receipts: %s', (message) => {
  expect(summarizeErrorMessage(message)).toBe('文本接收中断，云端结果待核对');
  expect(summarizeErrorMessage(message)).not.toContain('已保留');
});
