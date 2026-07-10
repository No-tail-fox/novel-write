import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { Agent, type Dispatcher } from 'undici';

export type NetworkPurpose = 'public-research' | 'ima-api' | 'ima-document' | 'provider-api';

export interface NetworkPolicy {
  allowPrivate: boolean;
  allowLoopback: boolean;
  allowedSchemes: readonly string[];
  maxRedirects: number;
  maxBytes: number;
  timeoutMs: number;
  allowedRequestHeaders: readonly string[];
}

export interface NetworkAddress {
  address: string;
  family: 4 | 6;
}

export type NetworkLookup = (hostname: string) => Promise<readonly NetworkAddress[]>;
export type NetworkFetch = (url: string, init?: RequestInit & { dispatcher?: Dispatcher }) => Promise<Response>;

export interface NetworkPolicyOverrides {
  allowPrivate?: boolean;
  allowLoopback?: boolean;
  maxRedirects?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

export interface NetworkFetchOptions extends RequestInit, NetworkPolicyOverrides {
  purpose: NetworkPurpose;
  fetchImpl?: NetworkFetch;
  lookup?: NetworkLookup;
}

export interface PinnedLookup {
  resolve: () => Promise<readonly NetworkAddress[]>;
  nodeLookup: LookupFunction;
}

const MiB = 1024 * 1024;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const forbiddenRequestHeaders = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const sensitiveRedirectHeaders = new Set([
  'authorization',
  'cookie',
  'ima-openapi-apikey',
  'ima-openapi-clientid',
  'proxy-authorization',
  'x-api-key',
  'x-cos-security-token',
  'x-ima-signature',
  'x-signature',
]);

const policyProfiles: Record<NetworkPurpose, NetworkPolicy> = {
  'public-research': {
    allowPrivate: false,
    allowLoopback: false,
    allowedSchemes: ['http:', 'https:'],
    maxRedirects: 4,
    maxBytes: 2 * MiB,
    timeoutMs: 15_000,
    allowedRequestHeaders: ['accept', 'accept-language', 'user-agent'],
  },
  'ima-api': {
    allowPrivate: false,
    allowLoopback: false,
    allowedSchemes: ['https:'],
    maxRedirects: 2,
    maxBytes: 2 * MiB,
    timeoutMs: 20_000,
    allowedRequestHeaders: [
      'accept',
      'accept-language',
      'content-type',
      'ima-openapi-apikey',
      'ima-openapi-clientid',
      'user-agent',
    ],
  },
  'ima-document': {
    allowPrivate: false,
    allowLoopback: false,
    allowedSchemes: ['http:', 'https:'],
    maxRedirects: 4,
    maxBytes: 8 * MiB,
    timeoutMs: 20_000,
    allowedRequestHeaders: [
      'accept',
      'accept-language',
      'authorization',
      'range',
      'user-agent',
      'x-cos-security-token',
      'x-date',
      'x-ima-signature',
      'x-signature',
    ],
  },
  'provider-api': {
    allowPrivate: false,
    allowLoopback: true,
    allowedSchemes: ['http:', 'https:'],
    maxRedirects: 3,
    maxBytes: 64 * MiB,
    timeoutMs: 120_000,
    allowedRequestHeaders: [
      'accept',
      'accept-language',
      'anthropic-version',
      'authorization',
      'content-type',
      'range',
      'user-agent',
      'x-api-key',
      'x-api-request-id',
      'x-api-resource-id',
      'x-app-id',
      'x-content-sha256',
      'x-date',
      'x-resource-id',
      'x-security-token',
      'x-signature',
      'x-timestamp',
    ],
  },
};

export class NetworkPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkPolicyError';
  }
}

