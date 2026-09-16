import { createHash, randomUUID, sign } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import {
  capabilities, commercialProfileSchema, quoteInputSchema, unitsSchema, unconfiguredSnapshot,
  type CommercialApi, type CommercialProfiles, type CommercialSnapshot,
} from '../src/shared/commercial-contract';
import { AuthVault, emptyProfiles, parseAuthSession, type AuthSafeStorage, type AuthSession, type AuthVaultState } from './auth-vault';
import { createPlatformUpdateService, saveVerifiedDownload } from './platform-update-service';
import { createLicenseService } from './license-service';

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/).refine((value) => !['.', '..', '__proto__', 'constructor', 'prototype'].includes(value));
const date = z.string().datetime({ offset: true });
const userSchema = z.object({ id: identifier, displayName: z.string().max(100), phone: z.string().max(32) });
const walletSchema = z.object({ availableUnits: unitsSchema, reservedUnits: unitsSchema, frozenUnits: unitsSchema, revision: unitsSchema });
const licenseSchema = z.object({ id: identifier, plan: z.string().max(100), status: z.enum(['active', 'expired', 'inactive']), expiresAt: date.nullable(), deviceLimit: z.number().int().min(0).max(1000), features: z.array(z.string().max(100)).max(100), lease: z.string().max(20000).optional() });
const catalogSchema = z.array(z.object({ id: identifier, name: z.string().max(200), capability: z.enum(capabilities), operation: z.string().max(100), priceUnits: unitsSchema, unit: z.string().max(100), status: z.enum(['available', 'unconfigured', 'disabled']), version: z.string().max(128), description: z.string().max(2000) })).max(1000);
const publicSchema = z.object({ environment: z.enum(['development', 'production']), paymentAvailable: z.boolean(), catalog: catalogSchema });
const snapshotSchema = z.object({ user: userSchema, wallet: walletSchema, license: licenseSchema.nullable(), devices: z.array(z.object({ id: identifier, name: z.string().max(200), current: z.boolean(), lastSeenAt: date })).max(1000) });
const artifactSchema = z.object({ id: identifier, name: z.string().min(1).max(255), mime: z.string().max(128), size: z.number().int().positive().max(2 * 1024 ** 3), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const jobSchema = z.object({ id: identifier, modelId: identifier, state: z.enum(['reserved', 'submitting', 'submission_unknown', 'running', 'awaiting_delivery', 'succeeded_settled', 'failed_released', 'cancelled_released']), reservedUnits: unitsSchema, settledUnits: unitsSchema, createdAt: date, message: z.string().max(2000).optional(), artifacts: z.array(artifactSchema).max(1000) });
const orderSchema = z.object({ id: identifier, amountFen: unitsSchema, creditUnits: unitsSchema, status: z.enum(['payment_pending', 'credited', 'expired', 'refund_pending', 'refunded']), paymentUrl: z.string().url().max(4096).optional(), expiresAt: date, createdAt: date });
const productSchema = z.array(z.object({ id: identifier, version: z.string().min(1).max(128), name: z.string().max(200), amountFen: unitsSchema, creditUnits: unitsSchema })).max(100);
const quoteSchema = z.object({ id: identifier, modelId: identifier, operation: z.string().max(100), reservedUnits: unitsSchema, expiresAt: date, description: z.string().max(2000) });
const transactionSchema = z.array(z.object({ id: identifier, kind: z.string().max(100), referenceId: z.string().max(128), description: z.string().max(1000), availableDelta: z.string().regex(/^-?(0|[1-9]\d{0,24})$/), reservedDelta: z.string().regex(/^-?(0|[1-9]\d{0,24})$/), createdAt: date })).max(10000);
const challengeSchema = z.object({ challengeId: identifier, expiresAt: date, retryAfter: z.number().int().min(0).max(86400), developmentCode: z.string().max(20).optional() });

const errors: Record<string, string> = {
  AUTH_REQUIRED: '请先登录账号。', SESSION_REVOKED: '会话已失效，请重新登录。', ACCOUNT_RESTRICTED: '账号暂时不能使用平台服务。', LICENSE_REQUIRED: '需要有效软件授权。', DEVICE_LIMIT_REACHED: '设备数量已达到授权上限。', LEASE_EXPIRED: '授权需要联网刷新。', INSUFFICIENT_CREDITS: '可用积分不足。', QUOTE_EXPIRED: '报价已过期，请重新获取。', QUOTE_INPUT_CHANGED: '生成参数已改变，请重新获取报价。', MODEL_UNAVAILABLE: '此平台模型当前不可用。', IDEMPOTENCY_CONFLICT: '该操作编号已用于其他请求。', PAYMENT_UNAVAILABLE: '支付服务尚未配置。', INVALID_CODE: '验证码或激活码无效。', RATE_LIMITED: '请求过于频繁，请稍后重试。', PAYMENT_PENDING: '支付结果仍在确认中。', FORBIDDEN: '没有权限访问该资源。', NOT_FOUND: '资源不存在或不属于当前账号。', VALIDATION_ERROR: '请求参数无效。', INVALID_OTP: '验证码无效或已过期。', DEVICE_PROOF_INVALID: '设备验证失败，请检查系统时间。', REFUND_NOT_ALLOWED: '此订单暂时不符合退款条件。', CODE_INVALID: '激活码无效或已经使用。', SERVICE_UNAVAILABLE: '服务暂时不可用。',
};
class ServiceError extends Error { constructor(readonly status: number, readonly code: string) { super(`${code}: ${errors[code] ?? '平台请求失败，请稍后重试。'}`); } }
function parse<T>(schema: z.ZodType<T>, input: unknown): T { try { return schema.parse(input); } catch { throw new Error('PLATFORM_RESPONSE_INVALID: 服务返回的数据格式无效。'); } }
function copy<T>(input: T): T { return structuredClone(input); }

export interface CommercialServiceOptions {
  dataDir: string; baseUrl?: string; appVersion: string; safeStorage: AuthSafeStorage;
  fetchImpl?: typeof fetch; getActiveTaskCount?: () => number | Promise<number>;
  openPath?: (path: string) => Promise<string | void>; updatePublicKeys?: Record<string, string>; licensePublicKeys?: Record<string, string>;
  allowedDownloadOrigins?: string[]; allowInsecureLoopback?: boolean;
}
/** Main-process only. No method returns a bearer token or accepts an arbitrary destination. */
export function createCommercialService(options: CommercialServiceOptions): CommercialApi & { getLocalModelContext(): Promise<{ userId: string | null; profiles: CommercialProfiles }> } {
  let baseUrl = '', configurationError = '';
  if (options.baseUrl?.trim()) {
    try {
      const parsed = new URL(options.baseUrl.trim());
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.protocol !== 'https:' && !(options.allowInsecureLoopback && local && parsed.protocol === 'http:'))) throw new Error('Insecure service');
      baseUrl = parsed.toString().replace(/\/$/, '').replace(/\/v1$/, '');
    } catch { configurationError = '账号服务地址必须使用 HTTPS；本地开发地址需要显式启用。'; }
  }
  const vault = new AuthVault(join(options.dataDir, 'auth.v1.json'), options.safeStorage);
  let state: AuthVaultState | undefined;
  let initialization: Promise<void> | undefined;
  let epoch = 0;
  let refreshFlight: { epoch: number; promise: Promise<void> } | undefined;
  let profilesFlight: Promise<void> = Promise.resolve();
  const fetchImpl = options.fetchImpl ?? fetch;
  const licensing = createLicenseService({ publicKeys: options.licensePublicKeys });
  function configured(): void { if (!baseUrl) throw new Error(`PLATFORM_UNCONFIGURED: ${configurationError || '尚未配置账号服务。'}`); }
  async function init(): Promise<AuthVaultState> {
    configured(); initialization ??= vault.load(baseUrl).then((loaded) => { state = loaded; });
    await initialization; return state!;
  }
  function assertEpoch(captured: number): void { if (captured !== epoch) throw new Error('ACCOUNT_CHANGED: 账号已切换，已丢弃旧请求结果。'); }
  function session(captured: number): AuthSession { assertEpoch(captured); if (!state?.session) throw new ServiceError(401, 'AUTH_REQUIRED'); return state.session; }
  function profileSet(): CommercialProfiles { return state?.session ? copy(state.profiles[state.session.userId] ?? emptyProfiles()) : emptyProfiles(); }
  async function raw(path: string, method: string, body: unknown, captured: number, authenticated: boolean, idempotencyKey?: string): Promise<Response> {
    configured(); assertEpoch(captured);
    if (!state) throw new Error('AUTH_NOT_INITIALIZED');
    const payload = body === undefined ? '' : JSON.stringify(body);
    const url = new URL(`${baseUrl}/v1${path}`), timestamp = Date.now().toString(), nonce = randomUUID();
    const bodyHash = createHash('sha256').update(payload).digest('hex');
    const proof = [method, url.pathname + url.search, timestamp, nonce, bodyHash].join('\n');
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Device-Id': state!.installation.id, 'X-Device-Timestamp': timestamp, 'X-Device-Nonce': nonce, 'X-Device-Signature': sign(null, Buffer.from(proof), state!.installation.privateKey).toString('base64') };
    if (path.startsWith('/artifacts/')) { headers.Accept = 'application/octet-stream'; headers['Accept-Encoding'] = 'identity'; }
    if (payload) headers['Content-Type'] = 'application/json';
    if (authenticated) headers.Authorization = `Bearer ${session(captured).accessToken}`;
    if (idempotencyKey) headers['Idempotency-Key'] = identifier.parse(idempotencyKey);
    let response: Response;
    try { response = await fetchImpl(url.toString(), { method, body: payload || undefined, headers, redirect: 'error', signal: AbortSignal.timeout(120000) }); }
    catch { assertEpoch(captured); throw new Error('PLATFORM_NETWORK_ERROR: 无法连接账号服务，请检查网络。'); }
    assertEpoch(captured); return response;
  }
  async function json(response: Response): Promise<unknown> {
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > 4 * 1024 ** 2) throw new Error('PLATFORM_RESPONSE_TOO_LARGE');
    const chunks: Uint8Array[] = []; let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 4 * 1024 ** 2) { await reader.cancel(); throw new Error('PLATFORM_RESPONSE_TOO_LARGE'); } chunks.push(part.value); }
      } finally { reader.releaseLock(); }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    let value: unknown;
    try { value = text ? JSON.parse(text) : null; } catch { throw new Error('PLATFORM_RESPONSE_INVALID'); }
    if (!response.ok) {
      const code = (value as { error?: { code?: unknown } } | null)?.error?.code;
      throw new ServiceError(response.status, typeof code === 'string' && Object.hasOwn(errors, code) ? code : `HTTP_${response.status}`);
    }
    return value;
  }
  async function refresh(captured: number): Promise<void> {
    assertEpoch(captured);
    if (refreshFlight?.epoch === captured) return refreshFlight.promise;
    const previous = session(captured);
    const promise = (async () => {
      const operationId = state!.pendingRefreshOperationId ?? randomUUID();
      state!.pendingRefreshOperationId = operationId; await vault.save(state!); assertEpoch(captured);
      const response = await raw('/auth/refresh', 'POST', { refreshToken: previous.refreshToken }, captured, false, operationId);
      const next = parseAuthSession(await json(response)); assertEpoch(captured);
      if (next.userId !== previous.userId || (previous.deviceId && next.deviceId !== previous.deviceId)) throw new Error('AUTH_IDENTITY_MISMATCH');
      state!.session = next; delete state!.pendingRefreshOperationId; await vault.save(state!); assertEpoch(captured);
    })();
    refreshFlight = { epoch: captured, promise };
    try { await promise; }
    catch (error) {
      if (captured === epoch && error instanceof ServiceError && (error.status === 401 || error.status === 403)) { state!.session = null; delete state!.pendingRefreshOperationId; delete state!.offlineLicense; epoch++; await vault.save(state!); }
      throw error;
    } finally { if (refreshFlight?.promise === promise) refreshFlight = undefined; }
  }
  async function request(path: string, method = 'GET', body?: unknown, authenticated = true, idempotencyKey?: string, captured = epoch): Promise<unknown> {
    await init(); assertEpoch(captured);
    if (authenticated && Date.parse(session(captured).expiresAt) <= Date.now() + 30000) await refresh(captured);
    const tokenBefore = authenticated ? session(captured).accessToken : undefined;
    let response = await raw(path, method, body, captured, authenticated, idempotencyKey);
    if (authenticated && response.status === 401) {
      await response.body?.cancel();
      if (session(captured).accessToken === tokenBefore) await refresh(captured);
      response = await raw(path, method, body, captured, true, idempotencyKey);
    }
    try { const value = await json(response); assertEpoch(captured); return value; }
    catch (error) {
      // A connected server denial always invalidates cached offline rights. Never fall back on 401/403.
      if (captured === epoch && authenticated && error instanceof ServiceError && (error.status === 401 || ['SESSION_REVOKED', 'ACCOUNT_RESTRICTED', 'LICENSE_REQUIRED', 'LEASE_EXPIRED'].includes(error.code))) { delete state!.offlineLicense; await vault.save(state!); }
      throw error;
    }
  }
  const updater = createPlatformUpdateService({ ...options, getManifest: (channel) => request(`/updates/check?version=${encodeURIComponent(options.appVersion)}&platform=${process.platform}&arch=${process.arch}&channel=${channel}`, 'GET', undefined, false) });

  async function getSnapshot(): Promise<CommercialSnapshot> {
    if (!baseUrl) return unconfiguredSnapshot(configurationError || undefined);
    await init(); const captured = epoch;
    const authenticated = Boolean(state!.session);
    const [publicResult, privateResult] = await Promise.allSettled([
      request('/public/config', 'GET', undefined, false, undefined, captured),
      authenticated ? request('/me/snapshot', 'GET', undefined, true, undefined, captured) : Promise.resolve(null),
    ]);
    assertEpoch(captured);
    const networkFailure = (error: unknown) => error instanceof Error && error.message.startsWith('PLATFORM_NETWORK_ERROR:');
    // Authentication and authorization errors take precedence over a public endpoint outage.
    if (privateResult.status === 'rejected' && !networkFailure(privateResult.reason)) throw privateResult.reason;
    if (publicResult.status === 'rejected' && !networkFailure(publicResult.reason)) throw publicResult.reason;
    const publicData = publicResult.status === 'fulfilled' ? parse(publicSchema, publicResult.value) : null;
    const privateData = privateResult.status === 'fulfilled' && authenticated ? parse(snapshotSchema, privateResult.value) : null;
    if (privateData) {
      if (privateData.user.id !== session(captured).userId) throw new Error('AUTH_IDENTITY_MISMATCH');
      const currentDevice = privateData.devices.filter((device) => device.current);
      if (privateData.license?.status === 'active' && privateData.license.lease && licensing.configured() && currentDevice.length === 1) {
        try {
          state!.offlineLicense = licensing.acceptOnline({ user: privateData.user, license: privateData.license, environment: publicData?.environment ?? state!.offlineLicense?.environment ?? 'production', deviceId: currentDevice[0].id, publicKey: state!.installation.publicKey, previous: state!.offlineLicense });
        } catch (error) { delete state!.offlineLicense; await vault.save(state!); assertEpoch(captured); throw error; }
      } else delete state!.offlineLicense;
      await vault.save(state!); assertEpoch(captured);
      return { configured: true, serviceUrl: baseUrl, environment: publicData?.environment ?? state!.offlineLicense?.environment ?? 'production', catalog: publicData?.catalog ?? [], paymentAvailable: publicData?.paymentAvailable ?? false, ...privateData, authenticated: true, profiles: profileSet(), ...(!publicData ? { message: '账号权益已同步，平台模型目录暂时无法读取。' } : {}) };
    }
    if (publicResult.status === 'rejected' || privateResult.status === 'rejected') {
      const cached = state!.offlineLicense;
      if (cached && state!.session?.userId === cached.user.id && licensing.configured()) {
        const offline = licensing.readOffline(cached, { userId: state!.session.userId, deviceId: cached.deviceId, publicKey: state!.installation.publicKey });
        state!.offlineLicense = offline.cache; await vault.save(state!); assertEpoch(captured);
        return { configured: true, serviceUrl: baseUrl, environment: cached.environment, authenticated: true, user: copy(cached.user), license: offline.license, wallet: null, devices: [], catalog: [], profiles: profileSet(), paymentAvailable: false, message: offline.message };
      }
      throw privateResult.status === 'rejected' ? privateResult.reason : publicResult.status === 'rejected' ? publicResult.reason : new Error('PLATFORM_NETWORK_ERROR');
    }
    return { configured: true, serviceUrl: baseUrl, ...publicData!, authenticated: false, user: null, wallet: null, license: null, devices: [], profiles: emptyProfiles() };
  }
  async function mutateProfiles(change: (profiles: CommercialProfiles) => void): Promise<CommercialProfiles> {
    await init(); const captured = epoch, account = session(captured).userId;
    let result: CommercialProfiles;
    const operation = profilesFlight.catch(() => {}).then(async () => {
      assertEpoch(captured); const profiles = profileSet(); change(profiles);
      state!.profiles[account] = profiles; await vault.save(state!); assertEpoch(captured); result = copy(profiles);
    });
    profilesFlight = operation; await operation; return result!;
  }
  const idPath = (id: string) => encodeURIComponent(identifier.parse(id));
  async function refreshSnapshotAfter(path: string, method: string, body?: unknown): Promise<CommercialSnapshot> {
    const captured = epoch; await request(path, method, body, true, randomUUID(), captured); assertEpoch(captured); return getSnapshot();
  }
  async function listJobs() { return parse(z.array(jobSchema).max(1000), await request('/jobs')); }
  const api: CommercialApi = {
    getSnapshot,
    async sendCode(phone) {
      const normalized = z.string().trim().regex(/^\+?[1-9]\d{6,14}$/).parse(phone);
      const result = parse(challengeSchema, await request('/auth/challenges', 'POST', { phone: normalized }, false));
      // Production never exposes development OTPs, even if a misconfigured service returns one.
      if (!options.allowInsecureLoopback || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(baseUrl).hostname)) delete result.developmentCode;
      return result;
    },
    async login(input) {
      await init(); const captured = ++epoch;
      state!.session = null; delete state!.pendingRefreshOperationId; delete state!.offlineLicense; await vault.save(state!); assertEpoch(captured);
      const valid = z.object({ challengeId: identifier, code: z.string().regex(/^\d{4,10}$/) }).strict().parse(input);
      const device = { installationId: state!.installation.id, publicKey: state!.installation.publicKey, name: hostname().slice(0, 100), platform: process.platform, appVersion: options.appVersion };
      const next = parseAuthSession(await request('/auth/verify', 'POST', { ...valid, device }, false, randomUUID(), captured));
      assertEpoch(captured); state!.session = next; await vault.save(state!); assertEpoch(captured); return getSnapshot();
    },
    async logout() {
      await init(); const previous = state!.session, captured = epoch;
      // Initiate revocation before clearing the local session; local logout never waits for network success.
      const revocation = previous ? raw('/auth/logout', 'POST', undefined, captured, true, randomUUID()).then((response) => response.body?.cancel()).catch(() => {}) : Promise.resolve();
      epoch++; state!.session = null; delete state!.pendingRefreshOperationId; delete state!.offlineLicense; await vault.save(state!); void revocation;
      return { configured: true, serviceUrl: baseUrl, environment: options.allowInsecureLoopback ? 'development' : 'production', authenticated: false, user: null, wallet: null, license: null, devices: [], catalog: [], profiles: emptyProfiles(), paymentAvailable: false };
    },
    updateProfile: (displayName) => refreshSnapshotAfter('/me', 'PATCH', { displayName: z.string().trim().min(1).max(100).parse(displayName) }),
    redeem: (code) => refreshSnapshotAfter('/licenses/redeem', 'POST', { code: z.string().trim().min(4).max(256).parse(code) }),
    async unbindDevice(id) {
      const path = `/me/devices/${idPath(id)}/binding`; await init(); const captured = epoch;
      const current = session(captured).deviceId ?? state!.offlineLicense?.deviceId;
      await request(path, 'DELETE', undefined, true, randomUUID(), captured); assertEpoch(captured);
      return current === id ? api.logout() : getSnapshot();
    },
    async listTransactions() { return parse(transactionSchema, await request('/wallet/transactions')); },
    async listProducts() { return parse(productSchema, await request('/recharge/products')); },
    async createOrder(input) { const data = z.object({ productId: identifier, version: z.string().min(1).max(128), operationId: identifier }).strict().parse(input); return parse(orderSchema, await request('/recharge/orders', 'POST', { productId: data.productId, version: data.version }, true, data.operationId)); },
    async getOrder(id) { return parse(orderSchema, await request(`/recharge/orders/${idPath(id)}`)); },
    async requestRefund(input) { return parse(orderSchema, await request(`/recharge/orders/${idPath(input.orderId)}/refunds`, 'POST', {}, true, identifier.parse(input.operationId))); },
    async saveModelProfile(input) {
      const profile = commercialProfileSchema.parse(input);
      if (profile.source === 'byok' && !profile.localProfileId) throw new Error('LOCAL_PROFILE_REQUIRED: 请选择已有的自有 API 配置。');
      if (profile.source === 'platform' && !profile.modelId) throw new Error('MODEL_REQUIRED');
      return mutateProfiles((profiles) => {
        const index = profiles.profiles.findIndex((item) => item.id === profile.id);
        if (index >= 0 && profiles.profiles[index].capability !== profile.capability) throw new Error('PROFILE_CAPABILITY_IMMUTABLE');
        if (profiles.profiles.length >= 1000 && index < 0) throw new Error('PROFILE_LIMIT');
        if (index < 0) profiles.profiles.push(profile);
        else {
          // Editing an enabled profile requires explicit activation again.
          if (JSON.stringify(profiles.profiles[index]) !== JSON.stringify(profile) && profiles.active[profile.capability] === profile.id) delete profiles.active[profile.capability];
          profiles.profiles[index] = profile;
        }
      });
    },
    async deleteModelProfile(id) { identifier.parse(id); return mutateProfiles((profiles) => { profiles.profiles = profiles.profiles.filter((p) => p.id !== id); for (const capability of capabilities) if (profiles.active[capability] === id) delete profiles.active[capability]; }); },
    async activateModelProfile(id) {
      identifier.parse(id); await init(); const captured = epoch;
      const profile = profileSet().profiles.find((p) => p.id === id);
      if (!profile) throw new Error('PROFILE_NOT_FOUND');
      if (profile.source === 'platform') {
        const catalog = parse(publicSchema, await request('/public/config', 'GET', undefined, false, undefined, captured)).catalog;
        if (!catalog.some((model) => model.id === profile.modelId && model.capability === profile.capability && model.status === 'available')) throw new Error('MODEL_UNAVAILABLE: 此平台模型当前不可用。');
      }
      assertEpoch(captured);
      return mutateProfiles((profiles) => { const current = profiles.profiles.find((p) => p.id === id); if (!current || JSON.stringify(current) !== JSON.stringify(profile)) throw new Error('PROFILE_CHANGED'); profiles.active[profile.capability] = id; });
    },
    async quote(input) { return parse(quoteSchema, await request('/quotes', 'POST', quoteInputSchema.parse(input), true, randomUUID())); },
    async submit(input) { const data = z.object({ quoteId: identifier, operationId: identifier }).strict().parse(input); return parse(jobSchema, await request('/jobs', 'POST', data, true, data.operationId)); },
    listJobs,
    async getJob(id) { return parse(jobSchema, await request(`/jobs/${idPath(id)}`)); },
    async cancelJob(id) { return parse(jobSchema, await request(`/jobs/${idPath(id)}/cancel`, 'POST', {}, true, randomUUID())); },
    async downloadArtifact(id) {
      identifier.parse(id); await init(); const captured = epoch, owner = session(captured).userId;
      const jobs = await listJobs(); assertEpoch(captured);
      const artifact = jobs.flatMap((job) => job.artifacts).find((item) => item.id === id);
      if (!artifact) throw new Error('ARTIFACT_NOT_FOUND: 未找到当前账号的产物。');
      if (Date.parse(session(captured).expiresAt) <= Date.now() + 30000) await refresh(captured);
      let response = await raw(`/artifacts/${idPath(id)}`, 'GET', undefined, captured, true);
      if (response.status === 401) { await response.body?.cancel(); await refresh(captured); response = await raw(`/artifacts/${idPath(id)}`, 'GET', undefined, captured, true); }
      if (!response.ok) { await json(response); throw new Error('DOWNLOAD_FAILED'); }
      const dir = join(options.dataDir, 'artifacts', createHash('sha256').update(owner).digest('hex'));
      await mkdir(dir, { recursive: true }); assertEpoch(captured);
      const name = artifact.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 140) || 'artifact';
      const destination = join(dir, `${randomUUID()}-${name}`);
      try { await saveVerifiedDownload({ response, destination, size: artifact.size, sha256: artifact.sha256, assertCurrent: () => assertEpoch(captured) }); assertEpoch(captured); return { path: destination }; }
      catch (error) { await rm(destination, { force: true }).catch(() => {}); throw error; }
    },
    ...updater,
  };
  return Object.assign(api, { async getLocalModelContext() {
    if (!baseUrl) return { userId: null, profiles: emptyProfiles() };
    await init(); return { userId: state?.session?.userId ?? null, profiles: profileSet() };
  } });
}
