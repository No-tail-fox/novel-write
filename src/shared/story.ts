import type { CoverMetadata, ImagePrompt, PipelineArtifact, StoryboardScene, SubtitleTrack, TaskSubtitleSceneLines } from './types';

const negativePrompt = '卡通，动漫，插画，低质量，模糊，变形，畸形肢体，水印，文字，签名，额外手指，重复面孔';

const wuScenes = [
  '十四岁入宫时，武则天只是唐太宗身边一个没有声量的才人。',
  '十二年过去，她没有得到升迁，青春被困在深宫的长廊里。',
  '命运的转折出现在唐高宗李治身边，她重新回到宫廷。',
  '她被立为昭仪，也第一次真正靠近权力中心。',
  '王皇后和萧淑妃失势之后，她坐上了皇后的位置。',
  '从此，武则天不再只是被安排命运的人，而是开始安排局面的人。',
  '她与唐高宗并称二圣，朝堂的目光再也无法绕开她。',
  '她的每一步都伴随着争议，也伴随着极强的判断和耐心。',
  '后来她走向武周，成为中国历史上唯一的女皇帝。',
  '很多人只记得她登顶的那一刻，却忘了她曾在低谷里沉默十二年。',
  '低谷不等于结局，有些翻身，只是在等待最合适的时机。',
];

function splitSentences(input: string): string[] {
  return input
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .split(/(?<=[。！？!?；;])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function isWuZetian(input: string): boolean {
  return /武则天|武曌|武后|武媚/.test(input);
}

export function normalizeSourceText(input: string): string {
  const trimmed = input.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!trimmed) return '';
  const sentences = splitSentences(trimmed);
  if (sentences.length <= 1) return trimmed;

  const paragraphSize = Math.max(1, Math.ceil(sentences.length / 3));
  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += paragraphSize) {
    paragraphs.push(sentences.slice(i, i + paragraphSize).join(''));
  }
  return paragraphs.join('\n\n');
}

export function reviewSourceText(input: string): string {
  const normalized = normalizeSourceText(input);
  return normalized
    .replace(/通称/g, '又称')
    .replace(/通过/g, '经由')
    .replace(/\s+\n/g, '\n')
    .trim();
}

export function rewriteSourceText(input: string): string {
  if (isWuZetian(input)) {
    return [
      '十四岁入宫，十二年没有升迁，她像是被深宫遗忘。',
      '可谁能想到，这个沉默的才人，后来会成为中国历史上唯一的女皇帝。',
      '她重新回到唐高宗身边，从昭仪到皇后，再到与高宗并称二圣。',
      '她一路走向武周，也一路背负争议、判断和孤独。',
      '低谷不等于结局，有些翻身，只是在等待最合适的时机。',
    ].join('\n\n');
  }

  const sentences = splitSentences(reviewSourceText(input)).slice(0, 6);
  return `${sentences.join('')}\n\n低谷不等于结局，真正的转折，往往藏在长期沉默之后。`;
}

export function buildCoverMetadata(input: string): CoverMetadata {
  if (isWuZetian(input)) {
    return {
      title: '被遗忘十二年后称帝',
      subtitle: ['十四岁入宫无人问', '最终走成唯一女皇'],
      summary: '十四岁入宫，十二年没有升迁。武则天从深宫才人走向皇后、二圣与武周，她的翻身从来不是偶然。',
      tags: ['#人物故事', '#武则天', '#唐朝', '#女皇', '#历史', '#逆袭', '#传记', '#短视频文案'],
      comments: [
        '十二年才人都没放弃，真的很震撼',
        '她的耐心和判断太强了',
        '低谷不等于结局，这句很有力量',
        '如果是我可能早就放弃了',
        '想看完整时间线',
      ],
    };
  }

  const first = splitSentences(input)[0] ?? '人物故事';
  return {
    title: first.replace(/[。！？!?；;].*$/u, '').slice(0, 14) || '命运如何被改写',
    subtitle: ['一个决定改变余生', '结局远比想象意外'],
    summary: `${first.slice(0, 58)}${first.length > 58 ? '...' : ''}`,
    tags: ['#人物故事', '#短视频', '#故事', '#转折'],
    comments: ['这个故事很有画面感', '结尾有点打动我', '想看完整版本'],
  };
}

function styleLead(style: string): string {
  if (style === 'black-white') {
    return '黑白纪实摄影，高对比光影，真实颗粒感，电影级构图';
  }
  if (style === 'ancient-film') {
    return '古风电影质感，唐代宫廷场景，真实服饰，庄重光影';
  }
  return '写实彩色摄影，电影级布光，真实人物质感，清晰细节';
}

function characterProfile(input: string): string {
  if (isWuZetian(input)) {
    return '中国唐代女性，年轻时清瘦沉静，目光坚定，唐代宫廷发髻与服饰，人物前后一致。';
  }
  return '主体保持一致，外貌、服饰、年龄和场景风格在每个镜头中连续。';
}

