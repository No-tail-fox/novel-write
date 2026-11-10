import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FINAL_FILM_GATE_KIND, FINAL_FILM_GATE_REPORT_FILE } from '../src/shared/final-film-gate';
import { FINAL_FILM_GATE_REPORT_MAX_BYTES, finalFilmGateSummaryText, finalFilmGateViewFromReport } from '../src/shared/final-film-gate-view';
import { finalFilmPathForTask, readFinalFilmGateForFilm, readTaskFinalFilmGate } from '../electron/final-film-gate-reader';
import { createEditorialCollageDraft, createEditorialCollageStarterPlan } from '../src/shared/editorial-collage';
import { directorDocumentRenderFingerprint } from '../src/shared/director-render';
import { createHtmlVideoPipelineData } from '../src/shared/html-video-workflow';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { INVOKE_CHANNELS } from '../src/shared/storydream-api';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'final-film-gate-reader-'));
  roots.push(root);
  return root;
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    kind: FINAL_FILM_GATE_KIND, version: 1, route: 'html', film: 'final.mp4', checkedAt: new Date(Date.now() + 60_000).toISOString(),
    status: 'warning', passed: true, blocking: false,
    checks: [
      { id: 'duration', status: 'pass', code: 'FINAL_GATE_DURATION', detail: '时长 10.000 秒，与时间轴一致。' },
      { id: 'loudness', status: 'warn', code: 'FINAL_GATE_LOUDNESS', detail: '无法测量响度（目标 −14±1 LUFS，真峰值 ≤ −1 dBTP）。' },
      { id: 'frame-first', status: 'pass', code: 'FINAL_GATE_BLACK_FRAME', detail: '首帧（0.000 秒）平均亮度 80.0，不是黑帧。' },
    ],
    measurements: { probeSource: 'ffprobe', probe: null, loudness: null, frames: [] },
    ...overrides,
  };
}

async function filmWithReport(workDir: string, content: string | null, film = join(workDir, 'final.mp4')) {
  await mkdir(join(film, '..'), { recursive: true });
  await writeFile(film, 'mp4');
  if (content !== null) await writeFile(join(film, '..', FINAL_FILM_GATE_REPORT_FILE), content);
  return film;
}

