import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { FileDatabase } from '../src/shared/storage';
import { createHtmlVideoTaskInput } from '../src/shared/html-video-workflow';
import { createHtmlVideoCoverAsset } from '../src/shared/html-video-cover';
import { parseEditorialCollagePipelineData } from '../src/shared/editorial-collage';
import { parseMotionComicPipelineData } from '../src/shared/motion-comic';
import { resolveReferenceFfmpeg } from '../src/shared/viral-reference-media';
import { runBoundedProcess } from '../src/shared/process-runner';

const profile = resolve(process.argv[2]);
const db = await FileDatabase.open(join(profile, 'storydream', 'data.db'));
const fixture = join(profile, 'fixture.png');
const bytes = await readFile(fixture);
const digest = createHash('sha256').update(bytes).digest('hex');
const projects: { id: string; name: string; cover?: string }[] = [];
try {
  for (const name of ['自动封面', '生成后同步', '缺少封面']) {
    const task = await db.createTask({ title: name, inputText: '封面列表验收', coverImageMode: 'auto' });
    const workDir = join(profile, 'storydream', 'tasks', task.managedStorageKey!);
    await mkdir(join(workDir, 'pipeline'), { recursive: true });
    const cover = join(workDir, 'cover-image.png');
    const statePath = join(workDir, 'pipeline', 'state.json');
    await writeFile(statePath, JSON.stringify({ taskId: task.id, assets: { cover: [{ path: cover }] } }));
    if (name === '自动封面') await copyFile(fixture, cover);
    await db.updateTask(task.id, { status: 'completed', artifactStatePath: statePath });
    projects.push({ id: task.id, name, cover });
  }
  const manual = await db.createTaskWithOrdinaryCover({ title: '手动封面', inputText: '手动封面验收', ratio: '16:9' }, {
    sourcePath: fixture, sourceBytes: bytes, exists: true, isFile: true,
    sizeBytes: bytes.length, width: 1280, height: 720, mimeType: 'image/png', originalName: 'fixture.png',
  }, '16:9', {
    prepareImage: async ({ destinationPath }) => {
      await copyFile(fixture, destinationPath);
      return { sizeBytes: bytes.length, width: 1280, height: 720, mimeType: 'image/png', sha256: digest };
    },
    ensureDirectory: async path => { await mkdir(path, { recursive: true }); },
    promoteFile: rename, removeFile: async path => { await rm(path, { force: true }); },
    now: () => new Date().toISOString(),
  });
  await db.updateTask(manual.id, { status: 'draft' });
  projects.push({ id: manual.id, name: '手动封面' });
  const html = await db.createTask({ ...createHtmlVideoTaskInput({ copy: 'HTML 封面验证', coverImageMode: 'auto', coverRatio: '16:9' }), title: 'HTML 封面' });
  const htmlDir = join(profile, 'storydream', 'tasks', html.managedStorageKey!);
  await mkdir(join(htmlDir, 'covers'), { recursive: true });
  await copyFile(fixture, join(htmlDir, 'covers/cover-auto-r1.png'));
  const pipeline = JSON.parse(html.pipelineData!);
  pipeline.coverAsset = createHtmlVideoCoverAsset({ revision: 1, mode: 'auto', path: 'covers/cover-auto-r1.png',
    width: 1280, height: 720, sizeBytes: bytes.length, sha256: digest, mimeType: 'image/png', ratio: '16:9', createdAt: html.createdAt });
  await db.updateTask(html.id, { status: 'draft', pipelineData: JSON.stringify(pipeline) });
  projects.push({ id: html.id, name: 'HTML 封面' });
  for (const taskType of ['editorial-collage', 'motion-comic'] as const) {
    const name = taskType === 'editorial-collage' ? '创意动画首帧' : '漫剧分镜封面';
    const task = taskType === 'editorial-collage'
      ? await db.createEditorialCollageTask({ title: name, sourceText: '工作流自动封面验收。第二段正文。', ratio: '16:9', durationMs: 'auto' })
      : await db.createMotionComicTask({ title: name, premise: '工作流自动封面验收。', ratio: '16:9' });
    const workDir = join(profile, 'storydream', 'tasks', task.managedStorageKey!);
    await mkdir(workDir, { recursive: true });
    const image = join(workDir, 'first.png');
    await copyFile(fixture, image);
    if (taskType === 'editorial-collage') {
      const document = parseEditorialCollagePipelineData(task.pipelineData);
      document.assets.push({ id: 'first', assetId: 'qa-first', kind: 'image', localPath: image, createdAt: task.createdAt });
      document.beats[0].shots[0].keyframeAssetVersionId = 'first';
      const video = join(workDir, 'final.mp4');
      const ffmpeg = await resolveReferenceFfmpeg();
      const result = await runBoundedProcess(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=coral:s=320x180:d=0.2', '-threads', '1', '-pix_fmt', 'yuv420p', video],
        { cwd: workDir, timeoutMs: 20_000, maxStdoutBytes: 4096, maxStderrBytes: 16_384 });
      if (result.code !== 0) throw new Error(result.stderr);
      document.assets.push({ id: 'final', kind: 'video', assetId: 'director-final-video', localPath: video, selected: true, createdAt: task.createdAt });
      await db.saveEditorialCollageTask({ id: task.id, document, expectedUpdatedAt: document.updatedAt });
    } else {
      const document = parseMotionComicPipelineData(task.pipelineData);
      document.assets.push({ id: 'first', assetId: 'qa-first', kind: 'image', localPath: image, createdAt: task.createdAt });
      document.episodes[0].scenes[0].shots[0].firstFrameAssetVersionId = 'first';
      await db.saveMotionComicTask({ id: task.id, document, expectedUpdatedAt: document.updatedAt });
    }
    projects.push({ id: task.id, name });
  }
  await db.upsertUiPreferences({ activeView: 'projects' });
  await db.upsertUiPreferences({ theme: 'dark' });
  await writeFile(join(profile, 'covers.json'), JSON.stringify(projects), 'utf8');
} finally { await db.close(); }
