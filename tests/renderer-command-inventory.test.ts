import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import { rendererCommandInventory, rendererCompatibilityMethods, rendererLifecycleCommands } from '../src/app/renderer-command-inventory';
import { SHELL_VIEWS } from '../src/shared/types';
import { readRendererSources } from './helpers/renderer-source';

const queryOnlyMethods = new Set([
  'getPixelleCatalog', // Local read-only template metadata; never starts generation.
  'getVoxAnimationRuntime', 'readVoxAnimationAsset', 'listVoxTemplates',
  'getLicenseStatus', 'getUpdateStatus', 'getMotionComicScripts',
  'getViralReferenceIndex', 'getViralReferencePart', 'getViralMediaUrl',
  'getArtifactStorage', 'getState', 'getBootstrap', 'reconcileDeltas', 'listTasks', 'getTaskDetail', 'listTaskEvents',
  'listViralAnalyses', 'getViralAnalysisDetail', 'listViralEvents', 'listImageLabRecords',
  'getImageLabRecordDetail', 'listVoiceLabRecords', 'getVoiceLabRecordDetail', 'listVideoLabRecords', 'listPromptTemplates',
  'getMusicLabServiceStatus', 'getMusicLabBalance', 'listMusicLabRecords',
  'getPromptTemplateDetail', 'listDraftTemplates', 'getDraftTemplateDetail', 'listMinimaxCloneVoices',
  'listBookSelections', 'discoverBooks', 'listPersonAssets', 'listPersonAssetImages', 'getPersonAssetUsage', 'restorePersonAsset', 'getHtmlVideoMediaUrl', 'getTaskMediaUrl',
  'getHtmlVideoCompositionSource', 'lintHtmlVideoCompositionSource',
  'listLibraryAssets', 'getLibraryAsset',
  'getViralAnalysisResult', 'getTaskArtifacts', 'readAssetDataUrl', 'getJianyingEffectCatalog', 'listSceneVideoLibrary', 'onAppDelta',
  'fetchHotBoard', 'queryAiHot', 'listBenchmarkGroups', 'listBenchmarkPosts',
  // Director batch persistence is consumed through the workspace capability
  // object, so these storage methods are not direct renderer commands.
  'createDirectorBatch', 'getDirectorBatch', 'listDirectorBatches', 'updateDirectorBatch', 'deleteDirectorBatch',
]);

const routeEntryPaths = {
  shell: ['src/app/App.tsx', 'src/app/AppShell.tsx', 'src/app/navigation.ts', 'src/app/AnnouncementsDialog.tsx'],
  'new-task': ['src/features/tasks/NewTaskPage.tsx'],
  'hot-board': ['src/features/hotboard/HotBoardPage.tsx'],
  projects: ['src/features/projects/ProjectHomePage.tsx'],
  queue: ['src/features/tasks/QueuePage.tsx'],
  history: ['src/features/tasks/HistoryPage.tsx'],
  'task-detail': ['src/features/tasks/TaskDetailPage.tsx'],
  'editorial-collage': ['src/features/editorial-collage/EditorialCollagePage.tsx'],
  'motion-comic': ['src/features/motion-comic/MotionComicPage.tsx'],
  'html-video': ['src/features/html-video/HtmlVideoPage.tsx'],
  'image-lab': ['src/features/labs/ImageLabPage.tsx'],
  'voice-lab': ['src/features/labs/VoiceLabPage.tsx'],
  'video-lab': ['src/features/labs/VideoLabPage.tsx'],
  'music-lab': ['src/features/labs/MusicLabPage.tsx'],
  'music-mv': ['src/features/music-mv/MusicMvPage.tsx'],
  'book-selection': ['src/features/labs/BookSelectionPage.tsx'],
  benchmark: ['src/features/labs/BenchmarkImportPage.tsx'],
  'person-assets': ['src/features/asset-library/AssetLibraryPage.tsx'],
  'viral-analyzer': ['src/features/viral/ViralAnalyzerPage.tsx'],
  'prompt-templates': ['src/features/templates/PromptTemplatesPage.tsx'],
  'draft-templates': ['src/features/templates/DraftTemplatesPage.tsx'],
  settings: ['src/features/settings/SettingsPage.tsx'],
  account: ['src/features/account/AccountPage.tsx'],
  activation: ['src/features/account/ActivationPage.tsx'],
} as const;
const rendererSourcesPromise = readRendererSources();
const parsedSourceFileCache = new Map<string, { source: string; sourceFile: ts.SourceFile }>();

