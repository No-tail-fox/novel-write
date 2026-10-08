import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { toAppErrorPayload } from '../src/shared/app-error';
import type { ConfiguredJsonLlm } from '../src/shared/llm-provider';
import type { MotionComicPipelineData } from '../src/shared/motion-comic';
import { generateMotionComicPlan, generateMotionComicScript } from '../src/shared/motion-comic-planner';
import {
  motionComicPlanInputSchema, motionComicPlanRecoverySchema, motionComicScriptCheckpointSchema, motionComicScriptFailureSchema,
  type MotionComicPlanInput, type MotionComicPlanResponse, type MotionComicPlanRecovery, type MotionComicScriptFailure,
} from '../src/shared/motion-comic-planning';

const savedCheckpointSchema = z.object({
  version: z.literal(1), binding: z.string(), recovery: motionComicPlanRecoverySchema,
  checkpoint: motionComicScriptCheckpointSchema,
}).strict();
const savedScriptFailureSchema = z.object({
  version: z.literal(1), binding: z.string(), failure: motionComicScriptFailureSchema,
}).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** One atomic retained-script record per project; opaque tokens select validated checkpoints. */
export class MotionComicPlanningService {
  private readonly running = new Set<string>();
  constructor(private readonly directory: () => string) {}

  async plan(rawInput: MotionComicPlanInput, document: MotionComicPipelineData, llm: ConfiguredJsonLlm,
    options: { model: string; providerScope: string; protocol: string }): Promise<MotionComicPlanResponse> {
    const input = motionComicPlanInputSchema.parse(rawInput);
    if (this.running.has(input.id)) throw new Error('MOTION_COMIC_PLAN_BUSY: 当前项目正在规划，请等待完成。');
    this.running.add(input.id);
    try {
      return await this.run(input, document, llm, options);
    } finally { this.running.delete(input.id); }
  }

