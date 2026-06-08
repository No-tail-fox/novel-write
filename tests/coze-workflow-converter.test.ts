import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  convertCozeWorkflowToDraftTemplate,
  convertManyCozeWorkflowsToDraftTemplates,
  parseCozeWorkflowClipboard,
} from '@shared/coze-workflow-converter';

const minimalWorkflow = JSON.stringify({
  type: 'coze-workflow-clipboard-data',
  source: {
    workflowId: '7629256239332032548',
    flowMode: 0,
    spaceId: '7523989714307907603',
    isDouyin: false,
    host: 'www.coze.cn',
  },
  json: {
    nodes: [
      {
        id: '100001',
        type: '1',
        data: {
          outputs: [
            {
              name: 'bg_audio_url',
              defaultValue: 'https://example.test/background.mp3',
            },
            {
              name: 'bg_video_url',
              defaultValue: 'https://example.test/background.mp4',
            },
          ],
        },
      },
      pluginNode('191539', 'create_draft', [
        literalParameter('width', 1920, 'integer'),
        literalParameter('height', 1080, 'integer'),
      ]),
      pluginNode('162860', 'add_videos', [
        refParameter('video_infos', '134481', 'bg_video_data'),
        literalParameter('alpha', 0.5, 'float'),
      ]),
      pluginNode('195958', 'caption_infos', [
        literalParameter('keyword_color', 'ff0303'),
        literalParameter('font_size', 18, 'integer'),
      ]),
      {
        id: '130518',
        type: '21',
        blocks: [
          pluginNode('163288', 'add_captions', [
            refParameter('caption_infos', '195958', 'caption_infos'),
          ]),
        ],
        data: {
          nodeMeta: {
            title: 'loop',
          },
        },
      },
    ],
  },
});

