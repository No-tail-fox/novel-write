import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LEMO_AGENT_ACTIVITY_LIMIT, summarizeLemoAgentTurn, type LemoAgentActivity, type LemoAgentTurnSummary } from '../src/shared/lemo-agent-activity';

interface JournalTurn { index: number; reply: string; observation: string; tool: string }
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const turnDir = (root: string, index: number) => join(root, `turn-${String(index).padStart(4, '0')}`);
// journal.json holds every reply verbatim (file bodies included); summarize it once per modification.
const cache = new Map<string, { mtimeMs: number; size: number; totalTurns: number; turns: LemoAgentTurnSummary[] }>();

/**
 * Read-only process view of one Lemo Agent run directory (`<work>/lemo-agent/<runId>`).
 * Never writes, never dispatches a model or image request. A run without a journal yet yields an empty view.
 */
export async function readLemoAgentActivity(root: string, runId: string): Promise<LemoAgentActivity> {
  const journalPath = join(root, 'journal.json');
  let turns: LemoAgentTurnSummary[] = [], totalTurns = 0;
  try {
    const info = await stat(journalPath);
    const cached = cache.get(journalPath);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) ({ turns, totalTurns } = cached);
    else {
      const journal = JSON.parse(await readFile(journalPath, 'utf8')) as { turns?: JournalTurn[] };
      const all = Array.isArray(journal.turns) ? journal.turns : [];
      totalTurns = all.length;
      turns = all.slice(-LEMO_AGENT_ACTIVITY_LIMIT).map(summarizeLemoAgentTurn);
      cache.set(journalPath, { mtimeMs: info.mtimeMs, size: info.size, totalTurns, turns });
    }
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const next = totalTurns + 1, dir = turnDir(root, next);
  let pending: LemoAgentActivity['pending'];
  try {
    const submitted = JSON.parse(await readFile(join(dir, 'submitted.json'), 'utf8')) as { at?: unknown };
    let applying = false;
    try { await stat(join(dir, 'response.json')); applying = true; } catch (error) { if (!missing(error)) throw error; }
    pending = { index: next, phase: applying ? 'applying' : 'waiting-model', ...(typeof submitted.at === 'string' ? { startedAt: submitted.at } : {}) };
  } catch (error) {
    if (!missing(error) && !(error instanceof SyntaxError)) throw error;
  }
  return { runId, turns, totalTurns, ...(pending ? { pending } : {}) };
}
