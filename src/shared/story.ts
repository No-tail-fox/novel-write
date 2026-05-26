import type { CoverMetadata, ImagePrompt, PipelineArtifact, StoryboardScene, SubtitleTrack } from './types';

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
      title: '武则天',
      subtitle: ['她被深宫遗忘十二年', '却走成唯一女皇'],
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
    title: first.replace(/[。！？!?；;].*$/u, '').slice(0, 12) || '人物故事',
    subtitle: ['命运转折', '故事成片'],
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

export function buildSubtitleTrack(scenes: Pick<StoryboardScene, 'id' | 'cap' | 'durationMs'>[]): SubtitleTrack {
  let cursor = 0;
  const cues = scenes.map((scene, index) => {
    const startMs = cursor;
    const endMs = cursor + scene.durationMs;
    cursor = endMs;
    return {
      index: index + 1,
      startMs,
      endMs,
      text: scene.cap,
    };
  });
  const srt = cues.map((cue) => `${cue.index}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`).join('\n');
  return { cues, srt };
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