describe('renderer command inventory', () => {
  let allCallOwners: Map<string, string[]>;
  let allRouteSources: Map<keyof typeof routeEntryPaths, ReadonlyMap<string, string>>;
  beforeAll(async () => {
    const sources = await rendererSourcesPromise;
    allRouteSources = new Map((Object.keys(routeEntryPaths) as Array<keyof typeof routeEntryPaths>).map(route => [route, routeSources(sources, route)]));
    allCallOwners = rendererCommandCallOwners(allRouteSources);
  });
  it('keeps compatibility-only APIs unreachable from renderer calls', async () => {
    const actual = allCallOwners;
    for (const [method, reason] of Object.entries(rendererCompatibilityMethods)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(queryOnlyMethods.has(method)).toBe(false);
      expect(method in rendererCommandInventory).toBe(false);
      expect(actual.get(method) ?? [], method).toEqual([]);
    }
  });
  it('proves non-interactive commands execute in their declared effect or cleanup', async () => {
    const sources = await rendererSourcesPromise;
    for (const owner of rendererLifecycleCommands) {
      const route = routeSources(sources, owner.route);
      expect(route.has(owner.source)).toBe(true);
      const source = sources.requiredFile(owner.source);
      const handler = namedFunctionSource(source, owner.source, owner.handler);
      const sf = parsedSourceFile(handler, owner.source);
      const identities = namedFunctionIdentities(sf);
      const calls: ts.CallExpression[] = [];
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText(sf) === 'api.' + owner.method && nearestNamedFunction(node, sf, identities) === owner.handler) calls.push(node);
        ts.forEachChild(node, visit);
      };
      visit(sf); expect(calls, owner.method).not.toHaveLength(0);
      for (const call of calls) {
        let effect = false, cleanup = false;
        for (let node: ts.Node | undefined = call.parent; node; node = node.parent) {
          if (ts.isReturnStatement(node)) cleanup = true;
          if (ts.isCallExpression(node) && node.expression.getText(sf) === 'useEffect') { effect = true; break; }
        }
        expect(effect, owner.method + ' effect').toBe(true);
        expect(cleanup, owner.method + ' lifecycle').toBe(owner.lifecycle === 'cleanup');
      }
      const focused = await readFile(new URL('../' + owner.test, import.meta.url), 'utf8');
      expect(focused).toContain(owner.method);
    }
  });

  it('indexes each menu action separately and retains the disabled trigger contract', () => {
    const source = '<Menu trigger={<Button disabled={locked}>Media</Button>} options={[{label:"Image",onSelect:()=>replaceImage()},{label:"Video",onSelect:()=>replaceVideo()}]} />';
    const candidates = indexJsxCommandControlCandidates(source, 'menu-fixture.tsx');
    expect(candidates.filter(candidate => candidate.eventBindings.includes('replaceImage'))).toHaveLength(1);
    expect(candidates.filter(candidate => candidate.eventBindings.includes('replaceVideo'))).toHaveLength(1);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].text).toContain('disabled={locked}');
    expect(candidates[0].text).not.toContain('replaceVideo');
  });
  it('indexes conditional spread menu entries without losing action-level locks', () => {
    const source = '<Menu trigger={<Button disabled={busy}>More</Button>} options={[...(running ? [{label:"Cancel",disabled:cancelling,onSelect:()=>cancelRender()}] : [])]} />';
    const candidates = indexJsxCommandControlCandidates(source, 'spread-menu.tsx');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].eventBindings).toContain('cancelRender()');
    expect(candidates[0].text).toContain('disabled:cancelling');
    expect(candidates[0].text).toContain('disabled={busy}');
  });
  it('keeps the StoryDreamApi type and real preload method sets identical', async () => {
    const [apiSource, preloadSource, viralSource] = await Promise.all([
      readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/shared/viral-reference-api.ts', import.meta.url), 'utf8'),
    ]);
    expect(preloadApiMethods(preloadSource)).toEqual(storyDreamApiMethods(apiSource + '\n' + viralSource).sort());
  });

  it('owns every user command with complete route and UX metadata', async () => {
    const apiSource = await readFile(new URL('../src/shared/storydream-api.ts', import.meta.url), 'utf8');

    const viralSource = await readFile(new URL('../src/shared/viral-reference-api.ts', import.meta.url), 'utf8');
    const apiMethods = storyDreamApiMethods(apiSource + '\n' + viralSource)
      .filter((method) => !queryOnlyMethods.has(method) && !(method in rendererCompatibilityMethods))
      .sort();
    const inventoryMethods = Object.keys(rendererCommandInventory).sort();
    expect(inventoryMethods).toEqual(apiMethods);

    const validRoutes = new Set<string>(['shell', ...SHELL_VIEWS]);
    for (const [method, metadata] of Object.entries(rendererCommandInventory)) {
      expect(validRoutes.has(metadata.route), `${method} route`).toBe(true);
      for (const field of ['control', 'disabled', 'loading', 'error', 'test'] as const) {
        expect(metadata[field].trim().length, `${method}.${field}`).toBeGreaterThan(0);
      }
      expect(metadata.test, `${method}.test`).toMatch(/^tests\/.+\.test\.ts$/u);
      await expect(readFile(new URL(`../${metadata.test}`, import.meta.url), 'utf8')).resolves.not.toHaveLength(0);
    }
  });

  it('enumerates every concrete renderer call owner instead of one representative route', async () => {
    const sources = await rendererSourcesPromise;
    const ownerSourcesByRoute = allRouteSources;
    const actualOwners = allCallOwners;
    const inventory = rendererCommandInventory as unknown as Record<string, {
      owners?: Array<{
        route: string;
        source: string;
        controlSource: string;
        evidenceSource: string;
        handler: string;
        binding: string;
        control: string;
        disabled: string;
        loading: string;
        error: string;
        test: string;
        callPath?: readonly string[];
        bridges?: ReadonlyArray<{ source: string; evidence: string }>;
      }>;
    }>;
    const focusedTestSources = new Map(await Promise.all(
      [...new Set(Object.values(inventory).flatMap((metadata) => metadata.owners?.map((owner) => owner.test) ?? []))]
        .map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')] as const),
    ));

    for (const [method, metadata] of Object.entries(inventory)) {
      expect(Array.isArray(metadata.owners), `${method}.owners`).toBe(true);
      const declaredOwners = metadata.owners ?? [];
      expect(declaredOwners.length, `${method}.owners`).toBeGreaterThan(0);
      expect(
        [...new Set([...declaredOwners, ...rendererLifecycleCommands.filter(owner => owner.method === method)].map(({ source, handler }) => `${source}#${handler}`))].sort(),
        `${method} must enumerate each real api call owner`,
      ).toEqual(actualOwners.get(method) ?? []);

      for (const owner of declaredOwners) {
        expect(routeEntryPaths[owner.route as keyof typeof routeEntryPaths], `${method} owner route: ${owner.route}`).toBeDefined();
        const routeOwnerSources = ownerSourcesByRoute.get(owner.route as keyof typeof routeEntryPaths);
        if (!routeOwnerSources) throw new Error(`Missing route owner sources: ${owner.route}`);
        expect(routeOwnerSources.has(owner.source), `${method} owner source must be reachable from ${owner.route}: ${owner.source}`).toBe(true);
        expect(routeOwnerSources.has(owner.controlSource), `${method} control source must be reachable from ${owner.route}: ${owner.controlSource}`).toBe(true);
        expect(routeOwnerSources.has(owner.evidenceSource), `${method} evidence source must be reachable from ${owner.route}: ${owner.evidenceSource}`).toBe(true);
        const source = sources.requiredFile(owner.source);
        const controlSource = sources.requiredFile(owner.controlSource);
        const evidenceSource = sources.requiredFile(owner.evidenceSource);
        const handler = namedFunctionSource(source, owner.source, owner.handler);
        expect(new RegExp(`\\bapi\\.${method}\\s*\\(`, 'u').test(handler), `${method} call must belong to ${owner.source}#${owner.handler}`).toBe(true);
        if (owner.callPath) {
          expect(owner.callPath.at(-1), `${method} indirect call path must end at ${owner.handler}`).toBe(owner.handler);
          for (let index = 0; index < owner.callPath.length - 1; index += 1) {
            const caller = namedFunctionSource(source, owner.source, owner.callPath[index]);
            const callee = owner.callPath[index + 1].replace(/\[\d+\]$/u, '');
            expect(new RegExp(`\\b${escapeRegExp(callee)}\\s*\\(`, 'u').test(caller), `${method} call path ${owner.callPath[index]} -> ${owner.callPath[index + 1]}`).toBe(true);
          }
        }
        if (owner.controlSource !== owner.source) {
          expect.soft(owner.bridges ?? [], `${method} cross-component bridge chain: ${owner.source} -> ${owner.controlSource}`).not.toHaveLength(0);
        }
        for (const bridge of owner.bridges ?? []) {
          expect(routeOwnerSources.has(bridge.source), `${method} bridge source must be reachable from ${owner.route}: ${bridge.source}`).toBe(true);
          expect(sources.requiredFile(bridge.source).includes(bridge.evidence), `${method} cross-component bridge in ${bridge.source}: ${bridge.evidence}`).toBe(true);
        }
        for (const field of ['binding', 'control', 'disabled', 'loading', 'error', 'test'] as const) {
          expect(owner[field].trim().length, `${method}.${owner.handler}.${field}`).toBeGreaterThan(0);
        }
        const controls = jsxCommandControls(controlSource, owner.controlSource, [owner.binding], owner.control);
        expect.soft(controls, `${method} exact JSX control in ${owner.controlSource}: ${owner.binding} / ${owner.control}`).toHaveLength(1);
        const control = controls[0] ?? '';
        expect.soft(control.includes(owner.disabled), `${method} disabled evidence must belong to ${owner.control}: ${owner.disabled}`).toBe(true);
        expect.soft(evidenceSource.includes(owner.loading), `${method} loading evidence in ${owner.evidenceSource}: ${owner.loading}`).toBe(true);
        expect(evidenceSource.includes(owner.error), `${method} error evidence in ${owner.evidenceSource}: ${owner.error}`).toBe(true);
        const focusedTest = focusedTestSources.get(owner.test) ?? '';
        expect.soft(
          focusedTest.includes(method) || focusedTest.includes(owner.binding) || focusedTest.includes(owner.control),
          `${method} focused test must bind ${owner.binding} or ${owner.control}`,
        ).toBe(true);
      }

      const controlGroups = new Map<string, typeof declaredOwners>();
      for (const owner of declaredOwners) {
        const key = `${owner.source}#${owner.handler}#${owner.controlSource}`;
        const group = controlGroups.get(key) ?? [];
        group.push(owner);
        controlGroups.set(key, group);
      }
      for (const [key, group] of controlGroups) {
        const controlSource = sources.requiredFile(group[0].controlSource);
        const handlerBinding = /\[\d+\]$/u.test(group[0].handler)
          ? []
          : [group[0].handler];
        const controls = jsxCommandControls(
          controlSource,
          group[0].controlSource,
          [...handlerBinding, ...group.map((owner) => owner.binding)],
        ).filter((control) => group.some((owner) => control.includes(owner.control)));
        expect.soft(controls.length, `${method} must enumerate every concrete JSX entry for ${key}`).toBe(group.length);
      }
    }
  }, 15_000);

  it('connects prompt template save, backup, clone and import controls to real mutations', async () => {
    const sources = await rendererSourcesPromise;
    const route = routeSources(sources, 'prompt-templates');
    const owners = rendererCommandInventory.savePromptTemplate.owners;
    const actualOwners = rendererCommandCallOwners(new Map([['prompt-templates', route]]));
    expect([...new Set(owners.map(({ source, handler }) => `${source}#${handler}`))].sort())
      .toEqual(actualOwners.get('savePromptTemplate'));
    for (const owner of owners) {
      const source = sources.requiredFile(owner.source);
      const controls = jsxCommandControls(sources.requiredFile(owner.controlSource), owner.controlSource, [owner.binding], owner.control);
      expect(controls, owner.binding).toHaveLength(1);
      expect(controls[0]).toContain(owner.disabled);
      expect(namedFunctionSource(source, owner.source, owner.handler)).toMatch(/api\.savePromptTemplate\s*\(/u);
      expect(sources.requiredFile(owner.evidenceSource)).toContain(owner.loading);
      expect(sources.requiredFile(owner.evidenceSource)).toContain(owner.error);
      for (const bridge of owner.bridges ?? []) {
        expect(route.has(bridge.source)).toBe(true);
        expect(sources.requiredFile(bridge.source)).toContain(bridge.evidence);
      }
      if (owner.controlSource !== owner.source) expect(owner.bridges?.length).toBeGreaterThan(0);
    }
  });

  it('proves each command owner, visible control, UX states, and focused test inside its declared route', async () => {
    const sources = await rendererSourcesPromise;
    const routeEvidence = new Map(Object.keys(routeEntryPaths).map((route) => {
      const ownerSources = routeSources(sources, route as keyof typeof routeEntryPaths);
      return [route, {
        ownerSource: [...ownerSources.values()].join('\n'),
        visibleControls: [...ownerSources.entries()].flatMap(([path, source]) => visibleJsxText(source, path)),
      }] as const;
    }));
    const focusedTests = new Map(await Promise.all(
      [...new Set(Object.values(rendererCommandInventory).map((metadata) => metadata.test))]
        .map(async (path) => [path, await readFile(new URL(`../${path}`, import.meta.url), 'utf8')] as const),
    ));
    for (const [method, metadata] of Object.entries(rendererCommandInventory)) {
      const evidence = routeEvidence.get(metadata.route);
      if (!evidence) throw new Error(`Missing route evidence: ${metadata.route}`);
      const { ownerSource, visibleControls } = evidence;
      const focusedTest = focusedTests.get(metadata.test);
      if (!focusedTest) throw new Error(`Missing focused test source: ${metadata.test}`);

      expect.soft(new RegExp(`\\bapi\\.${method}\\s*\\(`, 'u').test(ownerSource), `${method} must be called from ${metadata.route}`).toBe(true);
      expect.soft(visibleControls.some((text) => text.includes(metadata.control)), `${method} visible control: ${metadata.control}`).toBe(true);
      expect.soft(ownerSource.includes(metadata.disabled), `${method} disabled evidence: ${metadata.disabled}`).toBe(true);
      expect.soft(ownerSource.includes(metadata.loading), `${method} loading evidence: ${metadata.loading}`).toBe(true);
      expect.soft(ownerSource.includes(metadata.error), `${method} error evidence: ${metadata.error}`).toBe(true);
      expect.soft(
        focusedTest.includes(method) || focusedTest.includes(metadata.control),
        `${method} focused test must mention the method or visible control`,
      ).toBe(true);
    }
  }, 15_000);

  it('freezes the history family together with a pending permanent-delete target', async () => {
    const history = (await rendererSourcesPromise).requiredFile('src/features/tasks/HistoryPage.tsx');
    expect(history).toContain('type PendingHistoryDelete = { family: HistoryFamily; record: HistoryRecord };');
    expect(history).toContain('setPendingDelete({ family, record })');
    expect(history).toContain("if (pendingDelete.family === 'task')");
    expect(history).not.toContain("if (family === 'task') result = await api.deleteTaskPermanently(pendingDelete.id)");
  });
});

