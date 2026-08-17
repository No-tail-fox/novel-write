import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('editorial collage workbench', () => {
  it('owns a dedicated route and routes task history back into the VOX workspace', async () => {
    const [types, registry, routes, navigation, app] = await Promise.all([
      source('src/shared/types.ts'),
      source('src/app/route-registry.ts'),
      source('src/app/AppRoutes.tsx'),
      source('src/app/navigation.ts'),
      source('src/app/App.tsx'),
    ]);
    expect(types).toContain("'editorial-collage'");
    expect(registry).toContain("'editorial-collage': loadEditorialCollagePage");
    expect(routes).toContain("activeView === 'editorial-collage'");
    expect(navigation).toContain("view: 'editorial-collage', label: 'VOX 视觉导演'");
    expect(navigation).toContain("taskType === 'editorial-collage'");
    expect(app).toContain("setRequestedEditorialCollageTaskId(targetView === 'editorial-collage' ? taskId : '')");
  });

  it('uses project UI controls and keeps the deterministic preview separate from paid generation', async () => {
    const [page, css] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/styles/features/editorial-collage.css'),
    ]);
    for (const component of ['Button', 'Pane', 'SegmentedControl', 'SelectField', 'TextAreaField', 'TextField', 'Toolbar']) {
      expect(page).toContain(component);
    }
    for (const rawControl of ['<button', '<input', '<select', '<textarea']) {
      expect(page).not.toContain(rawControl);
    }
    expect(page).toContain('data-editorial-collage-workbench="true"');
    expect(page).toContain('data-layer-kind={layer.kind}');
    expect(page).toContain('api.createEditorialCollage');
    expect(page).toContain('api.saveEditorialCollage');
    expect(page).not.toMatch(/generate(?:Image|Video)|runTask|createAndRunTask/u);
    expect(css).toContain('grid-template-columns: minmax(190px, 230px) minmax(380px, 1fr) minmax(260px, 310px)');
    expect(css).toContain('.vox-timeline-track');
    expect(css).toContain(".vox-inspector-form .sd-segmented-control [role='tab']");
    expect(css).toContain('flex: 1 1 auto');
    expect(css).toContain('gap: 0');
    expect(css).toContain('white-space: nowrap');
  });
});
