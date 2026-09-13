import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

async function source(path: string): Promise<string> {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

describe('director desk render strategy UI', () => {
  it('exposes only deterministic layers and AI living poster as selectable engines', async () => {
    const workspace = await source('src/features/director-desk/DirectorDeskWorkspace.tsx');

    expect(workspace).toContain("DIRECTOR_RENDER_STRATEGIES = ['deterministic-layers', 'living-poster']");
    expect(workspace).toContain('label="镜头渲染策略"');
    expect(workspace).toContain('本地关键帧');
    expect(workspace).toContain('AI 动态海报');
    expect(workspace).toContain('旧版混合渲染模式已停用');
    expect(workspace).not.toMatch(/value=['"]hybrid['"]/u);
  });

  it('models video jobs, provider availability, generation, and retry without placeholder video media', async () => {
    const workspace = await source('src/features/director-desk/DirectorDeskWorkspace.tsx');

    for (const contract of [
      'videoInputReady?: boolean',
      'videoUrl?: string',
      'videoJobId?: string',
      'videoJobStatus?: DirectorVideoJobStatus',
      'videoJobError?: string',
      'videoEstimatedCost?: number',
      'videoProviderConnected?: boolean',
      'videoProviderLabel?: string',
      'videoProviderModel?: string',
      'videoProviderUnavailableReason?: string',
      'onGenerateVideo?: (id: string)',
      'onRetryVideo?: (id: string)',
    ]) {
      expect(workspace).toContain(contract);
    }
    expect(workspace).toContain('请先生成或选择一张可读取的首帧图片。');
    expect(workspace).toContain('请先在系统设置中配置并启用视频生成服务。');
    expect(workspace).toContain("const action = retry ? onRetryVideo ?? onGenerateVideo : onGenerateVideo");
    expect(workspace).toContain('src={selectedShot.videoUrl}');
    expect(workspace).not.toContain('src={previewCity} aria-label={`${selectedShot.title} AI 动态海报预览`}');
  });

  it('drives video, layer, and camera preview from the shared playback clock', async () => {
    const [workspace, css, motion] = await Promise.all([
      source('src/features/director-desk/DirectorDeskWorkspace.tsx'),
      source('src/styles/features/director-desk.css'),
      source('src/features/director-desk/DirectorMotionInspector.tsx'),
    ]);

    expect(workspace).toContain('(playbackMs - selectedShotOffset) / 1000');
    expect(workspace).toContain('Math.abs(video.currentTime - availableSeconds) > 0.12');
    expect(workspace).toContain('directorLayerStyle(layer, selectedShotPlaybackMs)');
    expect(workspace).toContain('directorCameraStyle(selectedShot?.cameraKeyframes ?? [], selectedShotPlaybackMs');
    expect(motion).toContain('camera.length');
    expect(motion).toContain('director-motion-layers');
    expect(motion).toContain("kind: 'layer-visibility'");
    expect(motion).toContain("kind: 'layer-order'");
    expect(motion).toContain("kind: 'camera-frame'");
    expect(workspace).not.toContain("value={shot.motionPreset === '轻微视差' ? '103%' : shot.motionPreset === '固定机位' ? '100%' : '106%'}");
    expect(workspace).toContain('ref={previewVideoRef}');
    expect(css).toContain('.director-media-preview .director-shot-video');
    expect(css).toContain('.director-deterministic-stage');
    expect(css).toContain('.director-preview-layer');
    expect(css).not.toContain('director-preview-drift');
    expect(css).not.toContain('img.is-playing');
  });

  it('wires the VOX page to the authoritative video generation IPC with minimal input', async () => {
    const page = await source('src/features/editorial-collage/EditorialCollagePage.tsx');
    const call = findApiCall(page, 'generateDirectorShotVideo');

    expect(objectPropertyNames(call.argument, call.sourceFile).sort()).toEqual([
      'expectedUpdatedAt',
      'id',
      'shotId',
    ]);
    const request = call.argument.getText(call.sourceFile);
    expect(request).toMatch(/\bid\s*:\s*current\.id\b/u);
    expect(request).toMatch(/\bshotId\b/u);
    expect(request).toMatch(/\bexpectedUpdatedAt\s*:\s*current\.updatedAt\b/u);

    const generateBinding = directorWorkspaceProp(page, 'onGenerateVideo');
    const retryBinding = directorWorkspaceProp(page, 'onRetryVideo');
    expect(generateBinding).not.toMatch(/undefined|null/u);
    expect(retryBinding).not.toMatch(/undefined|null/u);
    expect(generateBinding).toContain(call.handler);
    expect(retryBinding).toContain(call.handler);
    expect(page).toContain('applyState(response.mutation)');
  });

  it('maps persisted render strategy and the exact video asset/job back into the workspace', async () => {
    const page = await source('src/features/editorial-collage/EditorialCollagePage.tsx');
    const mapper = namedFunctionSource(page, 'directorShotFromEditorial');

    expect(page).toContain('renderStrategy: update.renderStrategy ?? shot.renderStrategy');
    expect(mapper).toContain('renderStrategy: shot.renderStrategy');
    expect(mapper).toContain('candidate.id === shot.videoAssetVersionId');
    expect(mapper).toContain('candidate.id === shot.videoJobId');
    expect(mapper).toContain('toLocalAssetUrl(videoAsset.localPath)');
    expect(mapper).toContain('videoJobId: shot.videoJobId');
    expect(mapper).toContain("videoJobStatus: videoJob?.status ?? 'idle'");
    expect(mapper).toContain('videoJobError: videoJob?.error');
    expect(mapper).toContain('videoEstimatedCost: videoJob?.actualCost ?? videoJob?.estimatedCost');
    expect(mapper).toContain('const videoInputReady = Boolean(');
    expect(mapper).toMatch(/\bvideoInputReady,\s*\n/u);
  });

  it('passes active video provider health and a video-settings repair entry to Director Desk', async () => {
    const [page, generation] = await Promise.all([
      source('src/features/editorial-collage/EditorialCollagePage.tsx'),
      source('src/features/director-desk/director-generation.ts'),
    ]);

    expect(page).toContain('resolveDirectorVideoProviderOptions');
    expect(page).toContain('resolveDirectorVideoProviderStatus');
    expect(page).toContain('state.config.video.activeProviderId');
    expect(generation).toContain('config.video.providers');
    expect(generation).toContain("provider.capabilities.includes('i2v')");
    for (const prop of [
      'videoProviderConnected',
      'videoProviderLabel',
      'videoProviderModel',
      'videoProviderUnavailableReason',
      'videoProviderId',
      'videoProviderOptions',
      'onVideoProviderChange',
    ]) {
      expect(directorWorkspaceProp(page, prop)).not.toMatch(/undefined|null/u);
    }
    expect(directorWorkspaceProp(page, 'onConfigureVideoProvider')).toContain("openSettings?.('video', 'editorial-collage', document.id)");
    expect(directorWorkspaceProp(page, 'onConfigureProvider')).toContain("openSettings?.('image', 'editorial-collage', document.id)");
  });

  it('registers paid VOX video generation in the renderer command inventory', async () => {
    const inventory = await source('src/app/renderer-command-inventory.ts');

    expect(inventory).toContain('generateDirectorShotVideo: command(');
    expect(inventory).toContain("'tests/director-render-strategy-ui.test.ts'");
    expect(inventory).toContain('onGenerateVideo=');
    expect(inventory).toContain('生成 AI 动态海报');
  });
});

function findApiCall(sourceText: string, method: string): {
  sourceFile: ts.SourceFile;
  argument: ts.ObjectLiteralExpression;
  handler: string;
} {
  const sourceFile = ts.createSourceFile('EditorialCollagePage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: { argument: ts.ObjectLiteralExpression; handler: string } | null = null;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.expression.getText(sourceFile) === 'api'
      && node.expression.name.text === method) {
      if (found) throw new Error(`Expected one api.${method} call.`);
      const argument = node.arguments[0];
      if (!argument || !ts.isObjectLiteralExpression(argument)) throw new Error(`api.${method} must receive an object literal.`);
      found = { argument, handler: nearestNamedHandler(node, sourceFile) };
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!found) throw new Error(`api.${method} call was not found.`);
  const match = found as { argument: ts.ObjectLiteralExpression; handler: string };
  return { sourceFile, argument: match.argument, handler: match.handler };
}

function nearestNamedHandler(node: ts.Node, sourceFile: ts.SourceFile): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current))
      && current.parent
      && ts.isVariableDeclaration(current.parent)) {
      return current.parent.name.getText(sourceFile);
    }
  }
  throw new Error('Video generation call must belong to a named handler.');
}