function preloadApiMethods(source: string): string[] {
  return objectLiteral(source, 'storyDreamApi').properties
    .filter(ts.isPropertyAssignment)
    .map((property) => property.name.getText().replace(/^['"]|['"]$/gu, ''))
    .sort();
}

function storyDreamApiMethods(source: string): string[] {
  const sourceFile = ts.createSourceFile('storydream-api.ts', source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const owners = new Set(['StoryDreamApi', 'LocalBenchmarkBookPersonAssetApi', 'ViralReferenceApi']);
  function visit(node: ts.Node): void {
    if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && owners.has(node.name.text)) {
      const collect = (current: ts.Node): void => {
        if (ts.isTypeLiteralNode(current) || ts.isInterfaceDeclaration(current)) {
          for (const member of current.members) {
            if ((ts.isPropertySignature(member) || ts.isMethodSignature(member)) && member.name) names.push(member.name.getText(sourceFile));
          }
          return;
        }
        ts.forEachChild(current, collect);
      };
      collect(ts.isInterfaceDeclaration(node) ? node : node.type);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function objectLiteral(source: string, name: string): ts.ObjectLiteralExpression {
  const sourceFile = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true);
  let result: ts.ObjectLiteralExpression | null = null;
  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const declaration of node.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) === name && declaration.initializer) {
        const initializer = unwrapExpression(declaration.initializer);
        if (ts.isObjectLiteralExpression(initializer)) result = initializer;
      }
    }
  });
  if (!result) throw new Error(`${name} object literal was not found.`);
  return result;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isSatisfiesExpression(current) || ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

function routeSources(sources: Awaited<ReturnType<typeof readRendererSources>>, route: keyof typeof routeEntryPaths): ReadonlyMap<string, string> {
  const collected = new Map<string, string>();
  for (const entry of routeEntryPaths[route]) {
    const entries = route === 'shell' ? [[entry, sources.requiredFile(entry)] as const] : sources.reachableFrom(entry);
    for (const [path, source] of entries) collected.set(path, source);
  }
  return collected;
}

function visibleJsxText(source: string, path: string): string[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const values: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/gu, ' ').trim();
      if (value) values.push(value);
    } else if (ts.isJsxAttribute(node) && ['aria-label', 'label', 'title'].includes(node.name.getText(sourceFile))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) values.push(node.initializer.text);
      else if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        values.push(node.initializer.expression.getText(sourceFile));
      }
    } else if (ts.isJsxExpression(node) && node.expression) {
      collectExpressionText(node.expression, values);
    } else if (ts.isPropertyAssignment(node)
      && node.name.getText(sourceFile) === 'label'
      && ts.isStringLiteral(node.initializer)) {
      values.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return values;
}

