import { createHash, createPrivateKey, sign } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalDocument } from '../electron/platform-update-service';
import type { UpdateManifest } from '../src/shared/commercial-contract';

// Run in the release environment after Authenticode/package production; never distribute this private key.
const [packagePath, metadataPath, outputPath] = process.argv.slice(2);
if (!packagePath || !metadataPath || !outputPath) throw new Error('Usage: tsx scripts/sign-commercial-release.ts <complete-package> <metadata.json> <manifest.json>');
if (resolve(outputPath) === resolve(packagePath) || resolve(outputPath) === resolve(metadataPath)) throw new Error('Output must be a new manifest file.');
const privatePem = process.env.STORYDREAM_RELEASE_PRIVATE_KEY;
if (!privatePem) throw new Error('STORYDREAM_RELEASE_PRIVATE_KEY is required in the release environment.');
const privateKey = createPrivateKey(privatePem);
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Release manifest key must be Ed25519.');
const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as Omit<UpdateManifest, 'signature' | 'size' | 'sha256'>;
const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
if (!version.test(metadata.version) || !version.test(metadata.minAppVersion) || !['stable', 'beta'].includes(metadata.channel) || !['win32', 'darwin', 'linux'].includes(metadata.platform) || !['x64', 'arm64'].includes(metadata.arch) || !metadata.keyId || typeof metadata.releaseNotes !== 'string' || !Number.isFinite(Date.parse(metadata.publishedAt))) throw new Error('Invalid release metadata.');
if (metadata.channel === 'stable' && metadata.version.includes('-')) throw new Error('Stable release must not be a prerelease.');
const url = new URL(metadata.url);
if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Release package URL must be trusted HTTPS.');
const info = await stat(packagePath);
if (!info.isFile() || !info.size || info.size > 8 * 1024 ** 3) throw new Error('Invalid package size.');
const hash = createHash('sha256'); for await (const chunk of createReadStream(packagePath)) hash.update(chunk);
const payload = { version: metadata.version, platform: metadata.platform, arch: metadata.arch, channel: metadata.channel, publishedAt: metadata.publishedAt, releaseNotes: metadata.releaseNotes, url: metadata.url, minAppVersion: metadata.minAppVersion, keyId: metadata.keyId, size: info.size, sha256: hash.digest('hex') };
const manifest = { ...payload, signature: sign(null, Buffer.from(canonicalDocument(payload)), privateKey).toString('base64') };
await writeFile(outputPath, JSON.stringify(manifest, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
console.log('Signed release manifest created; no package uploaded or release published.');