function objectPropertyNames(object: ts.ObjectLiteralExpression, sourceFile: ts.SourceFile): string[] {
  return object.properties.map((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
    if (ts.isPropertyAssignment(property) && property.name) return property.name.getText(sourceFile).replace(/^['"]|['"]$/gu, '');
    throw new Error(`Video generation input must use explicit or shorthand properties: ${property.getText(sourceFile)}`);
  });
}

function directorWorkspaceProp(sourceText: string, name: string): string {
  const sourceFile = ts.createSourceFile('EditorialCollagePage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === 'DirectorDeskWorkspace') {
      const attribute = node.attributes.properties.find((property): property is ts.JsxAttribute => (
        ts.isJsxAttribute(property) && property.name.getText(sourceFile) === name
      ));
      if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) {
        throw new Error(`DirectorDeskWorkspace.${name} must be an expression prop.`);
      }
      matches.push(attribute.initializer.expression.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (matches.length !== 1) throw new Error(`Expected one DirectorDeskWorkspace.${name} prop, received ${matches.length}.`);
  return matches[0];
}

function namedFunctionSource(sourceText: string, name: string): string {
  const sourceFile = ts.createSourceFile('EditorialCollagePage.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result = '';
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(sourceFile);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  if (!result) throw new Error(`${name} was not found.`);
  return result;
}
