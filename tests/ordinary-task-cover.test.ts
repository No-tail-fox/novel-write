import { describe, expect, it } from 'vitest';
import {
  MAX_ORDINARY_TASK_COVER_BYTES,
  createOrdinaryTaskCoverAsset,
  ordinaryTaskCoverDimensions,
  validateOrdinaryTaskCoverInspection,
} from '../src/shared/ordinary-task-cover';

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
});
