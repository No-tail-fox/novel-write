import { describe, expect, it } from 'vitest';
import { buildImageLabBatchInputs, imageLabRetryInput } from '../src/features/labs/image-lab-helpers';
import type { ImageLabRecord } from '../src/shared/types';

describe('image lab batch and recovery helpers', () => {
  it('fans out every ratio and style by the requested per-combination quantity in stable order', () => {
    const inputs = buildImageLabBatchInputs({
      prompt: '宫殿里的双人播客',
      ratios: ['16:9', '9:16'],
      styles: ['photo-real', 'ink'],
      quantity: 2,
      provider: 'jimeng',
      resolution: '2K',
      smartMode: 'podcast-cover',
      referenceImagePaths: ['C:\\refs\\host.png'],
    });

    expect(inputs).toHaveLength(8);
    expect(inputs.map(({ ratio, style }) => `${ratio}/${style}`)).toEqual([
      '16:9/photo-real',
      '16:9/photo-real',
      '16:9/ink',
      '16:9/ink',
      '9:16/photo-real',
      '9:16/photo-real',
      '9:16/ink',
      '9:16/ink',
    ]);
    expect(inputs[0]).toMatchObject({
      provider: 'jimeng',
      resolution: '2K',
      smartMode: 'podcast-cover',
      referenceImagePath: 'C:\\refs\\host.png',
      referenceImagePaths: ['C:\\refs\\host.png'],
    });
  });

  it('deduplicates dimensions, clamps quantity, and always returns at least one request', () => {
    expect(buildImageLabBatchInputs({
      prompt: '测试',
      ratios: ['1:1', '1:1'],
      styles: ['ink', 'ink'],
      quantity: 20,
      provider: 'gpt_image',
      resolution: '1K',
      smartMode: 'text-to-image',
      referenceImagePaths: [],
    })).toHaveLength(10);

    expect(buildImageLabBatchInputs({
      prompt: '测试',
      ratios: [],
      styles: [],
      quantity: 0,
      provider: 'gpt_image',
      resolution: '1K',
      smartMode: 'text-to-image',
      referenceImagePaths: [],
    })).toHaveLength(1);
  });

  it('retries as a new attempt while preserving every generation parameter', () => {
    const record: ImageLabRecord = {
      id: 'failed-job',
      prompt: '保留人物，替换背景',
      ratio: '4:3',
      style: 'ancient-film',
      provider: 'custom',
      imagePath: '',
      status: 'failed',
      errorMessage: 'timeout',
      resolution: '4K',
      smartMode: 'reference-edit',
      referenceImagePaths: ['C:\\refs\\a.png', 'C:\\refs\\b.png'],
      referenceImagePath: 'C:\\refs\\a.png',
      upstreamTaskId: 'task-88',
      createdAt: '2026-07-30T00:00:00.000Z',
      finishedAt: '2026-07-30T00:01:00.000Z',
    };

    const input = imageLabRetryInput(record);

    expect(input).toEqual({
      prompt: record.prompt,
      ratio: record.ratio,
      style: record.style,
      provider: 'custom',
      resolution: record.resolution,
      smartMode: record.smartMode,
      referenceImagePath: record.referenceImagePath,
      referenceImagePaths: record.referenceImagePaths,
      upstreamTaskId: record.upstreamTaskId,
    });
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('createdAt');
  });
});
