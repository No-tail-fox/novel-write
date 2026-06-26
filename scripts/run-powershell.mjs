import { spawnSync } from 'node:child_process';

const [scriptPath, ...scriptArgs] = process.argv.slice(2);

if (!scriptPath) {
  console.error('Usage: node scripts/run-powershell.mjs <script> [...args]');
  process.exit(1);
}

const candidates = process.platform === 'win32' ? ['pwsh', 'powershell'] : ['pwsh', 'powershell'];

let lastError = null;

for (const command of candidates) {
  const result = spawnSync(command, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...scriptArgs], {
    stdio: 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    lastError = result.error;
    continue;
  }

  process.exit(result.status ?? 0);
}

if (lastError) {
  console.error(lastError.message);
}

process.exit(1);
