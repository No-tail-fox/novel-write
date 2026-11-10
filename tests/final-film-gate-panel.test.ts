import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FinalFilmGatePanel } from '../src/features/final-film-gate/FinalFilmGatePanel';
import type { FinalFilmGateView } from '../src/shared/final-film-gate-view';

const base: FinalFilmGateView = { status: 'passed', route: 'html', film: 'final.mp4', checkedAt: '2026-11-10T10:00:00.000Z', stale: false, checks: [] };
const rows = {
  duration: { id: 'duration', status: 'pass', code: 'FINAL_GATE_DURATION', label: '时长', detail: '时长 10.000 秒，与时间轴一致。' },
  codec: { id: 'codec', status: 'pass', code: 'FINAL_GATE_CODEC', label: '编码', detail: 'H.264 High yuv420p。' },
  fps: { id: 'fps', status: 'warn', code: 'FINAL_GATE_FPS', label: '帧率', detail: '平均帧率 29.700 fps 与基准帧率 30.000 fps 不同，可能是可变帧率。' },
  loudness: { id: 'loudness', status: 'fail', code: 'FINAL_GATE_LOUDNESS', label: '响度', detail: '响度不达标：-20.0 LUFS（目标 −14±1 LUFS）。' },
  audio: { id: 'audio', status: 'fail', code: 'FINAL_GATE_AUDIO_MISSING', label: '音轨', detail: '项目有旁白/对白/音乐，但成片中没有音轨。' },
  tail: { id: 'frame-last', status: 'fail', code: 'FINAL_GATE_BLACK_FRAME', label: '尾帧黑帧', detail: '尾帧（9.967 秒）是黑帧。' },
  color: { id: 'color', status: 'skip', code: 'FINAL_GATE_COLOR', label: '色彩标签', detail: '没有视频流，跳过色彩标签检查。' },
} as const;

const render = (props: Parameters<typeof FinalFilmGatePanel>[0]) => renderToStaticMarkup(createElement(FinalFilmGatePanel, props));

describe('FinalFilmGatePanel (E-5 成片检查)', () => {
  it('renders 通过 with the advisory note and collapsed row details', () => {
    const html = render({ view: { ...base, checks: [rows.duration, rows.codec] }, loading: false });
    expect(html).toContain('aria-label="成片检查"');
    expect(html).toContain('data-final-film-gate-status="passed"');
    expect(html).toContain('通过');
    expect(html).toContain('仅供参考，不影响交付');
    expect(html).toContain('成片检查通过（2 项）');
    expect(html).toContain('时长 10.000 秒，与时间轴一致。');
    expect(html).not.toMatch(/<details[^>]* open/u);
  });

  it('renders 有提示 for warning rows and opens the details', () => {
    const html = render({ view: { ...base, status: 'warning', checks: [rows.duration, rows.fps] }, loading: false });
    expect(html).toContain('data-final-film-gate-status="warning"');
    expect(html).toContain('有提示');
    expect(html).toContain('可能是可变帧率');
    expect(html).toMatch(/<details[^>]* open/u);
  });

  it('renders 有问题 with failing rows first (loudness, audio missing, black frame)', () => {
    const html = render({ view: { ...base, status: 'failed', checks: [rows.duration, rows.color, rows.loudness, rows.audio, rows.tail] }, loading: false });
    expect(html).toContain('data-final-film-gate-status="failed"');
    expect(html).toContain('有问题');
    expect(html).toContain('成片检查3 项有问题');
    expect(html.indexOf('响度不达标')).toBeLessThan(html.indexOf('时长 10.000'));
    expect(html.indexOf('时长 10.000')).toBeLessThan(html.indexOf('跳过色彩标签'));
    expect(html).toContain('尾帧黑帧');
    expect(html).toContain('仅供参考，不影响交付');
  });

  it('renders 检查出错 for an error report and for a failed IPC read', () => {
    const html = render({ view: { ...base, status: 'error', error: { code: 'FINAL_GATE_FFMPEG_MISSING', message: '没有找到随应用打包的 ffmpeg，这次没能检查成片。' } }, loading: false });
    expect(html).toContain('data-final-film-gate-status="error"');
    expect(html).toContain('检查出错');
    expect(html).toContain('没有找到随应用打包的 ffmpeg');
    const readFailed = render({ view: null, loading: false, error: 'Task not found: x' });
    expect(readFailed).toContain('检查出错');
    expect(readFailed).toContain('读取检查结果失败：Task not found: x');
  });

  it('marks a stale report and renders nothing when there is no report or it is still loading', () => {
    expect(render({ view: { ...base, stale: true, checks: [rows.duration] }, loading: false })).toContain('成片在检查之后有改动');
    expect(render({ view: null, loading: false })).toBe('');
    expect(render({ view: null, loading: true })).toBe('');
  });

  it('review variant (审片报告) lists only rows needing attention', () => {
    const html = render({ view: { ...base, status: 'failed', checks: [rows.duration, rows.fps, rows.loudness] }, loading: false, variant: 'review' });
    expect(html).toContain('final-film-gate--review');
    expect(html).toContain('响度不达标');
    expect(html).toContain('可能是可变帧率');
    expect(html).not.toContain('时长 10.000 秒');
    expect(html).not.toContain('<details');
    expect(render({ view: { ...base, checks: [rows.duration] }, loading: false, variant: 'review' })).not.toContain('<ul');
  });

  it('is wired into the HTML 出片 tab, the director 导出 preview and the 审片质量报告', async () => {
    const [tab, desk, editorial, comic] = await Promise.all([
      '../src/features/html-video/HtmlVideoTabPanel.tsx', '../src/features/director-desk/DirectorDeskWorkspace.tsx',
      '../src/features/editorial-collage/EditorialCollagePage.tsx', '../src/features/motion-comic/MotionComicPage.tsx',
    ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
    expect(tab).toContain('<TaskFinalFilmGatePanel api={api} taskId={task.id}');
    expect(desk).toContain('{showingRenderedVideo && finalFilmGate ? <FinalFilmGatePanel {...finalFilmGate} /> : null}');
    const review = desk.slice(desk.indexOf('aria-label="审片质量报告"'));
    expect(review.slice(0, 2000)).toContain('<FinalFilmGatePanel {...finalFilmGate} variant="review" />');
    for (const page of [editorial, comic]) {
      expect(page).toContain('useFinalFilmGate(api, activeProjectId');
      expect(page).toContain('finalFilmGate={finalFilmGate}');
    }
    expect(comic).toContain('episodeId: activeEpisode.id');
  });
});