  private async run(input: MotionComicPlanInput, document: MotionComicPipelineData, llm: ConfiguredJsonLlm,
    options: { model: string; providerScope: string; protocol: string }): Promise<MotionComicPlanResponse> {
    const { resumeToken, restart, expectedUpdatedAt, scriptDraft, stage, scriptRevisionToken, ...request } = input;
    if ((resumeToken && (restart || scriptDraft)) || (restart && scriptDraft)) throw new Error('MOTION_COMIC_PLAN_RECOVERY_INVALID: 恢复、人工修正与重新规划不能同时提交。');
    if (scriptRevisionToken && !scriptDraft) throw new Error('MOTION_COMIC_PLAN_RECOVERY_INVALID: 剧本修订令牌必须与修改后的剧本一起提交。');
    if ((stage === 'storyboard' && !resumeToken) || (stage === 'script' && resumeToken)) throw new Error('MOTION_COMIC_PLAN_RECOVERY_INVALID: 分镜必须使用已审核剧本的版本令牌，剧本阶段不能提交恢复令牌。');
    if (input.id !== document.id || expectedUpdatedAt !== document.updatedAt) {
      throw new Error('MOTION_COMIC_STALE_WRITE: 项目已发生变化，请刷新后重新规划。');
    }
    // The timestamp alone can change on a no-op save. Bind every material project field instead.
    // scriptDraft is a stage payload, not source identity: retries send only the checkpoint token.
    const { updatedAt: _updatedAt, ...project } = document;
    const binding = hash(JSON.stringify({ request, project, ...options }));
    const path = join(this.directory(), `${hash(input.id)}.json`);
    if (restart) {
      await unlink(path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    }
    let saved: z.infer<typeof savedCheckpointSchema> | undefined;
    let savedFailure: z.infer<typeof savedScriptFailureSchema> | undefined;
    try {
      const rawSaved = JSON.parse(await readFile(path, 'utf8'));
      saved = savedCheckpointSchema.safeParse(rawSaved).success ? savedCheckpointSchema.parse(rawSaved) : undefined;
      savedFailure = savedScriptFailureSchema.safeParse(rawSaved).success ? savedScriptFailureSchema.parse(rawSaved) : undefined;
    } catch (error) {
      if (resumeToken) throw new Error('MOTION_COMIC_PLAN_RECOVERY_INVALID: 本地恢复记录不可用，请重新规划。');
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { saved = undefined; savedFailure = undefined; }
    }
    const savedIsCurrent = Boolean(saved && saved.binding === binding && saved.recovery.projectId === input.id
      && Date.now() - Date.parse(saved.recovery.createdAt) <= 7 * 24 * 60 * 60 * 1_000);
    const savedFailureIsCurrent = Boolean(savedFailure && savedFailure.binding === binding && savedFailure.failure.projectId === input.id
      && Date.now() - Date.parse(savedFailure.failure.createdAt) <= 7 * 24 * 60 * 60 * 1_000);
    if (scriptRevisionToken && !(
      (savedIsCurrent && saved?.recovery.token === scriptRevisionToken)
      || (savedFailureIsCurrent && savedFailure?.failure.token === scriptRevisionToken)
    )) throw new Error('MOTION_COMIC_PLAN_RECOVERY_INVALID: 剧本版本已变化或已过期，本次修改未覆盖新版本，请重新打开最新剧本。');
    if (resumeToken && (!savedIsCurrent || saved?.recovery.token !== resumeToken)) {
      throw new Error('MOTION_COMIC_PLAN_RECOVERY_INVALID: 项目、原文、创作要求或模型已变化，或记录已超过 7 天，请重新规划。');
    }
    if (!resumeToken && !scriptDraft && savedFailureIsCurrent && savedFailure) {
      return {
        status: 'script-invalid',
        error: toAppErrorPayload(new Error('MOTION_COMIC_PLAN_INVALID: 发现上次未通过校验的剧本草稿，可直接修正对白绑定。')),
        failure: savedFailure.failure,
      };
    }
    if (!resumeToken && !scriptDraft && savedIsCurrent && saved) {
      if (stage === 'script') return { status: 'script-ready', recovery: saved.recovery };
      return {
        status: 'storyboard-failed',
        error: toAppErrorPayload(new Error('MOTION_COMIC_PLAN_RECOVERY_AVAILABLE: 发现已保存的剧本，可继续生成分镜。')),
        recovery: saved.recovery,
      };
    }
    let recovery: MotionComicPlanRecovery | undefined;
    let scriptFailure: MotionComicScriptFailure | undefined;
    try {
      const generate = stage === 'script' ? generateMotionComicScript : generateMotionComicPlan;
      const result = await generate(input, document, llm, {
        model: options.model, resume: resumeToken ? saved?.checkpoint : undefined,
        // Keep the original normalization ledger when a human edits a retained draft.
        manualRepairBase: scriptDraft && savedFailureIsCurrent && savedFailure
          ? { script: savedFailure.failure.draft, adjustments: savedFailure.failure.adjustments }
          : scriptDraft && savedIsCurrent && saved ? saved.checkpoint : undefined,
        onScriptInvalid: async ({ script, issues, adjustments }) => {
          scriptFailure = {
            token: randomUUID(), projectId: input.id, sourceText: input.sourceText,
            instructions: input.instructions ?? '', targetDurationSec: input.targetDurationSec,
            draft: script, issues, adjustments, createdAt: new Date().toISOString(),
          };
          await mkdir(this.directory(), { recursive: true });
          const temporaryPath = `${path}.tmp`;
          await writeFile(temporaryPath, JSON.stringify({ version: 1, binding, failure: scriptFailure }), 'utf8');
          await rename(temporaryPath, path);
        },
        onScriptReady: async (checkpoint) => {
          const next: MotionComicPlanRecovery = resumeToken && saved ? saved.recovery : {
            token: randomUUID(), projectId: input.id, sourceText: input.sourceText,
            instructions: input.instructions ?? '', targetDurationSec: input.targetDurationSec,
            title: checkpoint.script.title, scenes: checkpoint.script.scenes.length,
            script: checkpoint.script, createdAt: new Date().toISOString(),
            phase: stage === 'script' ? 'script-review' : 'storyboard-failed', adjustments: checkpoint.adjustments,
          };
          await mkdir(this.directory(), { recursive: true });
          const temporaryPath = `${path}.tmp`;
          await writeFile(temporaryPath, JSON.stringify({ version: 1, binding, recovery: next, checkpoint }), 'utf8');
          await rename(temporaryPath, path);
          recovery = next;
        },
      });
      if (stage === 'script' && recovery) return { status: 'script-ready', recovery };
      // Keep the confirmed revision available for edits after storyboard preview.
      if (stage !== 'storyboard') await unlink(path).catch(() => undefined);
      if (!('plan' in result)) throw new Error('MOTION_COMIC_PLAN_INVALID: 缺少分镜规划结果。');
      return { status: 'complete', result };
    } catch (error) {
      if (scriptFailure) return { status: 'script-invalid', error: toAppErrorPayload(error), failure: scriptFailure };
      if (!recovery) throw error;
      return { status: 'storyboard-failed', error: toAppErrorPayload(error), recovery: { ...recovery, phase: 'storyboard-failed' } };
    }
  }
}
