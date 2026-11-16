import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { motionComicBackTarget } from '../src/features/motion-comic/motion-comic-navigation';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('motion comic navigation', () => {
  it('returns to the current episode script from scenes', () => {
    expect(motionComicBackTarget('scenes')).toEqual({ stage: 'episodes', label: '返回本集剧本' });
  });

  it('keeps storyboard back navigation at the script workspace', () => {
    expect(motionComicBackTarget('storyboard')).toEqual({ stage: 'episodes', label: '返回剧本' });
  });

  it('keeps scenes as a supported route while exposing the episodes parent entry', async () => {
    const [workspace, script] = await Promise.all([
      source('src/features/motion-comic/MotionComicProductionWorkspace.tsx'),
      source('src/features/motion-comic/MotionComicScriptWorkspace.tsx'),
    ]);
    expect(workspace).toContain("const activeStageId = stage === 'scenes' ? 'episodes' : stage === 'storyboard' ? 'video' : stage;");
    expect(workspace).toContain("item.id !== 'scenes'");
    expect(workspace).toContain("label: '分集拆解', shortLabel: '分集'");
    expect(workspace).not.toContain('编辑分幕与场次');
    expect(script).toContain('编辑分幕与场次');
    expect(script).not.toContain('查看分幕分场');
    expect(script).toContain('编辑本集分镜');
  });
});