describe('Coze workflow converter', () => {
  it('parses Coze clipboard JSON and flattens plugin nodes', () => {
    const parsed = parseCozeWorkflowClipboard(minimalWorkflow);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.workflowId).toBe('7629256239332032548');
    expect(parsed.spaceId).toBe('7523989714307907603');
    expect(parsed.nodes).toHaveLength(6);
    expect(parsed.pluginNodes.map((node) => node.apiName)).toEqual([
      'create_draft',
      'add_videos',
      'caption_infos',
      'add_captions',
    ]);
    expect(parsed.pluginNodes[0]).toMatchObject({
      id: '191539',
      apiName: 'create_draft',
      pluginID: '7522412867740565513',
      pluginName: '视频合成_剪映小助手',
    });
  });

  it('returns useful parse errors for invalid or unrelated input', () => {
    expect(parseCozeWorkflowClipboard('{bad json')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Invalid JSON'),
    });

    expect(parseCozeWorkflowClipboard(JSON.stringify({ type: 'not-coze' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('Coze workflow clipboard data'),
    });
  });

  it('converts a Coze workflow into a normalized landscape draft template', () => {
    const result = convertCozeWorkflowToDraftTemplate(minimalWorkflow, { name: '情感语录横屏' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.template).toMatchObject({
      id: 'coze-7629256239332032548',
      name: '情感语录横屏',
      isDefault: false,
      canvas: { width: 1920, height: 1080, ratio: '16:9' },
      image: { visible: true, ratio: '16:9', fit: 'cover' },
      caption: {
        visible: true,
        color: '#FFDE00',
        background: { color: '#000000' },
      },
    });
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'asset.bg_audio_url',
      'asset.bg_video_url',
      'caption.keyword_color',
    ]));
    expect(result.diagnostics.some((item) => item.message.includes('background.mp4'))).toBe(true);
  });

  it('warns about unsupported plugin APIs instead of silently guessing', () => {
    const workflow = JSON.stringify({
      type: 'coze-workflow-clipboard-data',
      source: { workflowId: 'wf-unsupported' },
      json: {
        nodes: [
          pluginNode('1', 'create_draft', [
            literalParameter('width', 1080, 'integer'),
            literalParameter('height', 1920, 'integer'),
          ]),
          pluginNode('2', 'mystery_jianying_api', []),
        ],
      },
    });

    const result = convertCozeWorkflowToDraftTemplate(workflow);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      level: 'warn',
      code: 'plugin.unsupported',
      nodeId: '2',
    }));
  });

  it('creates a draft-template shell for video workflows without a Jianying create_draft node', () => {
    const workflow = JSON.stringify({
      type: 'coze-workflow-clipboard-data',
      source: { workflowId: 'wf-seedance' },
      json: {
        nodes: [
          pluginNode('1', 'generate_video', [
            literalParameter('prompt', 'make a product promo'),
          ]),
        ],
      },
    });

    const result = convertCozeWorkflowToDraftTemplate(workflow, { name: 'Seedance promo' });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.template).toMatchObject({
      id: 'coze-wf-seedance',
      name: 'Seedance promo',
      isDefault: false,
      canvas: { width: 1080, height: 1920, ratio: '9:16' },
      image: { visible: false, ratio: '9:16' },
    });
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      level: 'warn',
      code: 'node.missing_create_draft',
    }));
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      level: 'warn',
      code: 'plugin.unsupported',
      apiName: 'generate_video',
    }));
  });

  it('converts the real pasted workflow fixture and detects its Jianying pipeline', async () => {
    const fixture = await readFile(join(__dirname, 'fixtures', 'coze-workflow-emotion-sample.json'), 'utf8');
    const parsed = parseCozeWorkflowClipboard(fixture);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.workflowId).toBe('7629256239332032548');
    expect(parsed.pluginNodes.map((node) => node.apiName)).toEqual(expect.arrayContaining([
      'create_draft',
      'add_videos',
      'add_audios',
      'add_effects',
      'add_images',
      'add_keyframes',
    ]));

    const result = convertCozeWorkflowToDraftTemplate(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.template.canvas).toMatchObject({ width: 1920, height: 1080, ratio: '16:9' });
    expect(result.template.id).toBe('coze-7629256239332032548');
    expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      'asset.bg_audio_url',
      'asset.bg_video_url',
      'pipeline.add_videos',
      'pipeline.add_audios',
      'pipeline.add_captions',
      'pipeline.add_effects',
      'pipeline.add_images',
      'pipeline.add_keyframes',
      'mapping.image_overlay',
      'mapping.keyframes',
    ]));
    expect(result.template.caption.visible).toBe(true);
    expect(result.template.audio.transitionDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('batch converts multiple copied workflow sources into template results', () => {
    const secondWorkflow = minimalWorkflow.replaceAll('7629256239332032548', '7629256239332032549');

    const results = convertManyCozeWorkflowsToDraftTemplates(`${minimalWorkflow}\n\n${secondWorkflow}`);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => (result.ok ? result.template.id : result.error))).toEqual([
      'coze-7629256239332032548',
      'coze-7629256239332032549',
    ]);
  });
});

function pluginNode(id: string, apiName: string, inputParameters: unknown[]) {
  return {
    id,
    type: '4',
    data: {
      nodeMeta: {
        title: apiName,
      },
      inputs: {
        apiParam: [
          apiParam('apiID', `${id}001`),
          apiParam('apiName', apiName),
          apiParam('pluginID', '7522412867740565513'),
          apiParam('pluginName', '视频合成_剪映小助手'),
        ],
        inputParameters,
      },
    },
  };
}

function apiParam(name: string, content: string) {
  return {
    name,
    input: {
      type: 'string',
      value: {
        type: 'literal',
        content,
      },
    },
  };
}

function literalParameter(name: string, content: unknown, type = 'string') {
  return {
    name,
    input: {
      type,
      value: {
        type: 'literal',
        content,
      },
    },
  };
}

function refParameter(name: string, blockID: string, outputName: string) {
  return {
    name,
    input: {
      type: 'string',
      value: {
        type: 'ref',
        content: {
          source: 'block-output',
          blockID,
          name: outputName,
        },
      },
    },
  };
}
