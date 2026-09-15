// Keep production IPC/config/vault behavior; replace only outbound provider traffic.
const { writeFileSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const directory = process.env.STORYDREAM_PROJECT_QA_DIR;
if (!directory) throw new Error('Missing isolated LLM QA directory');
const requests = [];
global.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== 'llm.example') throw new Error('LLM QA blocks external network calls');
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const headers = new Headers(init?.headers);
  requests.push({ path: url.pathname, model: body.model, hasBearer: headers.has('authorization'), hasAnthropicKey: headers.has('x-api-key'), hasInput: Array.isArray(body.input), hasMessages: Array.isArray(body.messages), format: body.text?.format, maxOutputTokens: body.max_output_tokens });
  writeFileSync(join(directory, 'llm-requests.json'), JSON.stringify(requests), 'utf8');
  let mode = '';
  try { mode = JSON.parse(readFileSync(join(directory, 'llm-controls.json'), 'utf8')).mode; } catch {}
  await new Promise(resolve => setTimeout(resolve, 350));
  if (mode === 'fail') return new Response('QA unsupported protocol', { status: 404 });
  if (url.pathname.endsWith('/models')) return Response.json({ data: [{ id: 'qa-model' }] });
  if (url.pathname.endsWith('/responses')) return Response.json({ id: 'qa-responses', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }] });
  if (url.pathname.endsWith('/messages')) return Response.json({ id: 'qa-messages', stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'return_json', input: { ok: true } }] });
  if (url.pathname.endsWith('/chat/completions')) return Response.json({ id: 'qa-chat', choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] });
  throw new Error('Unexpected QA provider path');
};
require('./qa-project-home.cjs');
