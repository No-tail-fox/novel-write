import { describe, expect, it } from 'vitest';
import { collectBenchmarkAccount, parseEmbeddedBenchmarkPosts, parseBilibiliArchivePayload } from '../electron/benchmark-sync';
import type { BenchmarkAccount } from '@shared/types';

const account: BenchmarkAccount = {
  id: 'group:bilibili',
  platform: 'bilibili',
  url: 'https://space.bilibili.com/12345',
  displayName: '',
  syncState: 'manual-only',
  lastSyncedAt: null,
  errorMessage: '',
};

describe('benchmark account connectors', () => {
  it('carries the persistent Electron session into Bilibili account requests', async () => {
    const credentials: RequestCredentials[] = [];
    const fetchImpl = async (url: string, init?: RequestInit): Promise<Response> => {
      credentials.push(init?.credentials ?? 'same-origin');
      if (url.includes('/x/web-interface/nav')) {
        return new Response(JSON.stringify({ code: 0, data: { wbi_img: { img_url: 'https://i.example/img.png', sub_url: 'https://i.example/sub.png' } } }), { status: 200 });
      }
      if (url.includes('/x/space/wbi/arc/search')) {
        return new Response(JSON.stringify({ code: 0, data: { list: { vlist: [{ bvid: 'BV1xx411c7mD', title: '测试作品', author: '测试账号', pic: 'https://i.example/cover.jpg', created: 1_700_000_000, length: '01:00', play: 10 }] } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: 0, data: { stat: { view: 10 } } }), { status: 200 });
    };

    const result = await collectBenchmarkAccount(account, fetchImpl);

    expect(result.syncState).toBe('ready');
    expect(result.posts).toHaveLength(1);
    expect(credentials.length).toBeGreaterThanOrEqual(2);
    expect(credentials.every((value) => value === 'include')).toBe(true);
  });

  it('normalizes Bilibili archive and detail metrics into traceable posts with covers', () => {
    const posts = parseBilibiliArchivePayload(account, {
      code: 0,
      data: {
        list: {
          vlist: [{
            bvid: 'BV1xx411c7mD',
            title: '昆明历史故事',
            author: '历史研究所',
            pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
            created: 1_700_000_000,
            length: '03:20',
            play: 12_000,
            video_review: 320,
          }],
        },
      },
    }, new Map([['BV1xx411c7mD', { stat: { view: 18_000, like: 1_700, reply: 81, favorite: 420, coin: 210, share: 95, danmaku: 350 } }]]), 1_700_000_100_000);

    expect(posts).toEqual([expect.objectContaining({
      platform: 'bilibili',
      sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
      coverUrl: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
      publishedAt: 1_700_000_000_000,
      durationSeconds: 200,
      metrics: expect.objectContaining({
        plays: { value: 18_000 },
        likes: { value: 1_700 },
        danmaku: { value: 350 },
      }),
      metricCapturedAt: 1_700_000_100_000,
    })]);
  });

  it('extracts real Douyin items from embedded page JSON without inventing source links', () => {
    const douyinAccount: BenchmarkAccount = { ...account, id: 'group:douyin', platform: 'douyin', url: 'https://www.douyin.com/user/MS4wLjABAAAA' };
    const payload = encodeURIComponent(JSON.stringify({
      aweme_list: [{
        aweme_id: '7520000000000000000',
        desc: '三分钟讲透苏东坡',
        author: { nickname: '历史研习社' },
        create_time: 1_700_000_000,
        video: { duration: 65_000, cover: { url_list: ['https://p3.douyinpic.com/cover.jpeg'] } },
        statistics: { play_count: 99_000, digg_count: 8_800, comment_count: 420, collect_count: 1_200, share_count: 650 },
      }],
    }));
    const html = `<html><script id="RENDER_DATA" type="application/json">${payload}</script></html>`;
    const posts = parseEmbeddedBenchmarkPosts(douyinAccount, html, 1_700_000_100_000);

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      sourceUrl: 'https://www.douyin.com/video/7520000000000000000',
      title: '三分钟讲透苏东坡',
      author: '历史研习社',
      coverUrl: 'https://p3.douyinpic.com/cover.jpeg',
      durationSeconds: 65,
      metrics: { plays: { value: 99_000 }, likes: { value: 8_800 }, comments: { value: 420 }, favorites: { value: 1_200 }, shares: { value: 650 } },
    });
  });
});
