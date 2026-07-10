import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import type { ZodType } from 'zod';
import {
  ipcInputSchemas,
  toIpcResult,
  type IpcChannel,
  type IpcInput,
} from '../src/shared/ipc-contract';
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
      const win = dependencies.getWindow();
      const policy = dependencies.getPolicy();
      if (!win || !policy || !isTrustedRendererSender(event as IpcMainInvokeEvent, win as BrowserWindow, policy)) {
        throw new Error(`IPC_SENDER_REJECTED: Untrusted sender for ${channel}.`);
      }
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`IPC_INVALID_INPUT: Invalid input for ${channel}.`);
      }
      return toIpcResult(() => handler(event as IpcMainInvokeEvent, parsed.data));
    });
  };
}
