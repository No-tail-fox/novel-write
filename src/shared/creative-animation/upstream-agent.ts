import { z } from 'zod';

export const LEMO_UPSTREAM_WORKFLOW = 3 as const;
export const LEMO_AGENT_MAX_TURNS = 64;
export const lemoUpstreamFilmSchema = z.object({
  version: z.literal(1), runId: z.string().min(1), styleId: z.string().min(1),
  directory: z.string().min(1), turn: z.number().int().min(0).max(LEMO_AGENT_MAX_TURNS),
  status: z.enum(['authoring', 'ready']), sourceHash: z.string(),
  lastTool: z.string(), message: z.string().max(12000),
  review: z.object({ sourceHash: z.string(), technicalPassed: z.boolean(), frames: z.array(z.string()).max(8), durationSeconds: z.number().optional() }).optional(),
  visualReview: z.object({ sourceHash: z.string(), notes: z.string().min(20).max(8000), turn: z.number().int().positive() }).optional(),
}).strict();
export type LemoUpstreamFilm = z.infer<typeof lemoUpstreamFilmSchema>;

const path = z.string().min(1).max(512);
const actionSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('list_files'), scope: z.enum(['project', 'library']).default('project'), path: z.string().max(512).default('') }).strict(),
  z.object({ tool: z.literal('read_file'), scope: z.enum(['project', 'library']).default('project'), path, offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(60000).default(24000) }).strict(),
  z.object({ tool: z.literal('write_file'), path }).strict(),
  z.object({ tool: z.literal('replace_text'), path, before: z.string().min(1).max(100000), after: z.string().max(100000) }).strict(),
  z.object({ tool: z.literal('review_frames') }).strict(),
  z.object({ tool: z.literal('finish'), notes: z.string().min(20).max(8000) }).strict(),
]);
export type LemoAgentAction = z.infer<typeof actionSchema> & { body?: string };

/** Only the small tool header is JSON. File bodies remain verbatim, without JSON escaping. */
export function parseLemoAgentAction(text: string): LemoAgentAction {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('LEMO_AGENT_EMPTY_RESPONSE: The parsed model reply contains no visible text. An empty reply alone does not establish a JSON/tool-schema incompatibility. Return one complete tool action.');
  const header = /```json\s*\r?\n([\s\S]*?)\r?\n```/i.exec(trimmed);
  const action = actionSchema.parse(JSON.parse(header ? header[1] : trimmed));
  if (action.tool !== 'write_file') return action;
  if (!header) throw new Error('LEMO_AGENT_BODY: write_file requires a separate fenced source body.');
  const rest = trimmed.slice(header.index + header[0].length).trim();
  const start = /^```[^\r\n]*\r?\n/.exec(rest);
  const end = rest.lastIndexOf('\n```');
  if (!start || end < start[0].length || rest.slice(end + 4).trim()) throw new Error('LEMO_AGENT_BODY: source fence is incomplete.');
  const body = rest.slice(start[0].length, end).replace(/\r$/, '');
  if (!body.trim()) throw new Error('LEMO_AGENT_BODY: empty source is not a file update.');
  return { ...action, body: body + '\n' };
}