function collectExpressionText(expression: ts.Expression, values: string[]): void {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    values.push(expression.text);
    return;
  }
  if (ts.isTemplateExpression(expression)) {
    values.push(expression.getText());
    return;
  }
  ts.forEachChild(expression, (node) => {
    if (ts.isExpression(node)) collectExpressionText(node, values);
  });
}

function rendererCommandCallOwners(routeSourcesByRoute: ReadonlyMap<string, ReadonlyMap<string, string>>): Map<string, string[]> {
  const files = new Map<string, string>();
  for (const routeSources of routeSourcesByRoute.values()) {
    for (const [path, source] of routeSources) files.set(path, source);
  }
  const owners = new Map<string, Set<string>>();
  for (const [path, source] of files) {
    if (!source.includes('api.')) continue;
    const sourceFile = parsedSourceFile(source, path);
    const functionIdentities = namedFunctionIdentities(sourceFile);
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.getText(sourceFile) === 'api'
        && !queryOnlyMethods.has(node.expression.name.text)) {
        const handler = nearestNamedFunction(node, sourceFile, functionIdentities);
        const methodOwners = owners.get(node.expression.name.text) ?? new Set<string>();
        methodOwners.add(`${path}#${handler}`);
        owners.set(node.expression.name.text, methodOwners);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return new Map([...owners].map(([method, methodOwners]) => [method, [...methodOwners].sort()]));
}

function nearestNamedFunction(node: ts.Node, sourceFile: ts.SourceFile, identities: ReadonlyMap<number, string>): string {
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) && current.name) {
      return identities.get(current.getStart(sourceFile)) ?? current.name.getText(sourceFile);
    }
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && current.parent) {
      if (ts.isVariableDeclaration(current.parent)) return identities.get(current.parent.getStart(sourceFile)) ?? current.parent.name.getText(sourceFile);
      if (ts.isPropertyAssignment(current.parent)) return identities.get(current.parent.getStart(sourceFile)) ?? current.parent.name.getText(sourceFile);
    }
  }
  throw new Error(`Renderer api call has no named function owner in ${sourceFile.fileName}.`);
}

