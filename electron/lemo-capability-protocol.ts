import type { LlmProtocol } from '../src/shared/llm-protocol';
type Json = Record<string, any>;
/** The small capability probes use the same content across native wire protocols. */
export function lemoCapabilityWireBody(protocol: LlmProtocol, body: Json): Json {
  if (protocol === 'anthropic') return body;
  const tools = body.tools?.map((t: Json) => protocol === 'openai'
    ? { type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }
    : { type: 'function', name: t.name, description: t.description, parameters: t.input_schema });
  const tool_choice = body.tool_choice?.type === 'tool'
    ? protocol === 'openai' ? { type: 'function', function: { name: body.tool_choice.name } } : { type: 'function', name: body.tool_choice.name }
    : body.tool_choice ? 'auto' : undefined;
  const input: Json[] = [];
  for (const message of body.messages) {
    if (typeof message.content === 'string') { input.push({ role: message.role, content: message.content }); continue; }
    const content: Json[] = []; const calls: Json[] = [];
    if (protocol === 'responses' && message.rawResponse?.output) { input.push(...message.rawResponse.output); continue; }
    for (const part of message.content) {
      if (part.type === 'text') content.push(protocol === 'openai' ? { type: 'text', text: part.text }
        : { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text });
      else if (part.type === 'image') {
        const url = 'data:' + part.source.media_type + ';base64,' + part.source.data;
        content.push(protocol === 'openai' ? { type: 'image_url', image_url: { url } } : { type: 'input_image', image_url: url });
      } else if (part.type === 'tool_use') {
        if (protocol === 'openai') calls.push({ id: part.id, type: 'function', function: { name: part.name, arguments: JSON.stringify(part.input) } });
        else input.push({ type: 'function_call', call_id: part.id, name: part.name, arguments: JSON.stringify(part.input) });
      } else if (part.type === 'tool_result') input.push(protocol === 'openai'
        ? { role: 'tool', tool_call_id: part.tool_use_id, content: part.content }
        : { type: 'function_call_output', call_id: part.tool_use_id, output: part.content });
    }
    if (content.length || calls.length) input.push({ role: message.role, content: content.length ? content : null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return { ...(protocol === 'openai' ? { messages: input, max_tokens: body.max_tokens } : { input, max_output_tokens: body.max_tokens, store: false, include: ['reasoning.encrypted_content'] }),
    stream: body.stream, ...(tools ? { tools, tool_choice, parallel_tool_calls: false } : {}) };
}
export function isLemoCapabilityStreamStart(protocol: LlmProtocol, event: Json): boolean {
  if (protocol === 'anthropic') return event.type === 'message_start' && event.message?.type === 'message' && event.message?.role === 'assistant';
  if (protocol === 'responses') return event.type === 'response.created' && typeof event.response?.id === 'string';
  return event.object === 'chat.completion.chunk' && typeof event.id === 'string' && event.choices?.[0]?.delta?.role === 'assistant';
}
