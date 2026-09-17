import { McpServer } from '../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import { StdioServerTransport } from '../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import * as z from '../../node_modules/zod/v4/index.js';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const server = new McpServer({ name: 'storydream-agent-search-test', version: '1.0.0' });
const markerRoot = dirname(process.env.SEARCH_CACHE_DIRECTORY || process.cwd());
const disconnectMarker = join(markerRoot, 'stub-disconnected');
const disconnectOnThisProcess = !existsSync(disconnectMarker);

server.registerTool('free_search', {
  inputSchema: {
    query: z.string(),
    engines: z.array(z.string()),
    limit: z.number(),
  },
}, async ({ query, engines, limit }) => {
  if (query.startsWith('disconnect-') && disconnectOnThisProcess) {
    writeFileSync(disconnectMarker, '1', 'utf8');
    process.exit(23);
  }
  if (query === 'stderr flood') {
    process.stderr.write('bounded diagnostic output\n'.repeat(20_000));
  }
  return {
    content: [{ type: 'text', text: 'ok' }],
    structuredContent: {
      query,
      engines,
      limit,
      results: [{ title: query, url: 'https://example.test/result', sources: engines }],
    },
  };
});

await server.connect(new StdioServerTransport());
