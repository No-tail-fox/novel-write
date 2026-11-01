import type { IpcChannel } from '../src/shared/ipc-contract';

// Only licensing and update-recovery operations remain available without a valid lease.
const licenseExemptChannels = new Set<IpcChannel>([
  'window:control',
  'license:status', 'license:activate', 'license:refresh', 'license:release',
  'update:status', 'update:check', 'update:download', 'update:install',
]);

export function needsLicense(channel: IpcChannel): boolean {
  return !licenseExemptChannels.has(channel);
}
