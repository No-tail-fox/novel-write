import { z } from 'zod';
import { commercialProfileSchema, quoteInputSchema, unconfiguredSnapshot, type CommercialApi } from './commercial-contract';

const id = z.string().min(1).max(128);
const operationId = z.string().uuid();
const definitions = {
  getSnapshot: z.tuple([]), sendCode: z.tuple([z.string().regex(/^\+?[1-9]\d{6,14}$/)]),
  login: z.tuple([z.object({ challengeId: id, code: z.string().regex(/^\d{6}$/) }).strict()]),
  logout: z.tuple([]), updateProfile: z.tuple([z.string().trim().min(1).max(100)]),
  redeem: z.tuple([z.string().trim().min(1).max(256)]), unbindDevice: z.tuple([id]),
  listTransactions: z.tuple([]), listProducts: z.tuple([]),
  createOrder: z.tuple([z.object({ productId: id, version: id, operationId }).strict()]),
  getOrder: z.tuple([id]), requestRefund: z.tuple([z.object({ orderId: id, operationId }).strict()]),
  saveModelProfile: z.tuple([commercialProfileSchema]), deleteModelProfile: z.tuple([id]), activateModelProfile: z.tuple([id]),
  quote: z.tuple([quoteInputSchema]), submit: z.tuple([z.object({ quoteId: id, operationId }).strict()]),
  listJobs: z.tuple([]), getJob: z.tuple([id]), cancelJob: z.tuple([id]), downloadArtifact: z.tuple([id]),
  checkUpdate: z.tuple([z.enum(['stable', 'beta'])]), downloadUpdate: z.tuple([]), openUpdateFolder: z.tuple([]),
} satisfies Record<keyof CommercialApi, z.ZodType>;
export const commercialMethods = Object.keys(definitions) as (keyof CommercialApi)[];
export const commercialRequestSchema = z.object({ method: z.enum(commercialMethods as [keyof CommercialApi, ...Array<keyof CommercialApi>]), args: z.array(z.unknown()).max(1) }).strict().superRefine((request, context) => {
  const result = definitions[request.method].safeParse(request.args);
  if (!result.success) context.addIssue({ code: 'custom', message: '商业服务请求参数无效。', path: ['args'] });
});
export type CommercialRequest = z.infer<typeof commercialRequestSchema>;
export function createCommercialBridge(invoke: (request: CommercialRequest) => Promise<unknown>): CommercialApi {
  return Object.fromEntries(commercialMethods.map(method => [method, (...args: unknown[]) => invoke({ method, args })])) as unknown as CommercialApi;
}
export async function dispatchCommercialRequest(api: CommercialApi, raw: CommercialRequest): Promise<unknown> {
  const request = commercialRequestSchema.parse(raw);
  const args = definitions[request.method].parse(request.args);
  return (api[request.method] as (...values: unknown[]) => Promise<unknown>)(...args as unknown[]);
}
export function createUnavailableCommercialApi(): CommercialApi {
  return createCommercialBridge(async ({ method }) => {
    if (method === 'getSnapshot' || method === 'logout') return unconfiguredSnapshot('浏览器预览不连接真实账号服务。请在桌面软件中登录；本地作品仍可使用。');
    if (method === 'checkUpdate') return { status: 'unconfigured', currentVersion: '1.0.0', activeTasks: 0, message: '请在桌面软件中检查更新。' };
    throw new Error('COMMERCIAL_UNAVAILABLE: 请在已配置服务地址的桌面软件中使用此功能。');
  });
}
