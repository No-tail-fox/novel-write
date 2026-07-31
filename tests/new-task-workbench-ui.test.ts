import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('three-stage new task workbench', () => {
  it('owns three persistent stages and the computed execution summary', async () => {
    const page = await readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8');

    expect(page).toContain("import '../../styles/features/new-task.css';");
    expect(page).toContain("type NewTaskStage = 'material' | 'creative' | 'output';");
    expect(page).toContain("const [activeStage, setActiveStage] = useState<NewTaskStage>('material');");
    expect(page).toContain('data-new-task-workbench');
    expect(page).toContain('data-new-task-stage={activeStage}');
    expect(page).toContain("{ id: 'material', label: '素材输入'");
    expect(page).toContain("{ id: 'creative', label: '创作参数'");
    expect(page).toContain("{ id: 'output', label: '输出设置'");
    expect(page).toContain('data-new-task-stage-tab={stage.id}');
    expect(page).toContain('data-new-task-summary');
    expect(page).toContain('处理模式');
    expect(page).toContain('目标长度');
    expect(page).toContain('分镜数量');
    expect(page).toContain('画面比例');
    expect(page).toContain('配音角色');
    expect(page).toContain('草稿模板');
  });

  it('keeps the accepted open desktop geometry and compact summary stacking', async () => {
    const css = await readFile(new URL('../src/styles/features/new-task.css', import.meta.url), 'utf8');

    expect(css).toMatch(/\.new-task-workbench\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) 300px/u);
    expect(css).toMatch(/\.new-task-stage-panel\s*\{[\s\S]*min-width:\s*0/u);
    expect(css).toMatch(/@media \(max-width:\s*1180px\)[\s\S]*\.new-task-workbench\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
    expect(css).toMatch(/@media \(max-width:\s*1180px\)[\s\S]*\.new-task-summary\s*\{[\s\S]*order:\s*2/u);
    expect(css).toMatch(/\.new-task-summary\s*\{[\s\S]*background:\s*var\(--shell-surface\)/u);
    expect(css).toMatch(/\.new-task-editor \.ghost-action,[\s\S]*background:\s*var\(--shell-surface-raised\)/u);
    expect(css).toMatch(/\.new-task-stage-panel \.new-task-track-options \.option-cloud\s*\{[\s\S]*repeat\(3,/u);
    expect(css).not.toContain('var(--shell-surface-muted)');
    expect(css).not.toMatch(/font-size:\s*clamp\(/u);
    expect(css).toContain('.new-task-summary-actions > .primary-action:disabled');
    expect(css).toContain('background: var(--shell-border);');
    expect(css).toContain('cursor: not-allowed;');
  });

  it('offers ordinary manual cover import without exposing a path input', async () => {
    const [page, draft, api] = await Promise.all([
      readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/tasks/new-task-draft.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
    ]);

    expect(page).toContain('api.importOrdinaryTaskCover(');
    expect(page).toContain('导入手动封面');
    expect(page).toContain('manualCoverAssetId: manualCoverAsset?.id');
    expect(page).toContain("coverImageMode === 'manual' && !manualCoverAsset");
    expect(page).not.toContain('manualCoverPath');
    expect(draft).toContain('manualCoverAsset?: OrdinaryTaskCoverSelection');
    expect(api).toContain('importOrdinaryTaskCover: (ratio: OrdinaryTaskCoverRatio)');
  });

  it('reuses the complete task snapshot for named creation presets', async () => {
    const [page, draft, css] = await Promise.all([
      readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/tasks/new-task-draft.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/new-task.css', import.meta.url), 'utf8'),
    ]);

    expect(draft).toContain("NEW_TASK_PRESET_STORAGE_KEY = 'storydream.new-task-presets.v1'");
    expect(draft).toContain('createNewTaskPreset');
    expect(draft).toContain('manualCoverAsset: undefined');
    expect(page).toContain('saveTaskPreset');
    expect(page).toContain('applyTaskPreset');
    expect(page).toContain('deleteTaskPreset');
    expect(page).toContain('保存为预设');
    expect(page).toContain('应用预设');
    expect(page).toContain('删除预设');
    expect(page).toContain('selectTaskPreset(event.target.value)');
    expect(css).toMatch(/\.new-task-preset-panel \.icon-button\s*\{[\s\S]*background:\s*var\(--shell-surface-raised\);[\s\S]*color:\s*var\(--shell-muted\);/u);
  });

  it('renders every image ratio through one numerically faithful stable swatch', async () => {
    const [component, newTask, musicMv, imageLab, css] = await Promise.all([
      readFile(new URL('../src/components/AspectRatioSwatch.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/tasks/NewTaskPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/music-mv/MusicMvPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/labs/ImageLabPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/components.css', import.meta.url), 'utf8'),
    ]);

    expect(component).toContain("const [width, height] = ratio.split(':').map(Number)");
    expect(component).toContain("'--aspect-ratio-value': normalizedWidth / normalizedHeight");
    expect(component).toContain('className="aspect-ratio-swatch"');
    expect(component).toContain('className="aspect-ratio-swatch-shape"');
    expect(newTask).toContain('<AspectRatioSwatch ratio={item} />');
    expect(musicMv).toContain('<AspectRatioSwatch ratio={item} />');
    expect(imageLab).toContain('<AspectRatioSwatch ratio={value} />');
    expect(css).toMatch(/\.aspect-ratio-swatch\s*\{[\s\S]*width:\s*26px;[\s\S]*height:\s*24px;/u);
    expect(css).toMatch(/\.aspect-ratio-swatch-shape\s*\{[\s\S]*width:\s*min\(24px, calc\(22px \* var\(--aspect-ratio-value\)\)\);[\s\S]*aspect-ratio:\s*var\(--aspect-ratio-value\);/u);
  });
});