export function getNetworkPolicy(purpose: NetworkPurpose, overrides: NetworkPolicyOverrides = {}): NetworkPolicy {
  const profile = policyProfiles[purpose];
  return {
    ...profile,
    allowPrivate: purpose === 'provider-api' ? overrides.allowPrivate ?? profile.allowPrivate : profile.allowPrivate,
    allowLoopback: purpose === 'provider-api' ? overrides.allowLoopback ?? profile.allowLoopback : profile.allowLoopback,
    maxRedirects: overrides.maxRedirects ?? profile.maxRedirects,
    maxBytes: overrides.maxBytes ?? profile.maxBytes,
    timeoutMs: overrides.timeoutMs ?? profile.timeoutMs,
  };
}

export function assertNetworkUrl(
  input: string | URL,
  purpose: NetworkPurpose,
  overrides: NetworkPolicyOverrides = {},
): URL {
  const policy = getNetworkPolicy(purpose, overrides);
  return assertUrlAgainstPolicy(input, purpose, policy);
}

export function createPinnedLookup(
  input: string | URL,
  policy: NetworkPolicy,
  lookup: NetworkLookup = defaultNetworkLookup,
): PinnedLookup {
  const url = parseUrl(input);
  const hostname = normalizedHostname(url);
  let resolution: Promise<readonly NetworkAddress[]> | null = null;

  const resolve = (): Promise<readonly NetworkAddress[]> => {
    resolution ??= resolveAndValidate(hostname, url, policy, lookup);
    return resolution;
  };

  const nodeLookup = ((requestedHost: string, rawOptions: unknown, rawCallback?: unknown) => {
    const callback = (typeof rawOptions === 'function' ? rawOptions : rawCallback) as ((...args: unknown[]) => void) | undefined;
    if (!callback) throw new TypeError('DNS lookup callback is required.');
    if (normalizeHostname(requestedHost) !== hostname) {
      callback(networkError('NETWORK_DNS_HOST_MISMATCH', `Pinned DNS lookup rejected unexpected host ${requestedHost}.`));
      return;
    }
    const options = typeof rawOptions === 'object' && rawOptions !== null
      ? rawOptions as { all?: boolean; family?: number }
      : { family: typeof rawOptions === 'number' ? rawOptions : 0 };
    void resolve().then(
      (addresses) => {
        const requestedFamily = options.family === 4 || options.family === 6 ? options.family : 0;
        const matching = requestedFamily ? addresses.filter((entry) => entry.family === requestedFamily) : addresses;
        if (matching.length === 0) {
          callback(networkError('NETWORK_DNS_NO_ADDRESS', `No approved DNS address is available for ${hostname}.`));
          return;
        }
        if (options.all) {
          callback(null, matching.map((entry) => ({ ...entry })));
          return;
        }
        callback(null, matching[0].address, matching[0].family);
      },
      (error) => callback(error),
    );
  }) as LookupFunction;

  return { resolve, nodeLookup };
}

