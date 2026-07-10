import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  assertNetworkUrl,
  createPinnedLookup,
  fetchWithNetworkPolicy,
  getNetworkPolicy,
  readTextBounded,
  type NetworkAddress,
  type NetworkLookup,
} from '@shared/network-policy';

const publicPolicy = getNetworkPolicy('public-research');

describe('purpose-bound network policy', () => {
  it.each([
    'http://127.0.0.1/',
    'http://127.255.255.254/',
    'http://10.0.0.1/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://192.168.1.1/',
    'http://192.0.2.1/',
    'http://198.18.0.1/',
    'http://198.51.100.1/',
    'http://203.0.113.1/',
    'http://224.0.0.1/',
    'http://240.0.0.1/',
    'http://[::1]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[ff02::1]/',
    'http://[2001:db8::1]/',
    'http://[::ffff:127.0.0.1]/',
  ])('rejects non-public target %s for public research', (url) => {
    expect(() => assertNetworkUrl(url, 'public-research')).toThrow(/network|address|target|blocked|禁止/i);
  });

  it.each([
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://user:password@example.com/',
    'file:///C:/Windows/win.ini',
    'data:text/plain,secret',
    'gopher://example.com/',
  ])('rejects encoded, credentialed, or unsupported URL %s', (url) => {
    expect(() => assertNetworkUrl(url, 'public-research')).toThrow();
  });

  it('allows provider loopback HTTP but requires explicit permission for private LAN addresses', () => {
    expect(assertNetworkUrl('http://127.0.0.1:11434/v1', 'provider-api').href).toBe('http://127.0.0.1:11434/v1');
    expect(assertNetworkUrl('http://localhost:11434/v1', 'provider-api').hostname).toBe('localhost');
    expect(() => assertNetworkUrl('http://192.168.1.20:8000/v1', 'provider-api')).toThrow(/private|network|address|blocked|禁止/i);
    expect(
      assertNetworkUrl('http://192.168.1.20:8000/v1', 'provider-api', { allowPrivate: true }).href,
    ).toBe('http://192.168.1.20:8000/v1');
    expect(() => assertNetworkUrl('http://8.8.8.8/v1', 'provider-api')).toThrow(/https|http|secure|禁止/i);
  });

  it('does not let overrides enable private targets for public or IMA document purposes', () => {
    expect(() => assertNetworkUrl('http://192.168.1.20/doc', 'public-research', { allowPrivate: true })).toThrow();
    expect(() => assertNetworkUrl('http://127.0.0.1/doc', 'public-research', { allowLoopback: true })).toThrow();
    expect(() => assertNetworkUrl('http://192.168.1.20/doc', 'ima-document', { allowPrivate: true })).toThrow();
  });

  it('does not let runtime overrides expand a purpose scheme allowlist', () => {
    expect(() =>
      assertNetworkUrl(
        'ftp://example.com/archive',
        'public-research',
        { allowedSchemes: ['ftp:'] } as never,
      )).toThrow(/scheme|allowed|禁止/i);
  });

  it.each(['https://8.8.8.8/', 'https://192.0.8.1/', 'https://192.88.1.1/', 'https://[2606:4700:4700::1111]/'])(
    'does not over-block globally routable address %s',
    (url) => {
      expect(assertNetworkUrl(url, 'public-research').href).toBe(url);
    },
  );

  it('rejects private DNS results before connection', async () => {
    const lookup: NetworkLookup = async () => [{ address: '169.254.169.254', family: 4 }];
    const pinned = createPinnedLookup('https://metadata-attacker.example/', publicPolicy, lookup);

    await expect(pinned.resolve()).rejects.toThrow(/network|address|target|blocked|禁止/i);
  });

  it('pins the first validated DNS answer for every lookup in one request', async () => {
    let resolutions = 0;
    const lookup: NetworkLookup = async (): Promise<NetworkAddress[]> => {
      resolutions += 1;
      return resolutions === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }];
    };
    const pinned = createPinnedLookup('https://rebind.example/', publicPolicy, lookup);

    expect(await pinned.resolve()).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(await pinned.resolve()).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(resolutions).toBe(1);
  });

  it('uses the pinned lookup for a real provider connection', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('pinned connection');
    });
    const port = await listenOnSafeTestPort(server);
    let resolutions = 0;
    try {
      const response = await fetchWithNetworkPolicy(`http://rebind.example:${port}/health`, {
        purpose: 'provider-api',
        lookup: async () => {
          resolutions += 1;
          return resolutions === 1
            ? [{ address: '127.0.0.1', family: 4 }]
            : [{ address: '169.254.169.254', family: 4 }];
        },
      });

      expect(await readTextBounded(response, 64)).toBe('pinned connection');
      expect(resolutions).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects a redirect to a private target before issuing the second request', async () => {
    const requested: string[] = [];
    const fetchImpl = async (url: string) => {
      requested.push(url);
      return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } });
    };

    await expect(
      fetchWithNetworkPolicy('https://public.example/start', {
        purpose: 'public-research',
        fetchImpl,
      }),
    ).rejects.toThrow(/network|address|target|blocked|禁止/i);
    expect(requested).toEqual(['https://public.example/start']);
  });

  it('allows a directly configured loopback provider but rejects a public provider redirect to loopback', async () => {
    const requested: string[] = [];
    await expect(
      fetchWithNetworkPolicy('https://provider.example/v1', {
        purpose: 'provider-api',
        fetchImpl: async (url) => {
          requested.push(url);
          if (requested.length === 1) {
            return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1:11434/v1' } });
          }
          return new Response('{}', { status: 200 });
        },
      }),
    ).rejects.toThrow(/redirect|loopback|private|target|blocked|禁止/i);
    expect(requested).toEqual(['https://provider.example/v1']);

    const localResponse = await fetchWithNetworkPolicy('http://127.0.0.1:11434/v1', {
      purpose: 'provider-api',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    expect(await readTextBounded(localResponse, 16)).toBe('{}');
  });

  it('strips credentials and signature headers after a cross-origin redirect', async () => {
    const requests: Array<{ url: string; headers: Headers }> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      requests.push({ url, headers: new Headers(init?.headers) });
      if (requests.length === 1) {
        return new Response(null, { status: 307, headers: { Location: 'https://cdn.example/final' } });
      }
      return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    };

    const response = await fetchWithNetworkPolicy('https://origin.example/start', {
      purpose: 'ima-document',
      fetchImpl,
      headers: {
        Accept: 'text/plain',
        Authorization: 'Bearer document-token',
        Cookie: 'session=secret',
        'Proxy-Authorization': 'Basic secret',
        'X-Ima-Signature': 'signed',
      },
    });

    expect(await readTextBounded(response, 16)).toBe('ok');
    expect(requests).toHaveLength(2);
    expect(requests[0].headers.get('authorization')).toBe('Bearer document-token');
    expect(requests[0].headers.get('x-ima-signature')).toBe('signed');
    expect(requests[0].headers.get('cookie')).toBeNull();
    expect(requests[0].headers.get('proxy-authorization')).toBeNull();
    expect(requests[1].headers.get('accept')).toBe('text/plain');
    expect(requests[1].headers.get('authorization')).toBeNull();
    expect(requests[1].headers.get('x-ima-signature')).toBeNull();
  });

  it('limits redirect hops', async () => {
    let calls = 0;
    const fetchImpl = async (url: string) => {
      calls += 1;
      return new Response(null, { status: 302, headers: { Location: new URL(`/hop-${calls}`, url).href } });
    };

    await expect(
      fetchWithNetworkPolicy('https://public.example/start', {
        purpose: 'public-research',
        fetchImpl,
        maxRedirects: 2,
      }),
    ).rejects.toThrow(/redirect/i);
    expect(calls).toBe(3);
  });

  it('cancels a streamed response as soon as the byte limit is exceeded', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.enqueue(Uint8Array.from([4, 5, 6]));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      fetchWithNetworkPolicy('https://public.example/large', {
        purpose: 'public-research',
        fetchImpl: async () => new Response(body, { status: 200 }),
        maxBytes: 5,
      }),
    ).rejects.toThrow(/byte|large|limit|大小|上限/i);
    expect(cancelled).toBe(true);
  });

  it('restricts the IMA API profile to its fixed HTTPS host', async () => {
    let called = false;
    await expect(
      fetchWithNetworkPolicy('https://evil.example/openapi/wiki/v1/search_knowledge', {
        purpose: 'ima-api',
        fetchImpl: async () => {
          called = true;
          return new Response('{}');
        },
      }),
    ).rejects.toThrow(/IMA|host|target|禁止/i);
    expect(called).toBe(false);
  });
});

async function listenOnSafeTestPort(server: ReturnType<typeof createServer>): Promise<number> {
  for (let port = 18080; port <= 18120; port += 1) {
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => reject(error);
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', onError);
          resolve();
        });
      });
      return (server.address() as AddressInfo).port;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error('No safe local test port is available.');
}