export function buildImagePrompts(
  scenes: Pick<StoryboardScene, 'id' | 'cap'>[],
  options: { style?: string; ratio?: string; inputText?: string } = {},
): ImagePrompt[] {
  const profile = characterProfile(options.inputText ?? '');
  return scenes.map((scene) => ({
    sceneId: scene.id,
    cap: scene.cap,
    prompt: `${styleLead(options.style ?? 'photo-real')}，${profile}，画面旁白：${scene.cap}，人物居中，情绪克制，自然光影，适合 ${options.ratio ?? '9:16'} 短视频分镜。`,
    negativePrompt,
    style: options.style ?? 'photo-real',
    ratio: options.ratio ?? '9:16',
    characterProfile: profile,
  }));
}

export function buildStoryboardScenes(input: string, style = 'photo-real', ratio = '9:16'): StoryboardScene[] {
  const caps = isWuZetian(input)
    ? wuScenes
    : splitSentences(rewriteSourceText(input))
        .flatMap((sentence) => sentence.split(/，|,/u))
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .slice(0, 12);
  const prompts = buildImagePrompts(
    caps.map((cap, index) => ({ id: index + 1, cap })),
    { style, ratio, inputText: input },
  );
  return caps.map((cap, index) => ({
    id: index + 1,
    cap,
    descPrompt: prompts[index].prompt,
    durationMs: Math.max(1800, Math.min(5200, cap.length * 170)),
  }));
}

function srtTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
}

const defaultCaptionMaxCharsPerLine = 12;
const minimumCaptionMaxCharsPerLine = 6;
const maximumCaptionMaxCharsPerLine = 24;
const storyboardSceneMaxCharacters = 55;

interface CaptionToken {
  text: string;
  pauseAfter: number;
}

export interface SubtitleTrackOptions {
  maxCharsPerLine?: number;
}

export function splitCaptionLines(input: string, maxCharsPerLine = defaultCaptionMaxCharsPerLine): string[] {
  const maxChars = clampCaptionMaxChars(maxCharsPerLine);
  const tokens = mergeProtectedCaptionTokens(tokenizeCaption(input));
  if (tokens.length === 0) return [];

  const lines = chooseCaptionLines(tokens, maxChars);
  const expected = normalizeCaptionComparableText(input);
  const actual = normalizeCaptionComparableText(lines.join(''));
  if (actual === expected) return lines;
  return splitCaptionFallback(expected, maxChars);
}

export function normalizeStoryboardSceneLengths(
  scenes: StoryboardScene[],
  maxCharacters = storyboardSceneMaxCharacters,
): StoryboardScene[] {
  const normalizedMax = Math.max(20, Math.round(maxCharacters));
  return scenes
    .flatMap((scene) => {
      const caps = splitStoryboardCap(scene.cap, normalizedMax);
      if (caps.length === 1 && caps[0] === scene.cap.trim()) return [{ ...scene, cap: caps[0] }];
      return caps.map((cap) => ({
        ...scene,
        cap,
        descPrompt: cap,
        durationMs: estimateStorySceneDurationMs(cap),
      }));
    })
    .map((scene, index) => ({ ...scene, id: index + 1 }));
}

export function splitStoryboardCap(input: string, maxCharacters = storyboardSceneMaxCharacters): string[] {
  const maxChars = Math.max(20, Math.round(maxCharacters));
  const pending = input.trim();
  if (!pending || visibleTextLength(pending) <= maxChars) return pending ? [pending] : [];

  const pieces: string[] = [];
  let remainder = pending;
  while (visibleTextLength(remainder) > maxChars) {
    const chars = Array.from(remainder);
    const totalLength = visibleTextLength(remainder);
    const preferred = totalLength - 45 < 15 ? Math.max(20, totalLength - 15) : 45;
    const breakIndex = findStoryboardBreakIndex(chars, maxChars, preferred);
    const piece = chars.slice(0, breakIndex).join('').trim();
    const next = chars.slice(breakIndex).join('').trim();
    if (!piece || !next) break;
    pieces.push(piece);
    remainder = next;
  }
  if (remainder.trim()) pieces.push(remainder.trim());

  if (pieces.length > 1) {
    const tail = pieces[pieces.length - 1];
    const previous = pieces[pieces.length - 2];
    if (visibleTextLength(tail) < 15 && visibleTextLength(previous + tail) <= maxChars) {
      pieces.splice(pieces.length - 2, 2, previous + tail);
    }
  }
  return pieces;
}

