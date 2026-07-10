import {
  fetchWithNetworkPolicy,
  NetworkPolicyError,
  type NetworkFetch,
  type NetworkPurpose,
} from './network-policy';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs?: number;
  timeoutLabel?: string;
  maxBytes?: number;
  maxRedirects?: number;
  allowPrivateNetwork?: boolean;
  purpose?: NetworkPurpose;
  fetchImpl?: NetworkFetch;
}

export async function fetchWithTimeout(url: string | URL, options: FetchWithTimeoutOptions = {}): Promise<Response> {
  const {
    timeoutMs = 120_000,
    timeoutLabel = 'Request',
    maxBytes,
    maxRedirects,
    allowPrivateNetwork = false,
    purpose = 'provider-api',
    fetchImpl,
    ...init
  } = options;
  try {
    return await fetchWithNetworkPolicy(url, {
      ...init,
      purpose,
      timeoutMs,
      maxBytes,
      maxRedirects,
      allowPrivate: allowPrivateNetwork,
      fetchImpl,
    });
  } catch (error) {
    if (error instanceof NetworkPolicyError && error.code === 'NETWORK_TIMEOUT') {
      throw new Error(`${timeoutLabel} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  }
}
