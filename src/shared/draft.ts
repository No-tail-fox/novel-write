import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoverMetadata, DiagnosticsReport, ImagePrompt, StoryboardScene } from './types';
import { buildSubtitleTrack } from './story';
import { getTemplate } from './templates';

export interface WriteDraftInput {
  outputDir: string;
  title: string;
  cover: CoverMetadata;
  ratio: string;
  templateId?: string;
  scenes: StoryboardScene[];
  imagePrompts: ImagePrompt[];
  reviewedText: string;
  rewrittenCopy: string;
  bgm: {
    id?: string;
    title: string;
    durationMs: number;
    volume?: number;
  };
  speaker?: string;
  ttsSpeed?: number;
}

export interface DraftWriteResult {
  packageDir: string;
  assets: {
    images: string[];
    audio: string[];
    subtitles: string;
  };
  diagnostics: DiagnosticsReport;
}

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

function silentWav(durationMs: number): Buffer {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * channels * (bitsPerSample / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  buffer.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

export async function writeDraftPackage(input: WriteDraftInput): Promise<DraftWriteResult> {
  const packageDir = input.outputDir;
  const imagesDir = join(packageDir, 'images');
  const audioDir = join(packageDir, 'audio');
  await mkdir(imagesDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  const images: string[] = [];
  for (const scene of input.scenes) {
    const file = join(imagesDir, `${String(scene.id).padStart(2, '0')}.png`);
    await writeFile(file, onePixelPng);
    images.push(file);
  }

  const audio: string[] = [];
  for (const scene of input.scenes) {
    const file = join(audioDir, `${String(scene.id).padStart(2, '0')}.wav`);
    await writeFile(file, silentWav(Math.round(scene.durationMs / (input.ttsSpeed || 1))));
    audio.push(file);
  }

  const subtitles = buildSubtitleTrack(input.scenes);
  const subtitlesFile = join(packageDir, 'subtitles.srt');
  await writeFile(subtitlesFile, subtitles.srt, 'utf8');

  const template = getTemplate(input.templateId ?? (input.ratio === '16:9' ? 'builtin-landscape-16-9' : 'default-portrait-9-16'));
  const totalDuration = input.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  const draftProject = {
    schema: 'storybound-replica.v2',
    title: input.title,
    ratio: input.ratio,
    template,
    cover: input.cover,
    tracks: {
      images: input.scenes.map((scene, index) => ({ sceneId: scene.id, path: images[index], startMs: subtitles.cues[index].startMs, endMs: subtitles.cues[index].endMs })),
      narration: input.scenes.map((scene, index) => ({ sceneId: scene.id, path: audio[index], text: scene.cap })),
      subtitles: subtitles.cues,
      bgm: input.bgm,
    },
    imagePrompts: input.imagePrompts,
    createdAt: new Date().toISOString(),
  };

  const diagnostics: DiagnosticsReport = {
    generatedAt: new Date().toISOString(),
    checks: [
      { id: 'material-package', label: '素材包', status: 'pass', detail: `${images.length} 张图片，${audio.length} 条配音` },
      { id: 'subtitle-track', label: '字幕时间轴', status: subtitles.cues.length === input.scenes.length ? 'pass' : 'warn', detail: `${subtitles.cues.length} 条字幕` },
      { id: 'draft-package', label: '剪映草稿适配', status: 'warn', detail: '已生成内部草稿 JSON，剪映导入适配保留诊断信息。' },
    ],
  };

  await writeFile(join(packageDir, '00-reviewed.txt'), input.reviewedText, 'utf8');
  await writeFile(join(packageDir, '01-rewritten-copy.md'), input.rewrittenCopy, 'utf8');
  await writeFile(join(packageDir, '00-cover-title.json'), JSON.stringify(input.cover, null, 2), 'utf8');
  await writeFile(join(packageDir, '02-sentences.json'), JSON.stringify(input.scenes, null, 2), 'utf8');
  await writeFile(join(packageDir, '03-image-prompts.json'), JSON.stringify(input.imagePrompts, null, 2), 'utf8');
  await writeFile(join(packageDir, 'draft-project.json'), JSON.stringify(draftProject, null, 2), 'utf8');
  await writeFile(join(packageDir, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2), 'utf8');

  await writeFile(join(packageDir, 'sentences.json'), JSON.stringify(input.scenes, null, 2), 'utf8');
  await writeFile(join(packageDir, 'draft_content.json'), JSON.stringify(draftProject, null, 2), 'utf8');
  await writeFile(
    join(packageDir, 'draft_meta_info.json'),
    JSON.stringify(
      {
        app: 'storybound-replica',
        version: 2,
        title: input.title,
        cover: input.cover,
        durationMs: totalDuration,
        assetCount: { images: images.length, audio: audio.length, subtitles: 1 },
      },
      null,
      2,
    ),
    'utf8',
  );
  await writeFile(
    join(packageDir, 'README.txt'),
    [
      'Storybound Replica draft package',
      'This directory contains reviewed text, rewritten copy, storyboard sentences, image prompts, mock images, mock narration, subtitles, draft-project.json, and diagnostics.',
      'No private Storybound assets or code are included.',
    ].join('\n'),
    'utf8',
  );

  return {
    packageDir,
    assets: { images, audio, subtitles: subtitlesFile },
    diagnostics,
  };
}