export function buildSubtitleTrack(
  scenes: Pick<StoryboardScene, 'id' | 'cap' | 'durationMs'>[],
  options: SubtitleTrackOptions = {},
): SubtitleTrack {
  const maxCharsPerLine = clampCaptionMaxChars(options.maxCharsPerLine ?? defaultCaptionMaxCharsPerLine);
  return buildSubtitleTrackFromLineResolver(scenes, (scene) => splitCaptionLines(scene.cap, maxCharsPerLine));
}

export function buildSubtitleTrackFromSceneLines(
  scenes: Pick<StoryboardScene, 'id' | 'cap' | 'durationMs'>[],
  sceneLines: readonly TaskSubtitleSceneLines[],
): SubtitleTrack {
  const linesBySceneId = new Map(sceneLines.map((item) => [item.sceneId, item.lines.map((line) => line.trim()).filter(Boolean)] as const));
  return buildSubtitleTrackFromLineResolver(scenes, (scene) => linesBySceneId.get(scene.id) ?? []);
}

function buildSubtitleTrackFromLineResolver(
  scenes: Pick<StoryboardScene, 'id' | 'cap' | 'durationMs'>[],
  resolveLines: (scene: Pick<StoryboardScene, 'id' | 'cap' | 'durationMs'>) => string[],
): SubtitleTrack {
  let cursor = 0;
  const cues: SubtitleTrack['cues'] = [];
  for (const scene of scenes) {
    const sceneStartMs = cursor;
    const sceneDurationMs = Math.max(1, Math.round(Number(scene.durationMs) || 0));
    const sceneEndMs = sceneStartMs + sceneDurationMs;
    const lines = resolveLines(scene);
    const durations = distributeSubtitleDurations(sceneDurationMs, lines);
    let cueCursor = sceneStartMs;
    lines.forEach((text, lineIndex) => {
      const endMs = lineIndex === lines.length - 1 ? sceneEndMs : cueCursor + durations[lineIndex];
      cues.push({
        index: cues.length + 1,
        sceneId: scene.id,
        startMs: cueCursor,
        endMs,
        text,
      });
      cueCursor = endMs;
    });
    cursor = sceneEndMs;
  }
  const srt = cues.map((cue) => `${cue.index}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`).join('\n');
  return { cues, srt };
}

function tokenizeCaption(input: string): CaptionToken[] {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const tokens: CaptionToken[] = [];
  for (const item of segmenter.segment(input.replace(/\r/gu, ''))) {
    const raw = item.segment;
    const clean = raw.replace(/[\p{P}\s]+/gu, '');
    if (clean) {
      tokens.push({ text: clean, pauseAfter: 0 });
      continue;
    }
    if (tokens.length > 0) {
      tokens[tokens.length - 1].pauseAfter = Math.max(tokens[tokens.length - 1].pauseAfter, captionPauseStrength(raw));
    }
  }
  return tokens;
}

function mergeProtectedCaptionTokens(tokens: CaptionToken[]): CaptionToken[] {
  const merged: CaptionToken[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];
    if (/^(?:公元|西元)$/u.test(current.text) && next && /^\d+(?:\.\d+)?$/u.test(next.text) && afterNext && isDateOrCounterSuffix(afterNext.text)) {
      merged.push({ text: current.text + next.text + afterNext.text, pauseAfter: afterNext.pauseAfter });
      index += 2;
      continue;
    }
    if (/^第$/u.test(current.text) && next && /^[\d一二三四五六七八九十百千万]+$/u.test(next.text) && afterNext && isDateOrCounterSuffix(afterNext.text)) {
      merged.push({ text: current.text + next.text + afterNext.text, pauseAfter: afterNext.pauseAfter });
      index += 2;
      continue;
    }
    if (/^\d+(?:\.\d+)?$/u.test(current.text) && next && isDateOrCounterSuffix(next.text)) {
      merged.push({ text: current.text + next.text, pauseAfter: next.pauseAfter });
      index += 1;
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function chooseCaptionLines(tokens: CaptionToken[], maxChars: number): string[] {
  interface Candidate {
    lines: string[];
    penalty: number;
  }
  const memo = new Map<number, Candidate>();
  const solve = (start: number): Candidate => {
    if (start >= tokens.length) return { lines: [], penalty: 0 };
    const cached = memo.get(start);
    if (cached) return cached;
    const candidates: Candidate[] = [];
    const collect = (preventLeadingParticle: boolean) => {
      let text = '';
      for (let end = start; end < tokens.length; end += 1) {
        text += tokens[end].text;
        const length = visibleTextLength(text);
        if (length > maxChars && end > start) break;
        if (preventLeadingParticle && end + 1 < tokens.length && /^的/u.test(tokens[end + 1].text)) continue;
        const tail = solve(end + 1);
        const shortfall = Math.max(0, maxChars - 2 - length);
        candidates.push({
          lines: [text, ...tail.lines],
          penalty: tail.penalty + shortfall * shortfall + Math.abs(maxChars - length) * 0.2 - tokens[end].pauseAfter * 4,
        });
        if (length > maxChars) break;
      }
    };
    collect(true);
    if (candidates.length === 0) collect(false);
    candidates.sort((left, right) => left.lines.length - right.lines.length || left.penalty - right.penalty);
    const selected = candidates[0] ?? { lines: [tokens[start].text], penalty: 0 };
    memo.set(start, selected);
    return selected;
  };
  return solve(0).lines;
}

function splitCaptionFallback(input: string, maxChars: number): string[] {
  const chars = Array.from(input);
  const lines: string[] = [];
  for (let index = 0; index < chars.length; index += maxChars) {
    lines.push(chars.slice(index, index + maxChars).join(''));
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index].startsWith('的') || lines[index - 1].length === 0) continue;
    const previousChars = Array.from(lines[index - 1]);
    const prefix = previousChars.pop();
    if (!prefix) continue;
    lines[index - 1] = previousChars.join('');
    lines[index] = prefix + lines[index];
  }
  return lines.filter(Boolean);
}