const namedFunctionSourceCache = new Map<string, ReadonlyMap<string, string>>();

function namedFunctionSource(source: string, path: string, name: string): string {
  let functions = namedFunctionSourceCache.get(path);
  if (!functions) {
    functions = indexNamedFunctionSources(source, path);
    namedFunctionSourceCache.set(path, functions);
  }
  const result = functions.get(name);
  if (!result) throw new Error(`Named function ${name} was not found in ${path}.`);
  return result;
}

function indexNamedFunctionSources(source: string, path: string): ReadonlyMap<string, string> {
  const sourceFile = parsedSourceFile(source, path);
  const identities = namedFunctionIdentities(sourceFile);
  const result = new Map<string, string>();
  function visit(node: ts.Node): void {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      const identity = identities.get(node.getStart(sourceFile));
      if (identity) result.set(identity, node.getText(sourceFile));
    }
    if (ts.isVariableDeclaration(node)
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const identity = identities.get(node.getStart(sourceFile));
      if (identity) result.set(identity, node.initializer.getText(sourceFile));
    }
    if (ts.isPropertyAssignment(node)
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const identity = identities.get(node.getStart(sourceFile));
      if (identity) result.set(identity, node.initializer.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}

function namedFunctionIdentities(sourceFile: ts.SourceFile): ReadonlyMap<number, string> {
  const declarations: Array<{ name: string; start: number }> = [];
  function visit(node: ts.Node): void {
    if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
      declarations.push({ name: node.name.getText(sourceFile), start: node.getStart(sourceFile) });
    } else if (ts.isVariableDeclaration(node)
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      declarations.push({ name: node.name.getText(sourceFile), start: node.getStart(sourceFile) });
    } else if (ts.isPropertyAssignment(node)
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      declarations.push({ name: node.name.getText(sourceFile), start: node.getStart(sourceFile) });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  const grouped = new Map<string, Array<{ name: string; start: number }>>();
  for (const declaration of declarations) {
    const group = grouped.get(declaration.name) ?? [];
    group.push(declaration);
    grouped.set(declaration.name, group);
  }
  const identities = new Map<number, string>();
  for (const group of grouped.values()) {
    group.sort((left, right) => left.start - right.start).forEach((declaration, index) => {
      identities.set(declaration.start, group.length === 1 ? declaration.name : `${declaration.name}[${index + 1}]`);
    });
  }
  return identities;
}

const jsxCommandControlCandidatesCache = new Map<string, ReadonlyArray<{ eventBindings: string; text: string }>>();

function jsxCommandControls(source: string, path: string, bindings: string[], control?: string): string[] {
  let candidates = jsxCommandControlCandidatesCache.get(path);
  if (!candidates) {
    candidates = indexJsxCommandControlCandidates(source, path);
    jsxCommandControlCandidatesCache.set(path, candidates);
  }
  return candidates
    .filter(({ eventBindings, text }) => bindings.some((binding) => eventBindings.includes(binding)) && (!control || text.includes(control)))
    .map(({ text }) => text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parsedSourceFile(source: string, path: string): ts.SourceFile {
  const cached = parsedSourceFileCache.get(path);
  if (cached?.source === source) return cached.sourceFile;
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  parsedSourceFileCache.set(path, { source, sourceFile });
  return sourceFile;
}

function menuOptionObjects(expression: ts.Expression): ts.ObjectLiteralExpression[] {
  const node = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(node)) return [node];
  if (ts.isConditionalExpression(node)) return [...menuOptionObjects(node.whenTrue), ...menuOptionObjects(node.whenFalse)];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(item => menuOptionObjects(ts.isSpreadElement(item) ? item.expression : item));
  return [];
}

function indexJsxCommandControlCandidates(source: string, path: string): ReadonlyArray<{ eventBindings: string; text: string }> {
  const sourceFile = parsedSourceFile(source, path);
  const controls: Array<{ eventBindings: string; text: string }> = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const eventBindings = opening.attributes.properties
        .filter(ts.isJsxAttribute)
        .filter((attribute) => /^on[A-Z]/u.test(attribute.name.getText(sourceFile)))
        .map((attribute) => attribute.getText(sourceFile))
        .join(' ');
      const text = node.getText(sourceFile);
      if (eventBindings) controls.push({ eventBindings, text });
      // Project-owned Menu routes actions through option objects, not JSX onClick.
      // Keep each option separate, with its real trigger's disabled state.
      if (opening.tagName.getText(sourceFile) === 'Menu') {
        const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
        const options = attributes.find(attribute => attribute.name.getText(sourceFile) === 'options');
        const trigger = attributes.find(attribute => attribute.name.getText(sourceFile) === 'trigger');
        const expression = options?.initializer && ts.isJsxExpression(options.initializer) ? options.initializer.expression : undefined;
        if (expression && ts.isArrayLiteralExpression(expression)) {
          for (const option of menuOptionObjects(expression)) {
            const onSelect = option.properties.filter(ts.isPropertyAssignment).find(property => property.name.getText(sourceFile) === 'onSelect');
            if (onSelect) controls.push({ eventBindings: onSelect.getText(sourceFile), text: option.getText(sourceFile) + ' ' + (trigger?.getText(sourceFile) ?? '') });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return controls;
}
