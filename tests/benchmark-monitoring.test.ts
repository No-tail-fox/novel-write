import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  benchmarkOpportunityTotal,
  classifyBenchmarkUrl,
  normalizeBenchmarkSourceUrl,
  scoreBenchmarkPost,
} from '@shared/benchmark-monitoring';
import { FileDatabase } from '@shared/storage';
import type { BenchmarkPost } from '@shared/types';

describe('benchmark monitoring domain', () => {
  it('classifies account and post links for Douyin, WeChat Channels, and Bilibili', () => {
    expect(classifyBenchmarkUrl('https://www.douyin.com/user/MS4wLjABAAAA')).toMatchObject({ platform: 'douyin', kind: 'account' });
    expect(classifyBenchmarkUrl('https://www.douyin.com/video/7520000000000000000')).toMatchObject({ platform: 'douyin', kind: 'post' });
    expect(classifyBenchmarkUrl('https://channels.weixin.qq.com/web/pages/profile/abc')).toMatchObject({ platform: 'wechat-channels', kind: 'account' });
    expect(classifyBenchmarkUrl('https://channels.weixin.qq.com/s/abc123')).toMatchObject({ platform: 'wechat-channels', kind: 'post' });
    expect(classifyBenchmarkUrl('https://space.bilibili.com/12345')).toMatchObject({ platform: 'bilibili', kind: 'account' });
    expect(classifyBenchmarkUrl('https://www.bilibili.com/video/BV1xx411c7mD')).toMatchObject({ platform: 'bilibili', kind: 'post' });
    expect(classifyBenchmarkUrl('https://example.com/video/1')).toEqual({ platform: 'unknown', kind: 'unknown' });
  });

  it('normalizes source links without preserving tracking parameters or fragments', () => {
    expect(normalizeBenchmarkSourceUrl('https://SPACE.bilibili.com/12345/?spm_id_from=333#reply')).toBe('https://space.bilibili.com/12345');
  });

  it('scores a strong post against its peers and keeps missing metrics explicit', () => {
    const peers: BenchmarkPost[] = Array.from({ length: 10 }, (_, index) => makePost({
      id: `peer-${index}`,
      metrics: {
        likes: { value: 100 + index * 10 },
        comments: { value: 10 + index },
        favorites: { value: 8 + index },
        shares: { value: 4 + index },
        plays: { value: null, reason: '平台未公开播放量' },
      },
    }));
    const strong = makePost({
      id: 'strong',
      platform: 'douyin',
      tags: ['传统文化'],
      metrics: {
        likes: { value: 1800 },
        comments: { value: 260 },
        favorites: { value: 420 },
        shares: { value: 190 },
        plays: { value: null, reason: '平台未公开播放量' },
      },
      snapshots: [
        { capturedAt: 1_000, metrics: { likes: { value: 400 }, comments: { value: 60 } } },
        { capturedAt: 3_601_000, metrics: { likes: { value: 1800 }, comments: { value: 260 } } },
      ],
    });
    const result = scoreBenchmarkPost(strong, [...peers, strong]);

    expect(result.score).not.toBeNull();
    expect(result.score ?? 0).toBeGreaterThan(70);
    expect(result.components.accountPercentile).toBeGreaterThan(90);
    expect(strong.metrics.plays).toEqual({ value: null, reason: '平台未公开播放量' });
    expect(result.explanation).toContain('账号内');
  });

  it('calculates the explainable selection opportunity total', () => {
    expect(benchmarkOpportunityTotal({ demand: 90, gap: 80, fit: 70, conversion: 60, executionEase: 50 })).toBe(75);
  });
});

describe('benchmark monitoring storage', () => {
  it('persists groups and posts, updates metrics as snapshots, and cascades group deletion', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storydream-benchmark-monitoring-'));
    const db = await FileDatabase.open(join(dir, 'app.db'));
    try {
      const group = await db.upsertBenchmarkGroup({
        name: '传统文化矩阵',
        track: '传统文化',
        tags: ['图书', '历史'],
        refreshPolicy: 'manual',
        accounts: [
          { platform: 'douyin', url: 'https://www.douyin.com/user/MS4wLjABAAAA', displayName: '抖音账号' },
          { platform: 'wechat-channels', url: 'https://channels.weixin.qq.com/web/pages/profile/abc', displayName: '视频号账号' },
          { platform: 'bilibili', url: 'https://space.bilibili.com/12345', displayName: 'B站账号' },
        ],
      });

      expect(group.accounts).toHaveLength(3);
      expect(group.accounts.every((account) => account.syncState === 'manual-only')).toBe(true);
      expect(await db.listBenchmarkGroups()).toEqual([group]);

      const post = await db.upsertBenchmarkPost({
        groupId: group.id,
        platform: 'bilibili',
        sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
        title: '昆明历史故事',
        author: '历史研究所',
        publishedAt: 1_700_000_000_000,
        tags: ['历史'],
        metrics: {
          plays: { value: 12_000 },
          likes: { value: 1_200 },
          coins: { value: 210 },
          comments: { value: null, reason: '本次导入未提供' },
        },
        metricCapturedAt: 1_700_000_100_000,
      });
      expect(post.snapshots).toHaveLength(1);

      const updated = await db.upsertBenchmarkPost({
        id: post.id,
        groupId: group.id,
        platform: 'bilibili',
        sourceUrl: post.sourceUrl,
        title: post.title,
        metrics: { plays: { value: 18_000 }, likes: { value: 1_700 } },
        metricCapturedAt: 1_700_003_700_000,
      });
      expect(updated.snapshots).toHaveLength(2);
      expect((await db.listBenchmarkPosts(group.id))[0].metrics.plays?.value).toBe(18_000);

      const synchronized = await db.applyBenchmarkAccountSync({
        groupId: group.id,
        accountId: `${group.id}:bilibili`,
        syncState: 'ready',
        displayName: '历史研究所',
        errorMessage: '',
        syncedAt: 1_700_007_300_000,
        posts: [{
          groupId: group.id,
          platform: 'bilibili',
          sourceUrl: post.sourceUrl,
          title: post.title,
          author: '历史研究所',
          accountUrl: 'https://space.bilibili.com/12345',
          coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
          metrics: { plays: { value: 22_000 }, likes: { value: 2_100 } },
          metricCapturedAt: 1_700_007_300_000,
        }],
      });
      expect(synchronized.importedCount).toBe(0);
      expect(synchronized.updatedCount).toBe(1);
      expect(synchronized.group.accounts.find((account) => account.platform === 'bilibili')).toMatchObject({
        displayName: '历史研究所',
        syncState: 'ready',
        lastSyncedAt: 1_700_007_300_000,
        errorMessage: '',
      });
      expect(synchronized.posts[0].snapshots).toHaveLength(3);

      await db.deleteBenchmarkGroup(group.id);
      expect(await db.listBenchmarkGroups()).toEqual([]);
      expect(await db.listBenchmarkPosts()).toEqual([]);
    } finally {
      await db.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function makePost(overrides: Partial<BenchmarkPost>): BenchmarkPost {
  return {
    id: 'post',
    groupId: 'group',
    platform: 'douyin',
    sourceUrl: 'https://www.douyin.com/video/7520000000000000000',
    title: '作品',
    author: '账号',
    accountUrl: '',
    coverUrl: '',
    publishedAt: 1_700_000_000_000,
    durationSeconds: null,
    transcript: '',
    tags: ['传统文化'],
    metrics: { likes: { value: 1 }, comments: { value: 0 } },
    snapshots: [],
    isFavorite: false,
    workflowStatus: 'new',
    note: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}