describe('final film gate reader (E-5)', () => {
  it('loads a valid report next to the task film and labels every row in Chinese', async () => {
    const workDir = await tempRoot();
    const film = await filmWithReport(workDir, JSON.stringify(report()));
    const view = await readFinalFilmGateForFilm(workDir, film);
    expect(view).toMatchObject({ status: 'warning', route: 'html', film: 'final.mp4', stale: false });
    expect(view?.checks.map(check => [check.id, check.label, check.status])).toEqual([
      ['duration', '时长', 'pass'], ['loudness', '响度', 'warn'], ['frame-first', '首帧黑帧', 'pass'],
    ]);
    expect(view).not.toHaveProperty('measurements');
    // Relative film paths resolve against the managed work directory.
    expect(await readFinalFilmGateForFilm(workDir, 'final.mp4')).toMatchObject({ status: 'warning' });
  });

  it('returns null when the film has no report', async () => {
    const workDir = await tempRoot();
    const film = await filmWithReport(workDir, null);
    expect(await readFinalFilmGateForFilm(workDir, film)).toBeNull();
    expect(await readFinalFilmGateForFilm(workDir, join(workDir, 'missing-dir', 'final.mp4'))).toBeNull();
  });

  it('turns corrupt, oversized, mismatched and wrong-shape reports into an error view instead of throwing', async () => {
    const workDir = await tempRoot();
    const film = await filmWithReport(workDir, '{ not json');
    expect(await readFinalFilmGateForFilm(workDir, film)).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_REPORT_INVALID' }, checks: [] });
    await writeFile(join(workDir, FINAL_FILM_GATE_REPORT_FILE), JSON.stringify(report({ kind: 'something-else' })));
    expect(await readFinalFilmGateForFilm(workDir, film)).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_REPORT_INVALID' } });
    await writeFile(join(workDir, FINAL_FILM_GATE_REPORT_FILE), JSON.stringify(report({ film: 'other.mp4' })));
    expect(await readFinalFilmGateForFilm(workDir, film)).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_REPORT_MISMATCH' } });
    await writeFile(join(workDir, FINAL_FILM_GATE_REPORT_FILE), ' '.repeat(FINAL_FILM_GATE_REPORT_MAX_BYTES + 1));
    expect(await readFinalFilmGateForFilm(workDir, film)).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_REPORT_INVALID' } });
    await rm(join(workDir, FINAL_FILM_GATE_REPORT_FILE));
    await mkdir(join(workDir, FINAL_FILM_GATE_REPORT_FILE));
    expect(await readFinalFilmGateForFilm(workDir, film)).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_REPORT_UNREADABLE' } });
  });

  it('maps a runner error report (e.g. ffmpeg missing) to 检查出错 with fixed wording', async () => {
    const workDir = await tempRoot();
    const film = await filmWithReport(workDir, JSON.stringify(report({ status: 'error', passed: false, checks: [], error: { code: 'FINAL_GATE_FFMPEG_MISSING', message: 'raw' } })));
    const view = await readFinalFilmGateForFilm(workDir, film);
    expect(view).toMatchObject({ status: 'error', error: { code: 'FINAL_GATE_FFMPEG_MISSING', message: '没有找到随应用打包的 ffmpeg，这次没能检查成片。' } });
  });

  it('never reads a report outside the managed work directory (foreign film path, .. escape, linked directory)', async () => {
    const workDir = await tempRoot();
    const foreign = await tempRoot();
    const foreignFilm = await filmWithReport(foreign, JSON.stringify(report()));
    expect(await readFinalFilmGateForFilm(workDir, foreignFilm)).toBeNull();
    expect(await readFinalFilmGateForFilm(workDir, join(workDir, '..', foreign.split(/[\\/]/u).at(-1)!, 'final.mp4'))).toBeNull();
    expect(await readFinalFilmGateForFilm(workDir, workDir)).toBeNull();
    let linked = false;
    try { await symlink(foreign, join(workDir, 'linked'), 'junction'); linked = true; } catch { /* no junction support: skip */ }
    if (linked) expect(await readFinalFilmGateForFilm(workDir, join(workDir, 'linked', 'final.mp4'))).toBeNull();
  });

  it('flags a report older than the film as stale', async () => {
    const workDir = await tempRoot();
    const film = await filmWithReport(workDir, JSON.stringify(report({ checkedAt: '2020-01-01T00:00:00.000Z' })));
    await utimes(film, new Date(), new Date());
    expect(await readFinalFilmGateForFilm(workDir, film)).toMatchObject({ stale: true });
  });

  it('derives the overall status from rows so a hand-edited status cannot hide a failing row', () => {
    const view = finalFilmGateViewFromReport(report({ status: 'passed', checks: [{ id: 'codec', status: 'fail', code: 'FINAL_GATE_CODEC', detail: '像素格式 yuv444p。' }] }));
    expect(view.status).toBe('failed');
    expect(finalFilmGateSummaryText(view)).toBe('成片检查1 项有问题');
    expect(finalFilmGateViewFromReport(report({ status: 'passed', checks: [report().checks[0]] })).status).toBe('passed');
  });

  it('takes the film path only from the task record (HTML output, director final video); other tasks have no gate', async () => {
    const workDir = await tempRoot();
    await filmWithReport(workDir, JSON.stringify(report()));
    const htmlState = { ...createHtmlVideoPipelineData('', {}), output: { path: join(workDir, 'final.mp4'), sizeBytes: 3, durationSec: 1 } };
    const html = { id: 'html-1', taskType: 'html-video', pipelineData: JSON.stringify(htmlState) } as const;
    expect(finalFilmPathForTask(html)).toBe(join(workDir, 'final.mp4'));
    expect(await readTaskFinalFilmGate({ task: html, workDir })).toMatchObject({ status: 'warning' });
    expect(await readTaskFinalFilmGate({ task: html, workDir: await tempRoot() })).toBeNull();
    expect(finalFilmPathForTask({ id: 'plain', taskType: 'standard', pipelineData: '' } as never)).toBeNull();
    expect(finalFilmPathForTask({ id: 'broken', taskType: 'editorial-collage', pipelineData: '{broken' })).toBeNull();

    const now = '2026-09-09T00:00:00.000Z';
    const document = createEditorialCollageStarterPlan(createEditorialCollageDraft({ id: 'project', title: 'Test', now }), 'A story.', now);
    const filmPath = join(workDir, 'director-renders', 'r1', 'exports', 'director-1.mp4');
    document.assets.push({ id: 'director-export-r1', assetId: 'director-final-video', kind: 'video', localPath: filmPath, sha256: 'a'.repeat(64),
      provider: 'local', model: 'ffmpeg', createdAt: now, selected: true, pinned: true,
      renderFingerprint: directorDocumentRenderFingerprint(document) } as never);
    const director = { id: 'project', taskType: 'editorial-collage', pipelineData: JSON.stringify(document) } as const;
    expect(finalFilmPathForTask(director)).toBe(filmPath);
    await filmWithReport(workDir, JSON.stringify(report({ route: 'template', film: 'director-1.mp4', status: 'passed', checks: [report().checks[0]] })), filmPath);
    expect(await readTaskFinalFilmGate({ task: director, workDir })).toMatchObject({ status: 'passed', route: 'template', film: 'director-1.mp4' });
  });

  it('registers task:final-film-gate as an id-only read channel with no renderer path argument', async () => {
    expect(INVOKE_CHANNELS).toContain('task:final-film-gate');
    const schema = ipcInputSchemas['task:final-film-gate'];
    expect(schema.safeParse({ id: 'task-1' }).success).toBe(true);
    expect(schema.safeParse({ id: 'task-1', episodeId: 'ep-1' }).success).toBe(true);
    expect(schema.safeParse({ id: 'task-1', path: 'C:/evil/quality-gate.json' }).success).toBe(false);
    expect(schema.safeParse({ id: '' }).success).toBe(false);
    expect(schema.safeParse('task-1').success).toBe(false);
    const [preload, main, fallback, api] = await Promise.all(['../electron/preload.ts', '../electron/main.ts', '../src/app/browser-fallback.ts', '../src/shared/storydream-api.ts']
      .map(path => readFile(new URL(path, import.meta.url), 'utf8')));
    expect(preload).toContain("getFinalFilmGate: (input) => invokeTrusted('task:final-film-gate', input)");
    expect(main).toContain("trustedHandle('task:final-film-gate'");
    expect(main).toContain('readTaskFinalFilmGate({ task, workDir');
    expect(fallback).toContain('async getFinalFilmGate()');
    expect(api).toContain('getFinalFilmGate: (input: { id: string; episodeId?: string })');
  });
});
