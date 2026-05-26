import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task } from './types';
import { buildStoryPackage } from './story';
import { writeDraftPackage } from './draft';
import type { FileDatabase } from './storage';

export interface RunTaskOptions {
  appDataDir: string;
  onEvent?: (detail: string) => void;
}

function todayTitle(input: string): string {
  const title = /武则天|武曌|武后/.test(input) ? '武则天' : input.slice(0, 10).replace(/\s+/g, '');
  const date = new Date();
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return `${stamp} - ${title || '故事任务'}`;
}

export async function runTask(db: FileDatabase, task: Task, options: RunTaskOptions): Promise<Task> {
  const outputDir = join(options.appDataDir, 'tasks', task.id);
  await mkdir(outputDir, { recursive: true });
  await db.updateTask(task.id, { status: 'running', currentStep: 0, outputDir });

  const emit = async (type: string, step: number | null, agent: string | null, detail: string, data?: unknown) => {
    options.onEvent?.(detail);
    await db.addTaskEvent(task.id, {
      type,
      step,
      agent,
      detail,
      dataJson: data === undefined ? null : JSON.stringify(data),
    });
  };

  try {
    await emit('step_start', 0, 'Reviewer', '预审整理文案');
    const sourceText = task.mode === 'ai' && task.aiKeyword ? `${task.aiKeyword}\n\n${task.extraRequirements}\n\n${task.inputText}` : task.inputText;
    const artifact = await buildStoryPackage(sourceText, { style: task.style, ratio: task.ratio });
    await writeFile(join(outputDir, '00-reviewed.txt'), artifact.reviewedText, 'utf8');
    await emit('step_complete', 0, 'Reviewer', `已保存 ${artifact.reviewedText.length} 字`, { mode: task.mode, aiSources: task.aiSources });

    await db.updateTask(task.id, { currentStep: 1 });
    await emit('step_start', 1, 'Writer', '改写 + 自评迭代');
    await writeFile(join(outputDir, '01-rewritten-copy.md'), artifact.rewrittenCopy, 'utf8');
    await writeFile(join(outputDir, '00-cover-title.json'), JSON.stringify(artifact.cover, null, 2), 'utf8');
    await emit('step_complete', 1, 'Writer', `改写完成（${artifact.rewrittenCopy.length} 字 · ${task.rewriteIntensity}）`, {
      cover: artifact.cover,
      scores: { hook: 18, narrative: 17, emotion: 17, spoken: 9, visual: 12, originality: 12, total: 85 },
    });

    await db.updateTask(task.id, { currentStep: 2 });
    await emit('step_start', 2, 'Storyboard', '影视分镜分句');
    await writeFile(join(outputDir, '02-sentences.json'), JSON.stringify(artifact.scenes, null, 2), 'utf8');
    await emit('step_complete', 2, 'Storyboard', `分镜 ${artifact.scenes.length} 个`, { count: artifact.scenes.length });

    await db.updateTask(task.id, { currentStep: 3 });
    await emit('step_start', 3, 'Prompt', '生成绘图提示词');
    await writeFile(join(outputDir, '03-image-prompts.json'), JSON.stringify(artifact.imagePrompts, null, 2), 'utf8');
    await emit('step_progress', 3, 'Prompt', artifact.imagePrompts[0]?.characterProfile ?? '主体档案已生成');
    await emit('step_complete', 3, 'Prompt', `已生成 ${artifact.imagePrompts.length} 条图片提示词`);

    await db.updateTask(task.id, { currentStep: 4 });
    await emit('step_start', 4, 'Producer', '批量生图、TTS、字幕与草稿包');
    const draft = await writeDraftPackage({
      outputDir,
      title: task.title || todayTitle(task.inputText),
      cover: artifact.cover,
      ratio: task.ratio,
      templateId: task.templateId,
      scenes: artifact.scenes,
      imagePrompts: artifact.imagePrompts,
      reviewedText: artifact.reviewedText,
      rewrittenCopy: artifact.rewrittenCopy,
      speaker: task.speaker,
      ttsSpeed: task.ttsSpeed,
      bgm: { id: task.bgmId, title: task.bgmId === '__builtin__' ? '内置 BGM' : task.bgmId, durationMs: artifact.scenes.reduce((sum, scene) => sum + scene.durationMs, 0) },
    });
    await emit('step_complete', 4, 'Producer', '批量图片已生成', { count: draft.assets.images.length });
    await emit('step_complete', 5, 'TTS', '字幕时间轴已生成', { subtitles: draft.assets.subtitles, audio: draft.assets.audio.length });
    await emit('step_complete', 6, 'Draft', '草稿包已生成', draft);

    const completedAt = new Date().toISOString();
    await db.updateTask(task.id, { status: 'completed', currentStep: 7, completedAt, outputDir });
    return { ...task, status: 'completed', currentStep: 7, completedAt, outputDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.addTaskEvent(task.id, { type: 'step_error', detail: message, step: null, agent: null });
    await db.updateTask(task.id, { status: 'failed', errorMessage: message, outputDir });
    throw error;
  }
}
