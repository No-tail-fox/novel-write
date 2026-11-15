import { z } from 'zod';
import { createPiAgentFiles } from './pi-agent-files';
import { createPiToolReceiptStore } from './pi-tool-receipts';

const readSchema = z.object({ scope: z.enum(['project', 'library']), path: z.string(), offset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(60000).optional() }).strict();
const writeSchema = z.object({ path: z.string(), text: z.string() }).strict();
const listSchema = z.object({ scope: z.enum(['project', 'library']), path: z.string() }).strict();
export interface PiHostOperation { description: string; parameters: Record<string, unknown>; execute(input: unknown): Promise<unknown>; mutates: boolean }
/** All high-risk operations are supplied explicitly by the owning production run, never dynamically imported. */
export function createPiToolRouter(options: {
  projectRoot: string; libraryRoot: string; styleSlug: string; receiptDirectory: string;
  operations: Readonly<Record<string, PiHostOperation>>;
  beforeTool?: () => void | Promise<void>;
}) {
  const files = createPiAgentFiles(options);
  const receipts = createPiToolReceiptStore(options.receiptDirectory);
  const operations = new Map<string, PiHostOperation>(Object.entries(options.operations));
  if (['read_file', 'write_file', 'list_files'].some(name => operations.has(name))) throw new Error('PI_TOOL_RESERVED');
  operations.set('list_files', { description: 'List one allowed project or library directory. Use path . for the project root.', parameters: z.toJSONSchema(listSchema),
    mutates: false, execute: async input => { const p = listSchema.parse(input); return files.list(p.scope, p.path); } });
  operations.set('read_file', { description: 'Read bounded UTF-8 project source or selected read-only Lemo library guidance.', parameters: z.toJSONSchema(readSchema),
    mutates: false, execute: async input => { const p = readSchema.parse(input); return files.read(p.scope, p.path, p.offset, p.limit); } });
  operations.set('write_file', { description: 'Write UTF-8 project source. Does not execute code. Host-owned narration/material/output are immutable.', parameters: z.toJSONSchema(writeSchema),
    mutates: true, execute: async input => { const p = writeSchema.parse(input); return files.write(p.path, p.text); } });
  return {
    tools: [...operations].map(([name, operation]) => ({ name, description: operation.description, parameters: operation.parameters })),
    async execute(name: string, input: unknown, callId: string): Promise<unknown> {
      await options.beforeTool?.();
      const operation = operations.get(name);
      if (!operation) return Promise.reject(new Error('PI_TOOL_NOT_AVAILABLE'));
      // Read-only operations may run again; all side effects are durably deduplicated by SDK call ID.
      if (!operation.mutates) return operation.execute(input);
      return receipts.execute(callId, { name, input }, async () => { await options.beforeTool?.(); return operation.execute(input); });
    },
  };
}
