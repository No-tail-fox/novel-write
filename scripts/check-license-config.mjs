import { readFile } from 'node:fs/promises';
import { createPublicKey, X509Certificate } from 'node:crypto';

const config = JSON.parse(await readFile(new URL('../config/license-public.json', import.meta.url), 'utf8'));
if (!config.baseUrl || !config.caPem || !config.signingPublicKey) {
  console.error('Licensing is not configured. Deploy the service and import its client-public.json as config/license-public.json before packaging.');
  process.exit(1);
}
const url = new URL(config.baseUrl);
if (config.schemaVersion !== 1 || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid licensing service URL.');
const ca = new X509Certificate(config.caPem);
if (!ca.ca || Date.parse(ca.validFrom) > Date.now() || Date.parse(ca.validTo) <= Date.now() || createPublicKey(config.signingPublicKey).asymmetricKeyType !== 'ed25519') throw new Error('Invalid licensing trust configuration.');
console.log('Licensing configuration verified.');
