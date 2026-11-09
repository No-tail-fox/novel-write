import { probeLemoAgentSdk } from './probe';

// One bounded JSON request on stdin. No credentials or arbitrary code are accepted.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input, 'utf8') > 16384) {
    process.stderr.write('LEMO_SDK_INPUT_LIMIT\n'); process.exit(1);
  }
});
process.stdin.on('end', () => {
  void (async () => {
    try {
      const result = await probeLemoAgentSdk(JSON.parse(input));
      process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
    } catch (error) {
      // No raw SDK stderr, API payloads or inherited secrets are surfaced to the UI.
      const message = error instanceof Error ? error.message : '';
      const code = message.match(/^LEMO_SDK_[A-Z_]+/)?.[0] ?? 'LEMO_SDK_START_FAILED';
      process.stdout.write(JSON.stringify({ ok: false, code }) + '\n');
      process.exitCode = 1;
    }
  })();
});
