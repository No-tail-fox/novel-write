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
    expect(css).toMatch(/\.selection-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 390px\);/u);
    expect(css).toMatch(/\.benchmark-import-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(220px, 260px\) minmax\(0, 1fr\) minmax\(280px, 320px\);/u);
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
      'saveBenchmarkGroup',
      'saveBenchmarkPost',
      'deleteBookSelection',
      'deleteBenchmarkGroup',
      'deleteBenchmarkPost',
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

  it('implements real account synchronization and the benchmark-to-selection decision workflow', async () => {
    const [benchmark, selection, viral, css] = await Promise.all([
      readFile(new URL('../src/features/labs/BenchmarkImportPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/labs/BookSelectionPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/viral/ViralAnalyzerPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8'),
    ]);

    for (const contract of [
      'selectedGroupId',
      'selectedPostIds',
      '抖音账号主页链接',
      '视频号账号主页 / 分享入口',
      'B 站 UP 主空间链接',
      'api.syncBenchmarkGroup(group.id)',
      'api.openBenchmarkLogin',
      'loginResult.cookieCount',
      '登录/验证',
      'benchmark-account-error',
      '同步账号',
      '加入选品候选',
    ]) expect(benchmark).toContain(contract);
    expect(benchmark).not.toContain('账号自动同步连接器待接入');

    for (const contract of [
      '候选池',
      '对比台',
      '创作简报',
      'benchmarkOpportunityTotal',
      'selectionStatus',
      'opportunityScore',
      'evidence',
      'riskNote',
      'creativeBrief',
      'benchmark_focus_post',
      'comparisonSelectionIds',
    ]) expect(selection).toContain(contract);

    expect(viral).toContain("sessionStorage.getItem('benchmark_viral_url')");
    expect(viral).toContain("sessionStorage.removeItem('benchmark_viral_url')");
    expect(viral).toContain("sessionStorage.removeItem('benchmark_viral_platform')");
    expect(css).toContain('.benchmark-inspector');
    expect(css).toContain('.selection-candidate-table');
    expect(css).toContain('.selection-score-row');
    expect(css).toContain('.selection-evidence-list');
  });

  it('implements a StoryBound-inspired Dangdang ranking, search, filter, favorite, and creation workflow', async () => {
    const [selection, css] = await Promise.all([
      readFile(new URL('../src/features/labs/BookSelectionPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8'),
    ]);

    for (const contract of [
      'discoverBooks',
      '生成榜单',
      '快捷赛道',
      '当当搜索榜',
      '全部分类',
      '全部潜力',
      '只看收藏',
      '去创作',
      '智能建议',
      '真实公开数据',
      '预览数据',
      'initialDiscoveryPending',
      'data-source-state',
      "sessionStorage.setItem('book_product_track'",
    ]) expect(selection).toContain(contract);
    expect(selection).toContain('const discoveryBusy = initialDiscoveryPending || discoveryAction.busy');
    expect(selection).toMatch(/async function toggleFavorite[\s\S]*?await persistRecord\(record,[\s\S]*?setRecords\(await api\.listBookSelections\(\)\);[\s\S]*?setMessage\(favorite/u);
    expect(selection).toContain("from '../../ui'");
    expect(css).toContain('.selection-discovery-header');
    expect(css).toContain('.selection-ranking-table');
    expect(css).toContain('.selection-book-cover');
    expect(css).toContain('.selection-track-rail');
  });

  it('shows benchmark covers in the list and synchronized inspector with a stable fallback', async () => {
    const [benchmark, css] = await Promise.all([
      readFile(new URL('../src/features/labs/BenchmarkImportPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8'),
    ]);

    expect(benchmark).toContain('coverUrl: postDraft.coverUrl.trim() || undefined');
    expect(benchmark).toContain('label="封面图链接"');
    expect(benchmark).toContain('<BenchmarkCover coverUrl={post.coverUrl} platform={post.platform} />');
    expect(benchmark).toContain('coverUrl={selectedPost.coverUrl}');
    expect(benchmark).toContain('variant="detail"');
    expect(benchmark).toContain("data-cover-state={hasImage ? 'ready' : 'fallback'}");
    expect(css).toMatch(/\.benchmark-cover\s*\{[\s\S]*?width:\s*48px;[\s\S]*?height:\s*64px;/u);
    expect(css).toMatch(/\.benchmark-cover\.detail\s*\{[\s\S]*?width:\s*100%;[\s\S]*?aspect-ratio:\s*16\s*\/\s*9;/u);
  });

  it('retains every visible local and lab parameter group', async () => {
    const [book, benchmark, person, image, voice] = await Promise.all(
      pageContracts.map(([, path]) => readFile(new URL(path, import.meta.url), 'utf8')),
    );

    for (const label of ['主题', '商品 / 书名', '作者', '分类', '关键词', '价格', '目标人群', '人物', '年代 / 场景', '链接', '核心卖点', '备注']) {
      expect(book).toContain(`label="${label}"`);
    }
    for (const label of ['来源链接', '封面图链接', '账号 / 标题', '关键词', '素材来源', '对标文案', '删除作品', '保存对标组', '保存作品', '加入选品候选']) expect(benchmark).toContain(label);
    for (const label of ['人物名称', '创建', '重命名', '删除', '打开目录', '导入图片']) expect(person).toContain(label);
    for (const label of ['模式', '参考图', '需求描述', '每组合数量', '多选比例', '多选风格', '分辨率', '导入成品', '智能生成']) expect(image).toContain(label);
    for (const label of ['试听文案', '配音模型', '音色', '语速', '生成试听', '历史试听']) expect(voice).toContain(label);
  });

  it('refreshes person image previews after importing files', async () => {
    const personAssets = await readFile(new URL('../src/features/labs/PersonAssetsPage.tsx', import.meta.url), 'utf8');

    expect(personAssets).toContain('loadPersonImagePreviews(api, selectedName)');
    expect(personAssets).toContain('setImages(previews.items);');
    expect(personAssets).toContain('setImageUrls(previews.urls);');
  });

  it('supports complete searchable voice catalogs without charging on hover', async () => {
    const [voice, voices, css] = await Promise.all([
      readFile(new URL('../src/features/labs/VoiceLabPage.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/tts-voices.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles/features/local-labs.css', import.meta.url), 'utf8'),
    ]);

    expect(voice).toContain('api.listVolcengineSpeakers');
    expect(voice).toContain("['seed-tts-2.0', 'seed-tts-1.0']");
    expect(voice).toContain('filterTtsVoiceOptions');
    expect(voice).toContain('aria-label="搜索音色"');
    expect(voice).toContain('aria-pressed={voiceId === voice.id}');
    expect(voice).not.toContain('onMouseEnter={() => generatePreview');
    expect(voices).toContain("id: 'cartoon_pig'");
    expect(css).toMatch(/\.voice-lab-voice-list\s*\{[\s\S]*?max-height:\s*260px;[\s\S]*?overflow:\s*auto;/u);
  });

  it('exercises the MiniMax catalog and search in real Electron QA', async () => {
    const qa = await readFile(new URL('../electron/editorial-qa.ts', import.meta.url), 'utf8');

    expect(qa).toContain("targetView === 'voice-lab'");
    expect(qa).toContain("button.textContent?.trim() === 'MiniMax'");
    expect(qa).toContain("valueSetter?.call(searchInput, '有声书')");
    expect(qa).toContain("document.querySelectorAll('.voice-lab-voice-list .chip').length === 18");
  });
});
