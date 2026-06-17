import type { DraftTemplate } from './types';
import { getTemplate, normalizeDraftTemplate } from './templates';

export type CozeWorkflowDiagnosticLevel = 'info' | 'warn' | 'error';

export interface CozeWorkflowDiagnostic {
  level: CozeWorkflowDiagnosticLevel;
  code: string;
  message: string;
  nodeId?: string;
  apiName?: string;
}

export interface CozeWorkflowPluginNode {
  id: string;
  type: string;
  title: string;
  apiID: string;
  apiName: string;
  pluginID: string;
  pluginName: string;
  inputParameters: CozeWorkflowInputParameter[];
  raw: unknown;
}

export interface CozeWorkflowInputParameter {
  name: string;
  value: unknown;
  valueType: string;
  inputType: string;
  isReference: boolean;
  reference?: {
    blockID?: string;
    name?: string;
    source?: string;
  };
}

export type CozeWorkflowParseResult =
  | {
      ok: true;
      workflowId: string;
      spaceId: string;
      host: string;
      nodes: unknown[];
      pluginNodes: CozeWorkflowPluginNode[];
      diagnostics: CozeWorkflowDiagnostic[];
      source: unknown;
    }
  | {
      ok: false;
      error: string;
      diagnostics: CozeWorkflowDiagnostic[];
    };

export type CozeWorkflowTemplateConversionResult =
  | {
      ok: true;
      workflowId: string;
      template: DraftTemplate;
      pluginNodes: CozeWorkflowPluginNode[];
      diagnostics: CozeWorkflowDiagnostic[];
    }
  | {
      ok: false;
      error: string;
      diagnostics: CozeWorkflowDiagnostic[];
    };

const supportedPluginApis = new Set([
  'create_draft',
  'add_videos',
  'add_audios',
  'add_captions',
  'add_effects',
  'add_images',
  'add_keyframes',
  'caption_infos',
  'effect_infos',
  'imgs_infos',
  'keyframes_infos',
  'str_to_list',
  'get_audio_duration',
]);

export function parseCozeWorkflowClipboard(input: string): CozeWorkflowParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      diagnostics: [],
    };
  }

  if (!isRecord(parsed) || parsed.type !== 'coze-workflow-clipboard-data') {
    return {
      ok: false,
      error: 'Input is not Coze workflow clipboard data.',
      diagnostics: [],
    };
  }

  const source = isRecord(parsed.source) ? parsed.source : {};
  const workflowJson = isRecord(parsed.json) ? parsed.json : {};
  const nodes = Array.isArray(workflowJson.nodes) ? flattenNodes(workflowJson.nodes) : [];
  if (!nodes.length) {
    return {
      ok: false,
      error: 'Coze workflow clipboard data does not contain workflow nodes.',
      diagnostics: [],
    };
  }

  const pluginNodes = nodes.map(toPluginNode).filter((node): node is CozeWorkflowPluginNode => Boolean(node));
  const diagnostics: CozeWorkflowDiagnostic[] = [];
  for (const node of pluginNodes) {
    if (!supportedPluginApis.has(node.apiName)) {
      diagnostics.push({
        level: 'warn',
        code: 'plugin.unsupported',
        message: `Unsupported Coze plugin API preserved for manual review: ${node.apiName}`,
        nodeId: node.id,
        apiName: node.apiName,
      });
    }
  }

  return {
    ok: true,
    workflowId: stringValue(source.workflowId),
    spaceId: stringValue(source.spaceId),
    host: stringValue(source.host),
    nodes,
    pluginNodes,
    diagnostics,
    source: parsed,
  };
}

