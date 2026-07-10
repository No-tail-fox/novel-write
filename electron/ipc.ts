import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import {
  ipcInputSchemas,
  type IpcChannel,
  type IpcInput,
} from '../src/shared/ipc-contract';
import { AppError, toAppErrorPayload } from '../src/shared/app-error';
import { isTrustedRendererSender, type RendererPolicy } from './security';

interface IpcFrameLike {
  url: string;
}

interface IpcWebContentsLike {
  mainFrame: IpcFrameLike;
  getURL: () => string;
}

interface IpcWindowLike {
  isDestroyed: () => boolean;
  webContents: IpcWebContentsLike;
}

type RegisteredHandler = (event: unknown, raw?: unknown) => Promise<unknown>;

export interface TrustedIpcDependencies {
  register: (channel: string, handler: RegisteredHandler) => void;
  getWindow: () => IpcWindowLike | null;
  getPolicy: () => RendererPolicy | null;
}

export function createTrustedIpcRegistrar(dependencies: TrustedIpcDependencies) {
  return function trustedHandle<C extends IpcChannel, O>(
    channel: C,
    handler: (event: IpcMainInvokeEvent, input: IpcInput<C>) => Promise<O> | O,
  ): void {
    const schema = ipcInputSchemas[channel] as unknown as ZodType<IpcInput<C>>;
    dependencies.register(channel, async (event, raw) => {
      try {
        const win = dependencies.getWindow();
        const policy = dependencies.getPolicy();
        if (!win || !policy || !isTrustedRendererSender(event as IpcMainInvokeEvent, win as BrowserWindow, policy)) {
          throw new AppError('IPC_SENDER_REJECTED', '请求来源无效。');
        }
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          throw new AppError('IPC_INVALID_INPUT', '请求参数无效。');
        }
        return { ok: true, value: await handler(event as IpcMainInvokeEvent, parsed.data) };
      } catch (error) {
        return {
          ok: false,
          error: toAppErrorPayload(error, {
            code: 'IPC_HANDLER_FAILED',
            message: '请求处理失败，请重试。',
            retryable: true,
          }),
        };
      }
    });
  };
}
