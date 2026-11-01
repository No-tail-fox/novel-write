/** A conservative readability guard, not an aesthetic rating or a subject detector.
 * Input is a 320x180 RGBA/BGRA thumbnail. Smooth gradients do not count as
 * foreground detail; the bottom subtitle band and capture borders are excluded.
 * Spatial tiles prevent one tiny high-contrast object from proving a whole shot.
 */
export function nativeFrameDetailCoverage(bitmap: Uint8Array, width: number, height: number): number {
  if (width !== 320 || height !== 180 || bitmap.length !== width * height * 4) return 0;
  const cells = new Set<number>();
  for (let y = 4; y < 151; y++) for (let x = 4; x < 316; x++) {
    const offset = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) {
      if (Math.abs(bitmap[offset + c] - bitmap[offset + 4 + c]) >= 24
        || Math.abs(bitmap[offset + c] - bitmap[offset + width * 4 + c]) >= 24) {
        cells.add(Math.floor(y / 8) * 40 + Math.floor(x / 8)); break;
      }
    }
  }
  return cells.size / (40 * 19);
}

export interface NativeCompositionSample { atMs: number; coverage: number; }
export function nativeCompositionIssue(samples: readonly NativeCompositionSample[], durationMs: number): string | undefined {
  const reading = samples.filter(s => s.atMs >= durationMs * .24 && s.atMs <= durationMs * .76);
  const sparse = reading.length >= 3 && reading.every(s => s.coverage < .04);
  const tail = samples.filter(s => s.atMs >= durationMs * .89);
  const ending = tail.length >= 2 && tail.some(s => s.atMs >= durationMs * .99) && tail.every(s => s.coverage < .01);
  if (!sparse && !ending) return;
  const evidence = (sparse ? reading : tail).map(s => Math.round(s.atMs) + 'ms=' + (s.coverage * 100).toFixed(1) + '%').join(', ');
  return 'LEMO_COMPOSITION: 排除字幕、平滑背景和边缘后的画面细节占用过低（' + evidence + '）。'
    + (sparse ? '三个稳定阅读时刻均低于4%，主体可能过小或场景未完成。' : '收尾连续采样的细节占用低于1%，主体几乎不可读。')
    + '按创意方案检查主体大小与场景完整性，扩大主体或补全有叙事作用的环境，保留可读的收尾；保持原稿、字幕和时间线。不要通过添加噪点、边框、装饰文字或修改检测元数据来绕过检查。';
}