export function convertCozeWorkflowToDraftTemplate(
  input: string,
  options: { name?: string } = {},
): CozeWorkflowTemplateConversionResult {
  const parsed = parseCozeWorkflowClipboard(input);
  if (!parsed.ok) return parsed;

  const diagnostics = [...parsed.diagnostics];
  const createDraft = findPluginNode(parsed.pluginNodes, 'create_draft');

  const width = createDraft ? numberParameter(createDraft, 'width', 1080) : 1080;
  const height = createDraft ? numberParameter(createDraft, 'height', 1920) : 1920;
  const ratio = inferCanvasRatio(width, height);
  const fallback = getTemplate(ratio === '16:9' ? 'builtin-landscape-16-9' : 'default-portrait-9-16');
  const workflowId = parsed.workflowId || stableFallbackWorkflowId(parsed);
  const templateName = options.name?.trim() || `Coze ${workflowId}`;
  const addVideos = findPluginNode(parsed.pluginNodes, 'add_videos');
  const captionInfos = findPluginNode(parsed.pluginNodes, 'caption_infos');
  const addEffects = findPluginNode(parsed.pluginNodes, 'add_effects');
  const addImages = findPluginNode(parsed.pluginNodes, 'add_images');
  const addKeyframes = findPluginNode(parsed.pluginNodes, 'add_keyframes');

  if (!createDraft) {
    diagnostics.push({
      level: 'warn',
      code: 'node.missing_create_draft',
      message: 'No Jianying create_draft node was found; generated a reusable StoryDream draft-template shell using default 9:16 canvas settings.',
    });
  }
  collectStartAssets(parsed.source, diagnostics);
  collectPipelineDiagnostics(parsed.pluginNodes, diagnostics);
  collectReferenceDiagnostics(parsed.pluginNodes, diagnostics);
  collectUnsupportedApiDiagnostics(parsed.pluginNodes, diagnostics);
  collectLiteralHint(captionInfos, 'keyword_color', 'caption.keyword_color', 'Keyword color detected and preserved as a conversion hint.', diagnostics);
  if (addImages) {
    diagnostics.push({
      level: 'info',
      code: 'mapping.image_overlay',
      message: 'Image overlay/add_images nodes detected. StoryDream maps these to editable text/image overlay presets where possible.',
      nodeId: addImages.id,
      apiName: addImages.apiName,
    });
  }
  if (addKeyframes) {
    diagnostics.push({
      level: 'info',
      code: 'mapping.keyframes',
      message: 'Keyframe nodes detected. Current draft templates preserve keyframe behavior as animation/effect hints for manual tuning.',
      nodeId: addKeyframes.id,
      apiName: addKeyframes.apiName,
    });
  }

  const alpha = addVideos ? numberParameter(addVideos, 'alpha', 1) : 1;
  if (addVideos && alpha < 1) {
    diagnostics.push({
      level: 'info',
      code: 'video.alpha',
      message: `Background/video alpha ${alpha} detected. Current DraftTemplate stores this as a visual approximation.`,
      nodeId: addVideos.id,
      apiName: addVideos.apiName,
    });
  }

  const template = normalizeDraftTemplate({
    ...fallback,
    id: `coze-${safeIdentifier(workflowId)}`,
    name: templateName,
    isDefault: false,
    canvas: {
      ...fallback.canvas,
      width,
      height,
      ratio,
    },
    image: {
      ...fallback.image,
      visible: createDraft ? Boolean(addVideos) || fallback.image.visible : Boolean(addVideos),
      ratio,
      fit: 'cover',
      top: 0,
      height: 1,
    },
    title: {
      ...fallback.title,
      visible: false,
      text: '',
    },
    subtitle: {
      ...fallback.subtitle,
      visible: false,
      text: '',
    },
    caption: {
      ...fallback.caption,
      visible: hasPluginNode(parsed.pluginNodes, 'add_captions') || fallback.caption.visible,
      color: '#FFDE00',
      alpha: 1,
      background: {
        ...fallback.caption.background,
        color: '#000000',
        alpha: Math.max(0.35, fallback.caption.background.alpha),
      },
    },
    disclaimer: {
      ...fallback.disclaimer,
      visible: false,
      text: '',
    },
    audio: {
      ...fallback.audio,
      videoEffectType: addEffects ? fallback.audio.videoEffectType : fallback.audio.videoEffectType,
    },
  });

  return {
    ok: true,
    workflowId,
    template,
    pluginNodes: parsed.pluginNodes,
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

export function convertManyCozeWorkflowsToDraftTemplates(
  input: string,
  options: { namePrefix?: string } = {},
): CozeWorkflowTemplateConversionResult[] {
  const sources = splitCozeWorkflowSources(input);
  return sources.map((source, index) => convertCozeWorkflowToDraftTemplate(source, {
    name: options.namePrefix
      ? sources.length === 1
        ? options.namePrefix
        : `${options.namePrefix} ${index + 1}`
      : undefined,
  }));
}

function flattenNodes(nodes: unknown[]): unknown[] {
  const flattened: unknown[] = [];
  for (const node of nodes) {
    flattened.push(node);
    if (isRecord(node) && Array.isArray(node.blocks)) {
      flattened.push(...flattenNodes(node.blocks));
    }
  }
  return flattened;
}

function toPluginNode(node: unknown): CozeWorkflowPluginNode | null {
  if (!isRecord(node)) return null;
  const data = isRecord(node.data) ? node.data : {};
  const inputs = isRecord(data.inputs) ? data.inputs : {};
  const apiParam = Array.isArray(inputs.apiParam) ? inputs.apiParam : [];
  const apiName = apiParamValue(apiParam, 'apiName');
  if (!apiName) return null;

  const inputParameters = Array.isArray(inputs.inputParameters) ? inputs.inputParameters : [];
  const nodeMeta = isRecord(data.nodeMeta) ? data.nodeMeta : {};
  return {
    id: stringValue(node.id),
    type: stringValue(node.type),
    title: stringValue(nodeMeta.title),
    apiID: apiParamValue(apiParam, 'apiID'),
    apiName,
    pluginID: apiParamValue(apiParam, 'pluginID'),
    pluginName: apiParamValue(apiParam, 'pluginName'),
    inputParameters: inputParameters.map(toInputParameter).filter((param): param is CozeWorkflowInputParameter => Boolean(param)),
    raw: node,
  };
}

function toInputParameter(parameter: unknown): CozeWorkflowInputParameter | null {
  if (!isRecord(parameter)) return null;
  const input = isRecord(parameter.input) ? parameter.input : {};
  const value = isRecord(input.value) ? input.value : {};
  const valueType = stringValue(value.type);
  const rawContent = value.content;
  const reference = isRecord(rawContent)
    ? {
        blockID: optionalString(rawContent.blockID),
        name: optionalString(rawContent.name),
        source: optionalString(rawContent.source),
      }
    : undefined;
  return {
    name: stringValue(parameter.name),
    value: valueType === 'ref' ? undefined : rawContent,
    valueType,
    inputType: stringValue(input.type),
    isReference: valueType === 'ref',
    reference,
  };
}

function apiParamValue(apiParam: unknown[], name: string): string {
  const item = apiParam.find((param) => isRecord(param) && param.name === name);
  if (!isRecord(item)) return '';
  const input = isRecord(item.input) ? item.input : {};
  const value = isRecord(input.value) ? input.value : {};
  return stringValue(value.content);
}

function findPluginNode(nodes: CozeWorkflowPluginNode[], apiName: string): CozeWorkflowPluginNode | null {
  return nodes.find((node) => node.apiName === apiName) ?? null;
}

function hasPluginNode(nodes: CozeWorkflowPluginNode[], apiName: string): boolean {
  return nodes.some((node) => node.apiName === apiName);
}

function numberParameter(node: CozeWorkflowPluginNode, name: string, fallback: number): number {
  const parameter = node.inputParameters.find((item) => item.name === name && !item.isReference);
  const value = typeof parameter?.value === 'number' ? parameter.value : Number(parameter?.value);
  return Number.isFinite(value) ? value : fallback;
}

function literalParameter(node: CozeWorkflowPluginNode, name: string): unknown {
  return node.inputParameters.find((item) => item.name === name && !item.isReference)?.value;
}

function inferCanvasRatio(width: number, height: number): string {
  if (width > height) return '16:9';
  if (width === height) return '1:1';
  return '9:16';
}

function collectStartAssets(source: unknown, diagnostics: CozeWorkflowDiagnostic[]): void {
  if (!isRecord(source)) return;
  const workflowJson = isRecord(source.json) ? source.json : {};
  const nodes = Array.isArray(workflowJson.nodes) ? flattenNodes(workflowJson.nodes) : [];
  for (const node of nodes) {
    if (!isRecord(node)) continue;
    const data = isRecord(node.data) ? node.data : {};
    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    for (const output of outputs) {
      if (!isRecord(output)) continue;
      const name = stringValue(output.name);
      const defaultValue = stringValue(output.defaultValue);
      if ((name === 'bg_audio_url' || name === 'bg_video_url') && defaultValue) {
        diagnostics.push({
          level: 'info',
          code: `asset.${name}`,
          message: `${name} preserved for manual asset wiring: ${defaultValue}`,
        });
      }
    }
  }
}

function collectReferenceDiagnostics(nodes: CozeWorkflowPluginNode[], diagnostics: CozeWorkflowDiagnostic[]): void {
  for (const node of nodes) {
    const references = node.inputParameters.filter((parameter) => parameter.isReference);
    if (!references.length) continue;
    diagnostics.push({
      level: 'info',
      code: 'input.references',
      message: `${node.apiName} uses ${references.length} referenced input(s); conversion keeps the visual preset and records the workflow dependency.`,
      nodeId: node.id,
      apiName: node.apiName,
    });
  }
}

function collectPipelineDiagnostics(nodes: CozeWorkflowPluginNode[], diagnostics: CozeWorkflowDiagnostic[]): void {
  for (const apiName of ['add_videos', 'add_audios', 'add_captions', 'add_effects', 'add_images', 'add_keyframes']) {
    const matches = nodes.filter((node) => node.apiName === apiName);
    if (!matches.length) continue;
    diagnostics.push({
      level: 'info',
      code: `pipeline.${apiName}`,
      message: `${matches.length} ${apiName} node(s) detected in the Coze Jianying pipeline.`,
      nodeId: matches[0].id,
      apiName,
    });
  }
}

function collectUnsupportedApiDiagnostics(nodes: CozeWorkflowPluginNode[], diagnostics: CozeWorkflowDiagnostic[]): void {
  for (const node of nodes) {
    if (!supportedPluginApis.has(node.apiName)) {
      diagnostics.push({
        level: 'warn',
        code: 'plugin.unsupported',
        message: `Unsupported Coze plugin API preserved for manual review: ${node.apiName}`,
        nodeId: node.id,
        apiName: node.apiName,
      });
    }
  }
}

function collectLiteralHint(
  node: CozeWorkflowPluginNode | null,
  parameterName: string,
  code: string,
  message: string,
  diagnostics: CozeWorkflowDiagnostic[],
): void {
  if (!node) return;
  const value = literalParameter(node, parameterName);
  if (value === undefined || value === '') return;
  diagnostics.push({
    level: 'info',
    code,
    message: `${message} Value: ${String(value)}`,
    nodeId: node.id,
    apiName: node.apiName,
  });
}

function dedupeDiagnostics(diagnostics: CozeWorkflowDiagnostic[]): CozeWorkflowDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((item) => {
    const key = [item.level, item.code, item.nodeId, item.apiName, item.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitCozeWorkflowSources(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((item) => JSON.stringify(item));
    }
    if (isRecord(parsed) && parsed.type === 'coze-workflow-clipboard-data') {
      return [trimmed];
    }
  } catch {
    // Fall back to brace-balanced splitting below.
  }

  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaping = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        chunks.push(input.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return chunks.length ? chunks : [trimmed];
}

function stableFallbackWorkflowId(parsed: CozeWorkflowParseResult & { ok: true }): string {
  return parsed.pluginNodes.map((node) => node.id).filter(Boolean).slice(0, 3).join('-') || 'workflow';
}

function safeIdentifier(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function optionalString(value: unknown): string | undefined {
  const output = stringValue(value);
  return output || undefined;
}