export async function fetchWithNetworkPolicy(input: string | URL, options: NetworkFetchOptions): Promise<Response> {
  const {
    purpose,
    fetchImpl = dynamicFetch,
    lookup,
    allowPrivate,
    allowLoopback,
    maxRedirects,
    maxBytes,
    timeoutMs,
    signal,
    ...requestInit
  } = options;
  const policy = getNetworkPolicy(purpose, {
    allowPrivate,
    allowLoopback,
    maxRedirects,
    maxBytes,
    timeoutMs,
  });
  let currentUrl = assertUrlAgainstPolicy(input, purpose, policy);
  const providerStartedLocal = purpose === 'provider-api' && isExplicitLocalTarget(currentUrl);
  let method = (requestInit.method ?? 'GET').toUpperCase();
  let body = requestInit.body;
  let headers = filterRequestHeaders(requestInit.headers, policy);
  let redirects = 0;
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason ?? networkError('NETWORK_ABORTED', 'Network request aborted.'));
  const timer = setTimeout(
    () => controller.abort(networkError('NETWORK_TIMEOUT', `Network request timed out after ${policy.timeoutMs}ms.`)),
    policy.timeoutMs,
  );
  timer.unref?.();
  signal?.addEventListener('abort', abortFromParent, { once: true });

  try {
    if (signal?.aborted) abortFromParent();
    while (true) {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      currentUrl = assertUrlAgainstPolicy(currentUrl, purpose, policy);
      const pinned = createPinnedLookup(currentUrl, policy, lookup ?? defaultNetworkLookup);
      if (lookup) await pinned.resolve();
      const dispatcher = new Agent({
        connect: {
          lookup: pinned.nodeLookup,
          timeout: Math.min(30_000, policy.timeoutMs),
        },
      });
      let response: Response;
      try {
        const init: RequestInit & { dispatcher?: Dispatcher } = {
          ...requestInit,
          method,
          headers,
          body: method === 'GET' || method === 'HEAD' ? undefined : body,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
        };
        response = await fetchImpl(currentUrl.href, init);
        if (redirectStatuses.has(response.status) && response.headers.has('location')) {
          await response.body?.cancel().catch(() => undefined);
          if (redirects >= policy.maxRedirects) {
            throw networkError('NETWORK_TOO_MANY_REDIRECTS', `Network request exceeded ${policy.maxRedirects} redirects.`);
          }
          const nextUrl = assertUrlAgainstPolicy(new URL(response.headers.get('location')!, currentUrl), purpose, policy);
          if (purpose === 'provider-api' && !providerStartedLocal && isExplicitLocalTarget(nextUrl)) {
            throw networkError(
              'NETWORK_REDIRECT_LOCAL_BLOCKED',
              'A public provider request must not redirect to a loopback or private network target.',
            );
          }
          const sameOrigin = nextUrl.origin === currentUrl.origin;
          headers = headersForRedirect(headers, policy, sameOrigin);
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            method = 'GET';
            body = undefined;
            headers.delete('content-type');
          }
          currentUrl = nextUrl;
          redirects += 1;
          continue;
        }

        const bytes = await readResponseBytesBounded(response, policy.maxBytes, controller);
        return rebuildResponse(response, bytes, currentUrl.href, redirects > 0);
      } catch (error) {
        if (controller.signal.aborted) throw abortReason(controller.signal);
        throw error;
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function readTextBounded(response: Response, maxBytes: number): Promise<string> {
  const bytes = await readResponseBytesBounded(response, maxBytes);
  return new TextDecoder().decode(bytes);
}

export async function readJsonBounded<T = unknown>(response: Response, maxBytes: number): Promise<T> {
  const text = await readTextBounded(response, maxBytes);
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw networkError(
      'NETWORK_INVALID_JSON',
      `Network response did not contain valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function assertUrlAgainstPolicy(input: string | URL, purpose: NetworkPurpose, policy: NetworkPolicy): URL {
  const url = parseUrl(input);
  if (!policy.allowedSchemes.includes(url.protocol)) {
    throw networkError('NETWORK_SCHEME_BLOCKED', `Network scheme ${url.protocol || '(none)'} is not allowed for ${purpose}.`);
  }
  if (url.username || url.password) {
    throw networkError('NETWORK_CREDENTIALS_BLOCKED', 'Network URLs must not contain user credentials.');
  }
  const hostname = normalizedHostname(url);
  if (!hostname) throw networkError('NETWORK_HOST_REQUIRED', 'Network target host is required.');
  if (purpose === 'ima-api' && hostname !== 'ima.qq.com') {
    throw networkError('NETWORK_IMA_HOST_BLOCKED', `IMA API target host ${hostname} is not allowed.`);
  }
  if (isLocalhostName(hostname)) {
    assertAddressKind('loopback', hostname, url, policy);
    return url;
  }
  if (isIP(hostname)) {
    assertAddressAllowed(hostname, url, policy);
  }
  return url;
}

async function resolveAndValidate(
  hostname: string,
  url: URL,
  policy: NetworkPolicy,
  lookup: NetworkLookup,
): Promise<readonly NetworkAddress[]> {
  if (isIP(hostname)) {
    const family = isIP(hostname) as 4 | 6;
    assertAddressAllowed(hostname, url, policy);
    return [{ address: hostname, family }];
  }
  const addresses = await lookup(hostname);
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw networkError('NETWORK_DNS_NO_ADDRESS', `DNS returned no address for ${hostname}.`);
  }
  const normalized = addresses.map((entry) => normalizeAddress(entry, hostname));
  for (const entry of normalized) assertAddressAllowed(entry.address, url, policy);
  return normalized;
}

async function defaultNetworkLookup(hostname: string): Promise<readonly NetworkAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({ address: entry.address, family: entry.family as 4 | 6 }));
}

function normalizeAddress(entry: NetworkAddress, hostname: string): NetworkAddress {
  const family = isIP(entry.address);
  if ((family !== 4 && family !== 6) || (entry.family !== 4 && entry.family !== 6) || family !== entry.family) {
    throw networkError('NETWORK_DNS_INVALID_ADDRESS', `DNS returned an invalid address for ${hostname}.`);
  }
  return { address: stripIpv6Brackets(entry.address.toLowerCase()), family };
}

type AddressKind = 'public' | 'private' | 'loopback' | 'blocked';

function assertAddressAllowed(address: string, url: URL, policy: NetworkPolicy): void {
  const normalized = stripIpv6Brackets(address.toLowerCase());
  const family = isIP(normalized);
  if (family !== 4 && family !== 6) {
    throw networkError('NETWORK_ADDRESS_INVALID', `Network address ${address} is invalid.`);
  }
  const kind = family === 4 ? classifyIpv4(normalized) : classifyIpv6(normalized);
  assertAddressKind(kind, normalized, url, policy);
}

function assertAddressKind(kind: AddressKind, address: string, url: URL, policy: NetworkPolicy): void {
  if (kind === 'loopback' && !policy.allowLoopback) {
    throw networkError('NETWORK_LOOPBACK_BLOCKED', `Loopback network target ${address} is blocked.`);
  }
  if (kind === 'private' && !policy.allowPrivate) {
    throw networkError('NETWORK_PRIVATE_BLOCKED', `Private network target ${address} is blocked.`);
  }
  if (kind === 'blocked') {
    throw networkError('NETWORK_ADDRESS_BLOCKED', `Reserved network target ${address} is blocked.`);
  }
  if (url.protocol === 'http:' && policy.allowLoopback && kind === 'public') {
    throw networkError('NETWORK_PROVIDER_HTTPS_REQUIRED', 'Public provider API targets must use HTTPS.');
  }
}

function classifyIpv4(address: string): AddressKind {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 'blocked';
  const [a, b] = parts;
  if (a === 127) return 'loopback';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (
    a === 0
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 192 && b === 0 && parts[2] === 0)
    || (a === 192 && b === 88 && parts[2] === 99)
    || (a === 192 && b === 0 && parts[2] === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && parts[2] === 100)
    || (a === 203 && b === 0 && parts[2] === 113)
    || a >= 224
  ) return 'blocked';
  return 'public';
}

function classifyIpv6(address: string): AddressKind {
  const groups = parseIpv6Groups(address);
  if (!groups) return 'blocked';
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return 'loopback';
  if (groups.every((group) => group === 0)) return 'blocked';

  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isCompatible = groups.slice(0, 6).every((group) => group === 0);
  if (isMapped || isCompatible) {
    const ipv4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return classifyIpv4(ipv4);
  }

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return 'private';
  if ((first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return 'blocked';
  if (first < 0x2000 || first > 0x3fff) return 'blocked';
  if (first === 0x2002) return 'blocked';
  if (first === 0x2001) {
    const second = groups[1];
    if (second === 0 || second === 2 || second === 0x0db8) return 'blocked';
    if ((second & 0xfff0) === 0x0010 || (second & 0xfff0) === 0x0020) return 'blocked';
  }
  if (first === 0x3fff && (groups[1] & 0xf000) === 0) return 'blocked';
  return 'public';
}

function parseIpv6Groups(address: string): number[] | null {
  let value = stripIpv6Brackets(address.split('%')[0].toLowerCase());
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    if (separator < 0) return null;
    const ipv4 = value.slice(separator + 1).split('.').map(Number);
    if (ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = `${value.slice(0, separator)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const raw = halves.length === 2 ? [...left, ...Array.from({ length: missing }, () => '0'), ...right] : left;
  if (raw.length !== 8 || raw.some((group) => !/^[0-9a-f]{1,4}$/u.test(group))) return null;
  return raw.map((group) => Number.parseInt(group, 16));
}

function filterRequestHeaders(input: HeadersInit | undefined, policy: NetworkPolicy): Headers {
  const output = new Headers();
  const headers = new Headers(input);
  for (const [name, value] of headers.entries()) {
    const normalized = name.toLowerCase();
    if (forbiddenRequestHeaders.has(normalized)) continue;
    if (!headerIsAllowed(normalized, policy.allowedRequestHeaders)) continue;
    output.set(name, value);
  }
  return output;
}

function headersForRedirect(headers: Headers, policy: NetworkPolicy, sameOrigin: boolean): Headers {
  const output = filterRequestHeaders(headers, policy);
  if (!sameOrigin) {
    for (const name of sensitiveRedirectHeaders) output.delete(name);
  }
  return output;
}

function headerIsAllowed(name: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized.endsWith('*') ? name.startsWith(normalized.slice(0, -1)) : name === normalized;
  });
}

async function readResponseBytesBounded(
  response: Response,
  maxBytes: number,
  controller?: AbortController,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw networkError('NETWORK_INVALID_BYTE_LIMIT', 'Network response byte limit must be a positive safe integer.');
  }
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = networkError('NETWORK_RESPONSE_TOO_LARGE', `Network response exceeds the ${maxBytes} byte limit.`);
    controller?.abort(error);
    await response.body?.cancel(error).catch(() => undefined);
    throw error;
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        const error = networkError('NETWORK_RESPONSE_TOO_LARGE', `Network response exceeds the ${maxBytes} byte limit.`);
        controller?.abort(error);
        await reader.cancel(error).catch(() => undefined);
        throw error;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function rebuildResponse(response: Response, bytes: Uint8Array, url: string, redirected: boolean): Response {
  const body = bytes.byteLength > 0 ? Uint8Array.from(bytes).buffer : null;
  const rebuilt = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  Object.defineProperties(rebuilt, {
    redirected: { configurable: true, value: redirected },
    url: { configurable: true, value: url },
  });
  return rebuilt;
}

function parseUrl(input: string | URL): URL {
  try {
    return input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    throw networkError('NETWORK_URL_INVALID', 'Network target URL is invalid.');
  }
}

function normalizedHostname(url: URL): string {
  return normalizeHostname(url.hostname);
}

function normalizeHostname(hostname: string): string {
  return stripIpv6Brackets(hostname.trim().toLowerCase().replace(/\.$/u, ''));
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function isLocalhostName(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost');
}

function isExplicitLocalTarget(url: URL): boolean {
  const hostname = normalizedHostname(url);
  if (isLocalhostName(hostname)) return true;
  const family = isIP(hostname);
  if (family === 4) {
    const kind = classifyIpv4(hostname);
    return kind === 'loopback' || kind === 'private';
  }
  if (family === 6) {
    const kind = classifyIpv6(hostname);
    return kind === 'loopback' || kind === 'private';
  }
  return false;
}

function dynamicFetch(url: string, init?: RequestInit & { dispatcher?: Dispatcher }): Promise<Response> {
  return fetch(url, init);
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return networkError('NETWORK_ABORTED', typeof signal.reason === 'string' ? signal.reason : 'Network request aborted.');
}

function networkError(code: string, message: string): NetworkPolicyError & NodeJS.ErrnoException {
  return new NetworkPolicyError(code, message) as NetworkPolicyError & NodeJS.ErrnoException;
}
