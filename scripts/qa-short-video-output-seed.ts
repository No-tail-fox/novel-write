import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';

const profile = resolve(process.argv[2]);
const report = JSON.parse(await readFile(process.env.STORYDREAM_SHORT_VIDEO_QA_REPORT || '.artifacts/short-video-dual-output-smoke/report.json', 'utf8'));
if (report.status !== 'passed') throw new Error('Real render smoke must pass before UI seeding');
const result = report.results.find((item: { targets: string[] }) => item.targets.length === 2);
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
const projects = [];
try {
  for (const state of ['completed', 'partial', 'legacy'] as const) {
    const title = `短片双输出界面验收-${state}`;
    const task = await db.createTask({ title, taskType: 'story', inputText: '隔离工程验收，不调用生成接口。', ...(state !== 'legacy' ? { outputTargets: ['mp4', 'jianying-draft'] } : {}) });
    const workDir = join(profile, 'storydream', 'tasks', task.managedStorageKey!);
    await mkdir(workDir, { recursive: true });
    const mp4 = join(workDir, 'short-video.mp4'), draft = join(workDir, 'draft');
    await cp(result.outputs.mp4.path, mp4);
    await cp(result.outputs['jianying-draft'].path, draft, { recursive: true });
    await db.updateTask(task.id, { status: state === 'partial' ? 'paused' : 'completed', currentStep: 6, draftDir: draft, outputDir: draft,
      ...(state !== 'legacy' ? { deliverables: {
        mp4: state === 'partial' ? { status: 'failed', error: '隔离故障状态：编码失败，可重试', updatedAt: task.createdAt } : { status: 'completed', path: mp4, fingerprint: 'ui-fixture', updatedAt: task.createdAt },
        'jianying-draft': { status: 'completed', path: draft, fingerprint: 'ui-fixture', updatedAt: task.createdAt },
      } } : {}),
    });
    projects.push({ id: task.id, title, state });
  }
  await writeFile(join(profile, 'seed.json'), JSON.stringify({ projects }), 'utf8');
} finally { await db.close(); }
