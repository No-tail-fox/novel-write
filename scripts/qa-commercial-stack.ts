import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../services/platform-api/src/config';
import { poolFor, migrate, transaction } from '../services/platform-api/src/db';
import { buildApp } from '../services/platform-api/src/app';
import { seedDevelopment } from '../services/platform-api/src/fixture';
import { acceptPayment, completeRefund } from '../services/platform-api/src/payments';
import { reconcileWallets } from '../services/platform-api/src/wallet';
import { runOne } from '../services/platform-worker/src/worker';
import { createCommercialService } from '../electron/commercial-service';

// End-to-end with real HTTP, Ed25519 device proofs, the native client and a disposable PostgreSQL database.
// Never contacts SMS/payment/model providers. The operator fixture explicitly replaces only external adapters.
const databaseUrl = process.env.STORYDREAM_TEST_DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('STORYDREAM_TEST_DATABASE_URL must name an isolated loopback PostgreSQL instance.');
const admin = poolFor(databaseUrl), databaseName = 'storydream_e2e_' + randomUUID().replaceAll('-', '');
await admin.query(`CREATE DATABASE ${databaseName}`);
const testUrl = new URL(databaseUrl); testUrl.pathname = '/' + databaseName;
const pool = poolFor(testUrl.toString()), directory = await mkdtemp(join(tmpdir(), 'storydream-commercial-e2e-'));
const signing = generateKeyPairSync('ed25519'), encryptionKey = randomBytes(32);
// Only the test harness substitutes encryption; the shipped main process injects Electron safeStorage.
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); const bytes = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
  decryptString(value: Buffer) { const decipher = createDecipheriv('aes-256-gcm', encryptionKey, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(); },
};
const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: testUrl.toString(), PLATFORM_HOST: '127.0.0.1', PLATFORM_DEV_FIXTURES: '1', PLATFORM_PUBLIC_URL: 'http://127.0.0.1:4318', PLATFORM_TOKEN_SECRET: randomBytes(32).toString('hex'), PLATFORM_PEPPER: randomBytes(32).toString('hex'), PLATFORM_LICENSE_PRIVATE_KEY: signing.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), PLATFORM_ARTIFACT_DIRECTORY: join(directory, 'artifacts') });
const app = buildApp(config, pool);
const checks: string[] = [];
try {
  await migrate(pool); const seeded = await seedDevelopment(pool, config);
  const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
  const service = createCommercialService({ dataDir: join(directory, 'desktop'), appVersion: '1.0.0', baseUrl, allowInsecureLoopback: true, safeStorage, licensePublicKeys: { [config.licenseKeyId]: signing.publicKey.export({ type: 'spki', format: 'pem' }).toString() } });
  const challenge = await service.sendCode(seeded.phone);
  const signedIn = await service.login({ challengeId: challenge.challengeId, code: challenge.developmentCode! });
  assert.equal(signedIn.user?.id, seeded.userId); assert.equal(signedIn.wallet?.availableUnits, '1000000');
  const licensed = await service.redeem(seeded.activationCode);
  assert.equal(licensed.license?.status, 'active'); checks.push('device-signed phone login, activation and server wallet');
  const profile = { id: randomUUID(), name: '本地测试音乐', capability: 'music' as const, source: 'platform' as const, modelId: 'platform.music.development' };
  const saved = await service.saveModelProfile(profile); assert.equal(saved.active.music, undefined);
  await service.activateModelProfile(profile.id); checks.push('save does not activate; account profile explicitly activated');
  const input = { modelId: profile.modelId, operation: 'music.generate', params: { mode: 'description', description: 'A local fixture melody', instrumental: true, maxMode: false, variety: 0 } };
  const quote = await service.quote(input); assert.equal(quote.reservedUnits, '100000');
  const instrumental = await service.quote({ ...input, params: { mode: 'custom', instrumental: true, title: 'Instrumental fixture', style: 'soft piano', lyrics: '', variety: 0, maxMode: false } }); assert.equal(instrumental.reservedUnits, '100000');
  const max = await service.quote({ ...input, params: { ...input.params, maxMode: true } }); assert.equal(max.reservedUnits, '200000');
  const operationId = randomUUID();
  const [job, duplicate] = await Promise.all([service.submit({ quoteId: quote.id, operationId }), service.submit({ quoteId: quote.id, operationId })]);
  assert.equal(job.id, duplicate.id); assert.equal((await service.getSnapshot()).wallet?.reservedUnits, '100000');
  await runOne(pool, config);
  const completed = await service.getJob(job.id); assert.equal(completed.state, 'succeeded_settled'); assert.equal(completed.settledUnits, '100000'); assert.equal(completed.artifacts.length, 2);
  const downloaded = await service.downloadArtifact(completed.artifacts[0].id); assert.equal((await readFile(downloaded.path)).subarray(0, 4).toString(), 'RIFF');
  assert.equal((await service.getSnapshot()).wallet?.availableUnits, '900000'); checks.push('quote, Max pricing, duplicate submit, two candidates / one settlement and verified download');
  const fail = await service.quote({ ...input, params: { ...input.params, description: '[fixture:fail]' } });
  const failed = await service.submit({ quoteId: fail.id, operationId: randomUUID() }); await runOne(pool, config);
  assert.equal((await service.getJob(failed.id)).state, 'failed_released'); assert.equal((await service.getSnapshot()).wallet?.availableUnits, '900000'); checks.push('definitive failure releases reservation');
  const products = await service.listProducts(); const orderInput = { productId: products[0].id, version: products[0].version, operationId: randomUUID() };
  const order = await service.createOrder(orderInput), repeat = await service.createOrder(orderInput); assert.equal(order.id, repeat.id); assert.equal(order.status, 'payment_pending');
  const event = { eventId: 'fixture:' + order.id, orderId: order.id, tradeId: 'fixture:' + order.id, merchantId: 'development', appId: 'development', amountFen: order.amountFen, currency: 'CNY', state: 'SUCCESS' as const };
  await Promise.all(Array.from({ length: 10 }, () => transaction(pool, tx => acceptPayment(tx, config, 'fixture', event))));
  assert.equal((await service.getOrder(order.id)).status, 'credited'); assert.equal((await service.getSnapshot()).wallet?.availableUnits, '3900000');
  const refund = await service.requestRefund({ orderId: order.id, operationId: randomUUID() }); assert.equal(refund.status, 'refund_pending'); assert.equal((await service.getSnapshot()).wallet?.frozenUnits, '3000000');
  const refundRow = (await pool.query('SELECT id FROM refunds WHERE order_id=$1', [order.id])).rows[0];
  await transaction(pool, tx => completeRefund(tx, refundRow.id, 'fixture:' + refundRow.id, order.id));
  assert.equal((await service.getOrder(order.id)).status, 'refunded'); assert.equal((await service.getSnapshot()).wallet?.availableUnits, '900000'); checks.push('recharge idempotency, 10 duplicate payment notices, refund freeze and finalization');
  await service.logout(); assert.equal((await service.getSnapshot()).wallet, null);
  const secondChallenge = await service.sendCode('+8613900139000'); const second = await service.login({ challengeId: secondChallenge.challengeId, code: secondChallenge.developmentCode! });
  assert.equal(second.wallet?.availableUnits, '0'); assert.deepEqual(second.profiles, { profiles: [], active: {} });
  await assert.rejects(service.getJob(job.id)); await assert.rejects(service.getOrder(order.id)); await assert.rejects(service.downloadArtifact(completed.artifacts[0].id)); checks.push('account switch hides prior profiles, wallet, order, jobs and artifacts');
  assert.deepEqual(await transaction(pool, tx => reconcileWallets(tx)), []); checks.push('ledger rebuild matches wallet projections');
  console.log(JSON.stringify({ passed: checks.length, checks, externalProviderRequests: 0 }, null, 2));
} finally {
  await app.close(); await pool.end(); await admin.query(`DROP DATABASE ${databaseName}`); await admin.end(); await rm(directory, { recursive: true, force: true });
}