function distributeSubtitleDurations(totalDurationMs: number, lines: string[]): number[] {
  if (lines.length === 0) return [];
  if (lines.length === 1) return [totalDurationMs];
  const minimumDurationMs = 600;
  const weights = lines.map((line) => Math.max(1, visibleTextLength(line)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const reserve = totalDurationMs >= minimumDurationMs * lines.length ? minimumDurationMs : 0;
  const distributable = totalDurationMs - reserve * lines.length;
  const durations = weights.map((weight) => reserve + Math.max(1, Math.floor(distributable * weight / weightTotal)));
  const delta = totalDurationMs - durations.reduce((sum, duration) => sum + duration, 0);
  durations[durations.length - 1] += delta;
  return durations;
}

function findStoryboardBreakIndex(chars: string[], maxChars: number, preferred: number): number {
  const candidates: Array<{ index: number; visible: number; score: number }> = [];
  let visible = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (!/\s/u.test(chars[index])) visible += 1;
    if (visible > maxChars) break;
    const strength = storyboardBoundaryStrength(chars[index]);
    if (visible >= 20 && strength > 0) {
      candidates.push({ index: index + 1, visible, score: strength * 100 - Math.abs(preferred - visible) });
    }
  }
  candidates.sort((left, right) => right.score - left.score || right.visible - left.visible);
  if (candidates.length > 0) return candidates[0].index;

  visible = 0;
  for (let index = 0; index < chars.length; index += 1) {
    if (!/\s/u.test(chars[index])) visible += 1;
    if (visible >= Math.min(preferred, maxChars)) return index + 1;
  }
  return Math.min(chars.length, maxChars);
}

function storyboardBoundaryStrength(char: string): number {
  if (/[。！？!?；;]/u.test(char)) return 3;
  if (/[，,、：:]/u.test(char)) return 2;
  if (/[—…]/u.test(char)) return 1;
  return 0;
}

function captionPauseStrength(value: string): number {
  if (/[。！？!?；;\n]/u.test(value)) return 3;
  if (/[，,、：:]/u.test(value)) return 2;
  return /[\p{P}]/u.test(value) ? 1 : 0;
}

function isDateOrCounterSuffix(value: string): boolean {
  return /^(?:年|月|日|号|岁|时|分|秒|点|届|集|章|期|季|代|世纪)$/u.test(value);
}

function clampCaptionMaxChars(value: number): number {
  const parsed = Number.isFinite(value) ? Math.round(value) : defaultCaptionMaxCharsPerLine;
  return Math.min(maximumCaptionMaxCharsPerLine, Math.max(minimumCaptionMaxCharsPerLine, parsed));
}

function normalizeCaptionComparableText(value: string): string {
  return value.replace(/[\p{P}\s]+/gu, '');
}

function visibleTextLength(value: string): number {
  return Array.from(value.replace(/\s+/gu, '')).length;
}

function estimateStorySceneDurationMs(cap: string): number {
  return Math.max(1200, Math.round((visibleTextLength(cap) / 5) * 1000));
}

export async function buildStoryPackage(
  input: string,
  options: { style?: string; ratio?: string } = {},
): Promise<PipelineArtifact> {
  const reviewedText = reviewSourceText(input);
  const rewrittenCopy = rewriteSourceText(input);
  const cover = buildCoverMetadata(input);
  const scenes = buildStoryboardScenes(input, options.style ?? 'photo-real', options.ratio ?? '9:16');
  const imagePrompts = buildImagePrompts(scenes, { style: options.style ?? 'photo-real', ratio: options.ratio ?? '9:16', inputText: input });
  const subtitles = buildSubtitleTrack(scenes);
  return {
    reviewedText,
    rewrittenCopy,
    cover,
    scenes,
    imagePrompts,
    subtitles,
  };
}
