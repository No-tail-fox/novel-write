import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmWireMessage } from '../src/shared/llm-multimodal';
import { createConfiguredTextLlm } from '../src/shared/llm-provider';
import { defaultConfig } from '../src/shared/config';

const image = { dataUrl: 'data:image/png;base64,aGVsbG8=', label: '实际样帧：第 3 秒' };
afterEach(() => vi.unstubAllGlobals());
describe('visual review message adapters', () => {
  it.each(['openai', 'responses', 'anthropic'] as const)('preserves text-only requests for %s', protocol => {
    expect(llmWireMessage({ role: 'user', content: '导演构思' }, protocol)).toEqual({ role: 'user', content: '导演构思' });
  });
  it.each(['openai', 'responses', 'anthropic'] as const)('sends the actual local image through the configured %s text API', async protocol => {
    const bodies: Record<string, any>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      const body = protocol === 'anthropic' ? { id: 'a', content: [{ type: 'text', text: 'reviewed' }], stop_reason: 'end_turn' }
        : protocol === 'responses' ? { id: 'r', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'reviewed' }] }] }
        : { id: 'c', choices: [{ message: { content: 'reviewed' }, finish_reason: 'stop' }] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const model = createConfiguredTextLlm({ ...defaultConfig.llm, provider: 'custom', protocol, model: 'configured-model', baseUrl: 'https://test.example', apiKey: 'test-only' });
    const response = await model.run({ step: 1, name: 'visual-review', messages: [{ role: 'system', content: 'Review actual frames.' }, { role: 'user', content: '检查构图', images: [image] }], maxRetries: 0 });
    expect(response.text).toBe('reviewed');
    const messages = protocol === 'responses' ? bodies[0].input : bodies[0].messages;
    const user = messages.find((message: { role: string }) => message.role === 'user');
    const expectedImage = protocol === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }
      : protocol === 'responses' ? { type: 'input_image', image_url: image.dataUrl, detail: 'high' }
      : { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } };
    expect(user.content).toEqual([{ type: protocol === 'responses' ? 'input_text' : 'text', text: image.label }, expectedImage, { type: protocol === 'responses' ? 'input_text' : 'text', text: '检查构图' }]);
    expect(bodies[0].tool_choice).toBeUndefined();
  });
  it('rejects remote images, invalid base64, oversized payloads and images in assistant messages', () => {
    for (const dataUrl of ['https://test.example/image.png', 'data:image/svg+xml;base64,aGVsbG8=', 'data:image/png;base64,!!!!', 'data:image/png;base64,' + 'a'.repeat(7_000_004)]) {
      expect(() => llmWireMessage({ role: 'user', content: '', images: [{ dataUrl }] }, 'anthropic')).toThrow();
    }
    expect(() => llmWireMessage({ role: 'assistant', content: 'bad role', images: [image] }, 'openai')).toThrow('LLM_IMAGE_ROLE');
  });
});
