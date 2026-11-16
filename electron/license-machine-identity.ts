import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

export interface MachineIdentity {
  deviceId: string;
  /** The v1 MachineGuid hash, used only for authenticated migration and legacy locks. */
  legacyDeviceId?: string;
}

const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

function normalizedUuid(value: string, code: string): string {
  const normalized = value.trim().toLowerCase();
  if (!uuidPattern.test(normalized) || /^(0{8}-0{4}-0{4}-0{4}-0{12}|f{8}-f{4}-f{4}-f{4}-f{12})$/.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

export function windowsMachineIdentity(machineGuid: string, hardwareUuid: string): MachineIdentity {
  const guid = normalizedUuid(machineGuid, 'MACHINE_ID_UNAVAILABLE');
  const hardware = normalizedUuid(hardwareUuid, 'HARDWARE_ID_UNAVAILABLE');
  return {
    deviceId: digest(`storydream-device-v2\n${guid}\n${hardware}`),
    legacyDeviceId: digest(`storydream-device-v1\n${guid}`),
  };
}

export async function readMachineIdentity(): Promise<MachineIdentity> {
  if (process.platform !== 'win32') {
    const raw = (await readFile('/etc/machine-id', 'utf8')).trim();
    if (!raw) throw new Error('MACHINE_ID_UNAVAILABLE');
    return { deviceId: digest(`storydream-device-v1\n${raw}`) };
  }
  const execute = promisify(execFile);
  const registry = await execute('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { windowsHide: true, timeout: 10000, maxBuffer: 16384 });
  const match = /MachineGuid\s+REG_SZ\s+([a-f0-9-]{36})/i.exec(registry.stdout);
  if (!match) throw new Error('MACHINE_ID_UNAVAILABLE');
  // A missing/invalid SMBIOS UUID must not silently fall back to the colliding v1 identity.
  // UUID is SMBIOS System Information, not the computer name or a network adapter address.
  const hardware = await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
    "$ErrorActionPreference = 'Stop'; (Get-CimInstance -ClassName Win32_ComputerSystemProduct -ErrorAction Stop).UUID"],
  { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  return windowsMachineIdentity(match[1], hardware.stdout);
}
