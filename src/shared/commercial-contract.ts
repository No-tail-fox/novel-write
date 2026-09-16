import { z } from 'zod';

export const capabilities = ['text', 'image', 'video', 'music', 'tts', 'speechToText', 'vision'] as const;
export type ModelCapability = typeof capabilities[number];
export const unitsSchema = z.string().regex(/^(0|[1-9]\d{0,24})$/);
export type CreditUnits = string;
export interface PlatformUser { id: string; displayName: string; phone: string }
export interface PlatformWallet { availableUnits: CreditUnits; reservedUnits: CreditUnits; frozenUnits: CreditUnits; revision: string }
export interface PlatformLicense { id: string; plan: string; status: 'active' | 'expired' | 'inactive'; expiresAt: string | null; deviceLimit: number; features: string[]; lease?: string }
export interface PlatformDevice { id: string; name: string; current: boolean; lastSeenAt: string }
export interface CatalogModel { id: string; name: string; capability: ModelCapability; operation: string; priceUnits: CreditUnits; unit: string; status: 'available' | 'unconfigured' | 'disabled'; version: string; description: string }
export interface CommercialModelProfile { id: string; name: string; capability: ModelCapability; source: 'platform' | 'byok'; modelId: string; localProfileId?: string }
export interface CommercialProfiles { profiles: CommercialModelProfile[]; active: Partial<Record<ModelCapability, string>> }
export interface CommercialSnapshot {
  configured: boolean; serviceUrl: string; environment: 'unconfigured' | 'development' | 'production';
  authenticated: boolean; user: PlatformUser | null; wallet: PlatformWallet | null;
  license: PlatformLicense | null; devices: PlatformDevice[]; catalog: CatalogModel[];
  profiles: CommercialProfiles; paymentAvailable: boolean; message?: string;
}
export interface AuthChallenge { challengeId: string; expiresAt: string; retryAfter: number; developmentCode?: string }
export interface LedgerEntry { id: string; kind: string; referenceId: string; description: string; availableDelta: string; reservedDelta: string; createdAt: string }
export interface RechargeProduct { id: string; version: string; name: string; amountFen: string; creditUnits: CreditUnits }
export interface RechargeOrder { id: string; amountFen: string; creditUnits: CreditUnits; status: 'payment_pending' | 'credited' | 'expired' | 'refund_pending' | 'refunded'; paymentUrl?: string; expiresAt: string; createdAt: string }
export interface PlatformQuote { id: string; modelId: string; operation: string; reservedUnits: CreditUnits; expiresAt: string; description: string }
export interface PlatformArtifact { id: string; name: string; mime: string; size: number; sha256: string }
export interface PlatformJob { id: string; modelId: string; state: 'reserved' | 'submitting' | 'submission_unknown' | 'running' | 'awaiting_delivery' | 'succeeded_settled' | 'failed_released' | 'cancelled_released'; reservedUnits: CreditUnits; settledUnits: CreditUnits; createdAt: string; message?: string; artifacts: PlatformArtifact[] }
export interface QuoteInput { modelId: string; operation: string; params: Record<string, unknown> }
export interface UpdateManifest { version: string; platform: string; arch: string; channel: 'stable' | 'beta'; publishedAt: string; releaseNotes: string; url: string; sha256: string; size: number; minAppVersion: string; keyId: string; signature: string }
export interface PlatformUpdateState { status: 'unconfigured' | 'current' | 'available' | 'downloaded' | 'blocked' | 'error'; currentVersion: string; manifest?: UpdateManifest; downloadedPath?: string; activeTasks: number; message: string }
export interface CommercialApi {
  getSnapshot(): Promise<CommercialSnapshot>;
  sendCode(phone: string): Promise<AuthChallenge>;
  login(input: { challengeId: string; code: string }): Promise<CommercialSnapshot>;
  logout(): Promise<CommercialSnapshot>;
  updateProfile(displayName: string): Promise<CommercialSnapshot>;
  redeem(code: string): Promise<CommercialSnapshot>;
  unbindDevice(id: string): Promise<CommercialSnapshot>;
  listTransactions(): Promise<LedgerEntry[]>;
  listProducts(): Promise<RechargeProduct[]>;
  createOrder(input: { productId: string; version: string; operationId: string }): Promise<RechargeOrder>;
  getOrder(id: string): Promise<RechargeOrder>;
  requestRefund(input: { orderId: string; operationId: string }): Promise<RechargeOrder>;
  saveModelProfile(profile: CommercialModelProfile): Promise<CommercialProfiles>;
  deleteModelProfile(id: string): Promise<CommercialProfiles>;
  activateModelProfile(id: string): Promise<CommercialProfiles>;
  quote(input: QuoteInput): Promise<PlatformQuote>;
  submit(input: { quoteId: string; operationId: string }): Promise<PlatformJob>;
  listJobs(): Promise<PlatformJob[]>;
  getJob(id: string): Promise<PlatformJob>;
  cancelJob(id: string): Promise<PlatformJob>;
  downloadArtifact(id: string): Promise<{ path: string }>;
  checkUpdate(channel: 'stable' | 'beta'): Promise<PlatformUpdateState>;
  downloadUpdate(): Promise<PlatformUpdateState>;
  openUpdateFolder(): Promise<PlatformUpdateState>;
}
export const commercialProfileSchema = z.object({ id: z.string().min(1).max(128), name: z.string().trim().min(1).max(100), capability: z.enum(capabilities), source: z.enum(['platform', 'byok']), modelId: z.string().max(128), localProfileId: z.string().max(128).optional() }).strict();
export const quoteInputSchema = z.object({ modelId: z.string().min(1).max(128), operation: z.string().min(1).max(100), params: z.record(z.string().max(100), z.unknown()) }).strict();
export function formatCredits(units: CreditUnits): string {
  const n = BigInt(units); const sign = n < 0n ? '-' : ''; const v = n < 0n ? -n : n;
  const fraction = (v % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${sign}${(v / 1000n).toLocaleString('zh-CN')}${fraction ? '.' + fraction : ''}`;
}
export function unconfiguredSnapshot(message = '尚未配置账号服务，请联系运营方提供服务地址。'): CommercialSnapshot {
  return { configured: false, serviceUrl: '', environment: 'unconfigured', authenticated: false, user: null, wallet: null, license: null, devices: [], catalog: [], profiles: { profiles: [], active: {} }, paymentAvailable: false, message };
}
