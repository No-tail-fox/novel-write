import type { LlmMessage } from './llm-provider';
import type { LlmProtocol } from './llm-protocol';

/** Wire format is selected by protocol, independently of the model's name. */
export function llmWireMessage(message: LlmMessage, protocol: LlmProtocol) {
  if (!message.images?.length) return { role: message.role, content: message.content };
  if (message.role !== 'user') throw new Error('LLM_IMAGE_ROLE: Images belong in a user message.');
  if (message.images.length > 24) throw new Error('LLM_IMAGE_LIMIT: At most 24 images per message.');
  const parts: unknown[] = [];
  let bytes = 0;
  for (const image of message.images) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if (!match || match[2].length % 4 !== 0) throw new Error('LLM_IMAGE_DATA: Expected a local PNG, JPEG or WebP data URL.');
    bytes += match[2].length;
    if (match[2].length > 7_000_000 || bytes > 24_000_000) throw new Error('LLM_IMAGE_LIMIT: Resize images before sending.');
    if (image.label) parts.push({ type: protocol === 'responses' ? 'input_text' : 'text', text: image.label });
    parts.push(protocol === 'anthropic' ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
      : protocol === 'responses' ? { type: 'input_image', image_url: image.dataUrl, detail: 'high' }
      : { type: 'image_url', image_url: { url: image.dataUrl, detail: 'high' } });
  }
  parts.push({ type: protocol === 'responses' ? 'input_text' : 'text', text: message.content });
  return { role: message.role, content: parts };
}
