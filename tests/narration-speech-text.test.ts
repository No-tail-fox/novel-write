import { describe, expect, it } from 'vitest';
import { narrationSpeechText } from '../src/shared/narration-speech-text';
import { editorialVoiceInput } from '../src/features/director-desk/director-generation';
import { nativeDocument } from './lemo-native.fixture';

describe('speech-only markdown normalization', () => {
  it.each([
    ['## 奶头乐：当快乐成为一种 "投喂"', '奶头乐：当快乐成为一种 "投喂"'],
    ['那就是 ——**"奶头乐"**。 ### 一、什么是奶头乐', '那就是 ——"奶头乐"。 一、什么是奶头乐'],
    ['**门槛低、刺激强、反馈快**', '门槛低、刺激强、反馈快'],
    ['普通 C# 与 #话题，a_b_c，2 * 3 * 4，2 ** 3。', '普通 C# 与 #话题，a_b_c，2 * 3 * 4，2 ** 3。'],
    ['*强调* 和 _斜体_ 与 __粗体__', '强调 和 斜体 与 粗体'],
    ['- 第一项\n> 引用\n2. 第二项', '第一项 引用 第二项'],
    ['[官网](https://example.test) 与 ![图解](https://example.test/a.png)', '官网 与 图解'],
    ['**好**', '好'],
    ['没有任何格式的正文。', '没有任何格式的正文。'],
  ])('normalizes %s without changing content', (input, expected) => {
    expect(narrationSpeechText(input)).toBe(expected);
    expect(narrationSpeechText(narrationSpeechText(input))).toBe(expected);
  });
  it('derives the director request without rewriting source or subtitle cues', () => {
    const d = nativeDocument(); const shot = d.beats[0].shots[0];
    d.beats[0].subtitleCues.find(c => shot.subtitleCueIds.includes(c.id))!.text = '## 章节：**正文**';
    const saved = JSON.stringify(d);
    const input = editorialVoiceInput(d, shot.id, { provider: 'volcengine', voiceId: 'test', voiceLabel: 'test', speed: 1 });
    expect(input.text).toContain('章节：正文'); expect(input.text).not.toMatch(/[#*]/u);
    expect(JSON.stringify(d)).toBe(saved);
  });
});
