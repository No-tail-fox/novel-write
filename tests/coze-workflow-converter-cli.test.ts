import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FileDatabase } from '@shared/storage';

const execFileAsync = promisify(execFile);

describe('Coze workflow converter CLI', () => {
  it('exposes an npm script for repeated Coze workflow conversion', async () => {
    const packageJson = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['convert:coze']).toBe('node scripts/convert-coze-workflows.mjs');
  });

  it('converts copied workflow files into a draft template JSON bundle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-coze-cli-'));
    const inputPath = join(dir, 'workflow.json');
    const outputPath = join(dir, 'draft-templates.json');

    try {
      await writeFile(inputPath, minimalWorkflowSource('7629256239332032548'), 'utf8');

      const { stdout } = await execFileAsync('node', [
        'scripts/convert-coze-workflows.mjs',
        '--out',
        outputPath,
        inputPath,
      ], { cwd: join(__dirname, '..') });

      const payload = JSON.parse(await readFile(outputPath, 'utf8')) as {
        templates: Array<{ id: string; canvas: { ratio: string } }>;
        diagnostics: unknown[];
      };

      expect(stdout).toContain('Converted 1 Coze workflow');
      expect(payload.templates).toHaveLength(1);
      expect(payload.templates[0]).toMatchObject({
        id: 'coze-7629256239332032548',
        canvas: { ratio: '16:9' },
      });
      expect(payload.diagnostics.length).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts a positional output bundle path for npm-run argument forwarding', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-coze-cli-positional-'));
    const inputPath = join(dir, 'workflow.json');
    const outputPath = join(dir, 'draft-templates.json');

    try {
      await writeFile(inputPath, minimalWorkflowSource('7629256239332032550'), 'utf8');

      await execFileAsync('node', [
        'scripts/convert-coze-workflows.mjs',
        outputPath,
        inputPath,
      ], { cwd: join(__dirname, '..') });

      const payload = JSON.parse(await readFile(outputPath, 'utf8')) as {
        templates: Array<{ id: string }>;
      };

      expect(payload.templates[0]?.id).toBe('coze-7629256239332032550');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('recursively converts workflow source directories and names templates from files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-coze-cli-dir-'));
    const sourceDir = join(dir, 'sources');
    const nestedDir = join(sourceDir, 'nested');
    const outputPath = join(dir, 'draft-templates.json');

    try {
      await mkdir(nestedDir, { recursive: true });
      await writeFile(join(sourceDir, '情感混剪.txt'), minimalWorkflowSource('7629256239332032551'), 'utf8');
      await writeFile(join(nestedDir, 'TK悬疑视频.json'), minimalWorkflowSource('7629256239332032552'), 'utf8');

      const { stdout } = await execFileAsync('node', [
        'scripts/convert-coze-workflows.mjs',
        '--out',
        outputPath,
        sourceDir,
      ], { cwd: join(__dirname, '..') });

      const payload = JSON.parse(await readFile(outputPath, 'utf8')) as {
        templates: Array<{ id: string; name: string }>;
        sources: Array<{ inputPath: string; status: string }>;
      };

      expect(stdout).toContain('Converted 2 Coze workflow');
      expect(payload.templates.map((template) => template.id)).toEqual([
        'coze-7629256239332032551',
        'coze-7629256239332032552',
      ]);
      expect(payload.templates.map((template) => template.name)).toEqual(['情感混剪', 'TK悬疑视频']);
      expect(payload.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'converted', workflowId: '7629256239332032551' }),
        expect.objectContaining({ status: 'converted', workflowId: '7629256239332032552' }),
      ]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('installs converted workflow templates into a Storybound database when requested', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storybound-coze-cli-install-'));
    const inputPath = join(dir, '每日学中药.txt');
    const outputPath = join(dir, 'draft-templates.json');
    const dbPath = join(dir, 'data.db');

    try {
      await writeFile(inputPath, minimalWorkflowSource('7629256239332032553'), 'utf8');

      const { stdout } = await execFileAsync('node', [
        'scripts/convert-coze-workflows.mjs',
        '--out',
        outputPath,
        '--install-db',
        dbPath,
        inputPath,
      ], { cwd: join(__dirname, '..') });

      const db = await FileDatabase.open(dbPath);
      const state = await db.getState();
      const imported = state.draftTemplates.find((template) => template.id === 'coze-7629256239332032553');
      await db.close();

      expect(stdout).toContain('Installed 1 template');
      expect(imported).toMatchObject({
        id: 'coze-7629256239332032553',
        name: '每日学中药',
        isDefault: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function minimalWorkflowSource(workflowId: string): string {
  return JSON.stringify({
    type: 'coze-workflow-clipboard-data',
    source: { workflowId },
    json: {
      nodes: [
        {
          id: 'create',
          type: '4',
          data: {
            inputs: {
              apiParam: [
                apiParam('apiName', 'create_draft'),
                apiParam('pluginID', '7522412867740565513'),
                apiParam('pluginName', 'jianying-helper'),
              ],
              inputParameters: [
                literalParameter('width', 1920),
                literalParameter('height', 1080),
              ],
            },
          },
        },
      ],
    },
  });
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

function literalParameter(name: string, content: unknown) {
  return {
    name,
    input: {
      type: typeof content === 'number' ? 'integer' : 'string',
      value: {
        type: 'literal',
        content,
      },
    },
  };
}
