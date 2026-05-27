import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunTaskOptions } from './runner';
import type { AiSourceContext, AppConfig, Task } from './types';
import { createOpenAiCompatibleJsonLlm } from './llm-provider';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer } from './media-providers';
import { buildStoryPackage } from './story';

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwAAABQABDQottAAAAABJRU5ErkJggg==',
  'base64',
);

export function createTaskRuntimeProviders(config: AppConfig, workDir: string): Pick<RunTaskOptions, 'llm' | 'generatePipelineArtifact' | 'generateImages' | 'synthesizeNarration'> {
  const hasLlm = Boolean(config.llm.apiKey.trim() && config.llm.model.trim());
  return {
    llm: hasLlm ? createOpenAiCompatibleJsonLlm(config.llm) : undefined,
    generatePipelineArtifact: hasLlm ? undefined : (task, sourceContext) => buildLocalPipelineArtifact(task, sourceContext),
    generateImages: hasUsableImageProvider(config) ? createConfiguredImageGenerator(config, workDir) : createMockImageGenerator(workDir),
    synthesizeNarration: hasUsableTtsProvider(config) ? createConfiguredNarrationSynthesizer(config, workDir) : createMockNarrationSynthesizer(workDir),
  };
}

function hasUsableImageProvider(config: AppConfig): boolean {
  if (config.imageProvider === 'mock') return false;
  if (config.imageProvider === 'jimeng') return Boolean(config.jimeng.accessKeyId && config.jimeng.secretAccessKey && config.jimeng.reqKey);
  if (config.imageProvider === 'custom') return Boolean(config.customImage.baseUrl && config.customImage.apiKey && config.customImage.model);
  return Boolean((config.gptImage.apiKey || config.image.apiKey) && (config.gptImage.model || config.image.model));
}

function hasUsableTtsProvider(config: AppConfig): boolean {
  if (config.tts.provider === 'mock') return false;
  if (config.tts.provider === 'minimax') return Boolean(config.tts.minimax.apiKey && config.tts.minimax.model);
  return Boolean((config.tts.volcengine.appId || config.tts.appId) && (config.tts.volcengine.accessKey || config.tts.accessKey));
}

async function buildLocalPipelineArtifact(task: Task, sourceContext?: AiSourceContext) {
  const sourceText = [
    task.inputText,
    task.aiKeyword ? `AI 创作关键词：${task.aiKeyword}` : '',
    task.extraRequirements ? `额外要求：${task.extraRequirements}` : '',
    sourceContext?.sections.map((section) => `${section.title}\n${section.content}`).join('\n\n') ?? '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const artifact = await buildStoryPackage(sourceText || '人物在低谷中等待转折，最终重新站到命运中心。', {
    style: task.style,
    ratio: task.ratio,
  });
  return sourceContext ? { ...artifact, sourceContext } : artifact;
}

function createMockImageGenerator(workDir: string): NonNullable<RunTaskOptions['generateImages']> {
  return async (scenes) => {
    const outputDir = join(workDir, 'mock-images');
    await mkdir(outputDir, { recursive: true });
    return Promise.all(
      scenes.map(async (scene) => {
        const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.png`);
        await writeFile(path, tinyPng);
        return { sceneId: scene.id, path };
      }),
    );
  };
}

function createMockNarrationSynthesizer(workDir: string): NonNullable<RunTaskOptions['synthesizeNarration']> {
  return async (scenes) => {
    const outputDir = join(workDir, 'mock-audio');
    await mkdir(outputDir, { recursive: true });
    return Promise.all(
      scenes.map(async (scene) => {
        const path = join(outputDir, `${String(scene.id).padStart(3, '0')}.wav`);
        await writeFile(path, wavTone(scene.durationMs));
        return { sceneId: scene.id, path };
      }),
    );
  };
}

function wavTone(durationMs: number): Buffer {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 6000);
    buffer.writeInt16LE(value, 44 + i * 2);
  }
  return buffer;
}
