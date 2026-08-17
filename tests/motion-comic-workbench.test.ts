import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('motion comic workbench', () => {
  it('owns an independent route and history handoff', async () => {
    const [types, registry, routes, navigation, app] = await Promise.all([
      source('src/shared/types.ts'), source('src/app/route-registry.ts'), source('src/app/AppRoutes.tsx'),
      source('src/app/navigation.ts'), source('src/app/App.tsx'),
    ]);
    expect(types).toContain("'motion-comic'");
    expect(registry).toContain("'motion-comic': loadMotionComicPage");
    expect(routes).toContain("activeView === 'motion-comic'");
    expect(navigation).toContain("view: 'motion-comic', label: 'AI 漫剧'");
    expect(navigation).toContain("taskType === 'motion-comic'");
    expect(app).toContain("setRequestedMotionComicTaskId(targetView === 'motion-comic' ? taskId : '')");
  });

  it('uses project controls and does not expose paid generation', async () => {
    const [page, css] = await Promise.all([
      source('src/features/motion-comic/MotionComicPage.tsx'),
      source('src/styles/features/motion-comic.css'),
    ]);
    for (const component of ['Button', 'Pane', 'SelectField', 'TextAreaField', 'TextField', 'Toolbar']) expect(page).toContain(component);
    for (const rawControl of ['<button', '<input', '<select', '<textarea']) expect(page).not.toContain(rawControl);
    expect(page).toContain('data-motion-comic-workbench="true"');
    expect(page).toContain('api.createMotionComic');
    expect(page).toContain('api.saveMotionComic');
    expect(page).not.toMatch(/generate(?:Image|Video)|createAndRunTask|runTask/u);
    expect(css).toContain('grid-template-columns: minmax(210px, 250px) minmax(380px, 1fr) minmax(270px, 320px)');
    expect(css).toContain('.comic-timeline-track');
  });
});
