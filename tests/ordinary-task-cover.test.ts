import { describe, expect, it } from 'vitest';
import {
  MAX_ORDINARY_TASK_COVER_BYTES,
  MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH,
  createOrdinaryTaskCoverAsset,
  normalizeOrdinaryTaskCoverPageText,
  ordinaryTaskCoverDimensions,
  resolveOrdinaryTaskCoverTitle,
  validateOrdinaryTaskCoverInspection,
} from '../src/shared/ordinary-task-cover';
import { getTemplate } from '../src/shared/templates';

describe('ordinary task manual cover contract', () => {
  it('requires a supported decodable image with bounded dimensions, ratio, and bytes', () => {
    const valid = {
      sourcePath: 'C:/selected/cover.png',
      exists: true,
      isFile: true,
      sizeBytes: 1024,
      width: 720,
      height: 1280,
      mimeType: 'image/png',
    };
    expect(validateOrdinaryTaskCoverInspection(valid, '9:16')).toMatchObject(valid);
    expect(() => validateOrdinaryTaskCoverInspection({ ...valid, sizeBytes: MAX_ORDINARY_TASK_COVER_BYTES + 1 }, '9:16')).toThrow(/size/i);
    expect(() => validateOrdinaryTaskCoverInspection({ ...valid, width: 721 }, '9:16')).toThrow(/dimensions/i);
    expect(() => validateOrdinaryTaskCoverInspection({ ...valid, mimeType: 'image/svg+xml' }, '9:16')).toThrow(/type/i);
    expect(ordinaryTaskCoverDimensions('4:3')).toEqual({ width: 1024, height: 768 });
  });

  it('accepts only versioned task-managed PNG assets', () => {
    const asset = createOrdinaryTaskCoverAsset({
      path: 'covers/cover-manual.png',
      originalName: 'cover.jpg',
      sizeBytes: 2048,
      width: 720,
      height: 1280,
      mimeType: 'image/png',
      sha256: 'a'.repeat(64),
      ratio: '9:16',
      createdAt: '2026-07-23T00:00:00.000Z',
    });
    expect(asset).toMatchObject({ version: 1, mode: 'manual', path: 'covers/cover-manual.png' });
    expect(() => createOrdinaryTaskCoverAsset({ ...asset, path: 'C:/outside.png' })).toThrow(/task-managed/i);
  });

  it('normalizes bounded optional cover-page text', () => {
    expect(normalizeOrdinaryTaskCoverPageText('  第一行\r\n第二行  ')).toBe('第一行\n第二行');
    expect(normalizeOrdinaryTaskCoverPageText(undefined)).toBe('');
    expect(() => normalizeOrdinaryTaskCoverPageText('字'.repeat(MAX_ORDINARY_TASK_COVER_PAGE_TEXT_LENGTH + 1))).toThrow(/TOO_LONG/);
  });

  it('keeps cover-only text in a ratio-aware safe area and shrinks long copy', () => {
    const portrait = getTemplate('builtin-portrait-4-3');
    const landscape = getTemplate('builtin-landscape-16-9');
    const shortTitle = resolveOrdinaryTaskCoverTitle(portrait, '丝路文明，从长安启程');
    const longTitle = resolveOrdinaryTaskCoverTitle(portrait, '封面长文案'.repeat(10));
    const landscapeTitle = resolveOrdinaryTaskCoverTitle(landscape, '横屏封面标题');

    expect(shortTitle).toMatchObject({ visible: true, x: 0, y: 0.2, width: 0.88 });
    expect(shortTitle.fontSize).toBeLessThanOrEqual(26);
    expect(longTitle.fontSize).toBeLessThan(shortTitle.fontSize);
    expect(landscapeTitle).toMatchObject({ x: 0, y: 0.18, width: 0.78 });
    expect(landscapeTitle.fontSize).toBeLessThan(shortTitle.fontSize);
    expect(resolveOrdinaryTaskCoverTitle(portrait, '').visible).toBe(false);
  });
});
