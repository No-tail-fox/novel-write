import {
  fetchWithNetworkPolicy,
  NetworkPolicyError,
  type NetworkFetch,
  type NetworkPurpose,
} from './network-policy';
import { requireGenerationAuthorization } from './generation-authorization';

export interface FetchWithTimeoutOptions extends RequestInit {
  generation?: boolean;
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
    generation = false,
    timeoutMs = 120_000,
    timeoutLabel = 'Request',
    maxBytes,
    maxRedirects,
    allowPrivateNetwork = false,
    purpose = 'provider-api',
    fetchImpl,
    ...init
  } = options;
  if (generation) await requireGenerationAuthorization();
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
