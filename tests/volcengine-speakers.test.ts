import { describe, expect, it, vi } from 'vitest';
import { listVolcengineSpeakers } from '@shared/volcengine-speakers';

describe('volcengine speaker list', () => {
  it('signs and parses the ListSpeakers OpenAPI request', async () => {
    const requests: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({
        ResponseMetadata: {
          RequestId: 'speaker-request-id',
          Action: 'ListSpeakers',
          Version: '2025-05-20',
          Service: 'speech_saas_prod',
          Region: 'cn-beijing',
        },
        Result: {
          Total: 1,
          Speakers: [
            {
              VoiceType: 'zh_female_tianmeitaozi_mars_bigtts',
              Name: '甜美桃子',
              Gender: '女',
              Age: '青年',
              NormalLabels: ['多语种'],
            },
          ],
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await listVolcengineSpeakers(
      {
        accessKeyId: 'ak-test',
        secretAccessKey: 'sk-test',
        resourceId: 'seed-tts-2.0',
        limit: 30,
      },
      { fetchImpl, now: new Date('2026-01-05T07:23:05Z') },
    );

    expect(result.status).toBe('pass');
    expect(result.total).toBe(1);
    expect(result.speakers).toEqual([
      {
        voiceType: 'zh_female_tianmeitaozi_mars_bigtts',
        name: '甜美桃子',
        gender: '女',
        age: '青年',
        labels: ['多语种'],
        avatar: '',
      },
    ]);
    expect(requests[0].url).toBe('https://open.volcengineapi.com/?Action=ListSpeakers&Version=2025-05-20');
    expect(requests[0].headers.get('X-Date')).toBe('20260105T072305Z');
    expect(requests[0].headers.get('Authorization')).toContain('Credential=ak-test/20260105/cn-beijing/speech_saas_prod/request');
    expect(requests[0].headers.get('Authorization')).toContain('SignedHeaders=host;x-content-sha256;x-date');
    expect(requests[0].body).toMatchObject({
      ResourceIDs: ['seed-tts-2.0'],
      Page: 1,
      Limit: '30',
    });
  });

  it('returns a fail result when OpenAPI credentials are missing', async () => {
    const result = await listVolcengineSpeakers({
      accessKeyId: '',
      secretAccessKey: '',
      resourceId: 'seed-tts-2.0',
    });

    expect(result.status).toBe('fail');
    expect(result.speakers).toEqual([]);
    expect(result.detail).toContain('AccessKey ID');
  });
});
