import { describe, expect, it } from 'vitest';
import { projectCoverPath } from '../src/features/tasks/task-formatters';

describe('project cover resolution', () => {
  it('prefers the generated project cover', () => {
    expect(projectCoverPath({
      ordinaryCoverAsset: { path: 'covers/project-cover.png' } as never,
      referenceImagePath: 'references/first-frame.png',
    })).toBe('covers/project-cover.png');
  });

  it('uses an existing reference image when a project cover has not been generated', () => {
    expect(projectCoverPath({ ordinaryCoverAsset: null, referenceImagePath: 'references/first-frame.png' }))
      .toBe('references/first-frame.png');
  });

  it('returns an empty path when no usable image exists', () => {
    expect(projectCoverPath({ ordinaryCoverAsset: null, referenceImagePath: '  ' })).toBe('');
  });

  it('uses the resolved automatic cover and skips an unavailable manual cover', () => {
    expect(projectCoverPath({ projectCover: { path: 'C:/task/cover.png', revision: '1' }, referenceImagePath: 'reference.png' }))
      .toBe('C:/task/cover.png');
    expect(projectCoverPath({ projectCover: null, ordinaryCoverAsset: { path: 'covers/missing.png' } as never, referenceImagePath: 'reference.png' }))
      .toBe('reference.png');
  });
});
