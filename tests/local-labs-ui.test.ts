import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const pageContracts = [
  ['book-selection', '../src/features/labs/BookSelectionPage.tsx'],
  ['benchmark', '../src/features/labs/BenchmarkImportPage.tsx'],
  ['person-assets', '../src/features/labs/PersonAssetsPage.tsx'],
  ['image-lab', '../src/features/labs/ImageLabPage.tsx'],
  ['voice-lab', '../src/features/labs/VoiceLabPage.tsx'],
] as const;

describe('local and lab editorial workbenches', () => {
  it.each(pageContracts)('gives %s a lazy-owned open workbench surface', async (id, path) => {
    const page = await readFile(new URL(path, import.meta.url), 'utf8');

    expect(page).toContain("import '../../styles/features/local-labs.css';");
    expect(page).toContain(`data-local-lab-workbench="${id}"`);
    expect(page).toContain('local-lab-workbench');
    expect(page).not.toContain('className="panel ');
  });

  it('uses one shared open-layout system with stable compact geometry', async () => {
    const css = await readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8');

    expect(css).toContain('[data-local-lab-workbench]');
    expect(css).toMatch(/\.selection-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(240px, 300px\) minmax\(0, 1fr\);/u);
    expect(css).toMatch(/\.benchmark-import-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(280px, 320px\) minmax\(0, 1fr\);/u);
    expect(css).toMatch(/\.person-assets-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(240px, 280px\) minmax\(0, 1fr\);/u);
    expect(css).toMatch(/\.voice-lab-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(360px, 0\.44fr\) minmax\(0, 1fr\);/u);
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
  });

  it('uses shell surfaces around media and reserves dark ownership for actual media', async () => {
    const [imageLab, voiceLab, personAssets, css] = await Promise.all([
      readFile(new URL('../src/features/labs/ImageLabPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/labs/VoiceLabPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/labs/PersonAssetsPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8'),
    ]);

    expect(imageLab).toContain('className="lab-image-preview" data-media-canvas="image-lab"');
    expect(voiceLab).toContain('data-media-canvas="voice-lab"');
    expect(personAssets).toContain('data-media-canvas="person-assets"');
    expect(imageLab).not.toContain('className="local-lab-media image-lab-recent" data-media-canvas');
    expect(voiceLab).not.toContain('className="local-lab-media voice-lab-history" data-media-canvas');
    expect(personAssets).not.toContain('className="person-image-grid" data-media-canvas');
    expect(css).toMatch(/\.local-lab-media\s*\{[\s\S]*background:\s*var\(--shell-surface\);[\s\S]*color:\s*var\(--shell-text\);/u);
    expect(css).toMatch(/\.person-image-grid\s*\{[\s\S]*min-height:\s*320px;[\s\S]*background:\s*var\(--shell-surface\);/u);
    expect(css).toMatch(/\.image-lab-reference-block\s*\{[\s\S]*background:\s*var\(--shell-surface\);[\s\S]*color:\s*var\(--shell-text\);/u);
  });

  it('uses proportional empty states without shrinking populated workspaces', async () => {
    const css = await readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8');

    expect(css).toContain('.person-assets-panel:has(.person-image-grid > .empty-state)');
    expect(css).toContain('.voice-lab-history:has(> .empty-state)');
    expect(css).toContain('.image-lab-recent:has(> .empty-state)');
    expect(css).toMatch(/\.person-image-grid\s*\{[\s\S]*?min-height:\s*320px;/u);
    expect(css).toMatch(/\.voice-lab-history\s*\{[\s\S]*?min-height:\s*calc\(100vh - 166px\);/u);
    expect(css).toMatch(/\.image-lab-recent\s*\{[\s\S]*?min-height:\s*calc\(100vh - 166px\);/u);
  });

  it('retains the complete local and lab command surface', async () => {
    const sources = await Promise.all(pageContracts.map(([, path]) => readFile(new URL(path, import.meta.url), 'utf8')));
    const joined = sources.join('\n');

    for (const command of [
      'saveBookSelection',
      'deleteBookSelection',
      'createAndRunTask',
      'createPersonAsset',
      'renamePersonAsset',
      'deletePersonAsset',
      'importPersonAssetImages',
      'openPersonAssetDirectory',
      'generateImageLab',
      'addImageLabRecord',
      'generateVoiceLabPreview',
    ]) {
      expect(joined).toContain(command);
    }
  });

  it('retains every visible local and lab parameter group', async () => {
    const [book, benchmark, person, image, voice] = await Promise.all(
      pageContracts.map(([, path]) => readFile(new URL(path, import.meta.url), 'utf8')),
    );

    for (const label of ['主题', '商品 / 书名', '作者', '分类', '关键词', '价格', '目标人群', '人物', '年代 / 场景', '链接', '核心卖点', '备注']) {
      expect(book).toContain(`label="${label}"`);
    }
    for (const label of ['来源链接', '账号 / 标题', '关键词', '素材来源', '对标文案']) expect(benchmark).toContain(label);
    for (const label of ['人物名称', '创建', '重命名', '删除', '打开目录', '导入图片']) expect(person).toContain(label);
    for (const label of ['模式', '参考图', '需求描述', '每组合数量', '多选比例', '多选风格', '分辨率', '导入成品', '智能生成']) expect(image).toContain(label);
    for (const label of ['试听文案', '配音模型', '音色', '语速', '生成试听', '历史试听']) expect(voice).toContain(label);
  });
});
