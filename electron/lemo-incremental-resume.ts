import type { EditorialCollagePipelineData as Document } from '../src/shared/editorial-collage';
import { lemoEditNodeId } from '../src/shared/creative-animation/native-project';
import { activeNativeFilm, saveFilm } from './lemo-production-document';

/** Rebase invalidated edits onto saved source; never replay already-consumed transactions. */
export function reconcileLemoEditSessions(d: Document): Document {
  const film = activeNativeFilm(d), project = film?.project, run = d.productionRun;
  if (!film || !project || project.authoringMode !== 'incremental' || !run) return d;
  if (run.nodes.some(n => n.status === 'unknown' || n.status === 'running' && n.paid)) return d;
  let changed = false;
  const sessions = { ...project.editSessions };
  for (const [key, session] of Object.entries(sessions)) {
    const consumed = run.nodes.filter(n => n.kind === 'film-edit' && n.editSession === key && n.editRound
      && n.editRound <= session.rounds && n.id === lemoEditNodeId(key, session.revision, n.editRound));
    if (!consumed.some(n => n.status === 'pending')) continue;
    const revision = session.revision ?? 0;
    if (revision >= 64) throw new Error('LEMO_EDIT_REVISION_LIMIT: 已达输入修订次数上限，已保留源码和回执。');
    sessions[key] = {
      revision: revision + 1, rounds: 0, done: false,
      history: [...(session.history ?? []), { revision, rounds: session.rounds, done: session.done,
        receipts: consumed.map(n => ({ nodeId: n.id, requestId: n.requestId, inputHash: n.inputHash })) }],
      diagnostic: 'UPSTREAM_INPUT_CHANGED: Narration, timeline or another upstream input changed after the saved edits. Keep the accepted source as the base. Revalidate it against the current input; change only what the new timing/content requires, without redesigning working visuals. Return edits:[] and done:true if no change is necessary.',
    };
    changed = true;
  }
  return changed ? saveFilm(d, { ...film, project: { ...project, editSessions: sessions } }) : d;
}
