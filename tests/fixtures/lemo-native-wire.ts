type Json = Record<string, any>;
export function nativeReply(protocol: 'openai' | 'responses', text = 'OK', calls: Array<{ name: string; input: unknown }> = [], sequence = 1): Json {
  if (protocol === 'openai') return { id: 'chat_' + sequence, object: 'chat.completion', created: 1, model: 'fixture-model',
    choices: [{ index: 0, finish_reason: calls.length ? 'tool_calls' : 'stop', message: { role: 'assistant', content: calls.length ? null : text,
      ...(calls.length ? { tool_calls: calls.map((c, i) => ({ id: 'call_' + sequence + '_' + i, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) } : {}) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  return { id: 'resp_' + sequence, object: 'response', model: 'fixture-model', created_at: 1, status: 'completed', error: null, incomplete_details: null,
    output: calls.length ? calls.map((c, i) => ({ id: 'fc_' + sequence + '_' + i, type: 'function_call', status: 'completed', call_id: 'call_' + sequence + '_' + i, name: c.name, arguments: JSON.stringify(c.input) }))
      : [{ type: 'message', id: 'msg_' + sequence, status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 0 } } };
}
export const frame = (v: unknown) => 'data: ' + JSON.stringify(v) + '\n\n';
export function nativeStream(protocol: 'openai' | 'responses', startOnly = false) {
  if (protocol === 'responses') return frame({ type: 'response.created', sequence_number: 0, response: { id: 'resp_1', status: 'in_progress' } })
    + (startOnly ? '' : frame({ type: 'response.completed', sequence_number: 1, response: nativeReply(protocol) }));
  const chunk = { id: 'chat_1', object: 'chat.completion.chunk', created: 1, model: 'fixture-model' };
  return frame({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] })
    + (startOnly ? '' : frame({ ...chunk, choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n');
}
