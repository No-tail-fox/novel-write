import { useEffect, useState } from 'react';
import { Check, FolderOpen, Loader2, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import type { ApplyMutationResult } from '../../app/route-types';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import { FormField as Field } from '../../components/FormField';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppMutationResult, MinimaxCloneVoice, MinimaxCloneVoiceInput } from '../../shared/types';
import { useAsyncAction } from '../../ui/async-action';

interface VoiceDraft extends MinimaxCloneVoiceInput {
  editingVoiceId: string | null;
}

const emptyDraft: VoiceDraft = { voiceId: '', displayName: '', sourceAudioPath: '', editingVoiceId: null };

function mergeCatalog(current: readonly MinimaxCloneVoice[], incoming: readonly MinimaxCloneVoice[]): MinimaxCloneVoice[] {
  const catalog = new Map(current.map((voice) => [voice.voiceId, voice]));
  for (const voice of incoming) catalog.set(voice.voiceId, voice);
  return [...catalog.values()];
}

function savedVoiceFromMutation(result: AppMutationResult | null): MinimaxCloneVoice | null {
  return result?.kind === 'state-patch' && result.patch.kind === 'minimax-clone-voice-upsert'
    ? result.patch.voice
    : null;
}

export function MinimaxCloneVoiceManager({
  api,
  applyState,
  initialVoices,
  onCatalogChange,
}: {
  api: StoryDreamApi;
  applyState: ApplyMutationResult;
  initialVoices: readonly MinimaxCloneVoice[];
  onCatalogChange: (voices: MinimaxCloneVoice[]) => void;
}) {
  const [voices, setVoices] = useState<MinimaxCloneVoice[]>(() => [...initialVoices]);
  const [totalCount, setTotalCount] = useState(initialVoices.length);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [draft, setDraft] = useState<VoiceDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const action = useAsyncAction();

  useEffect(() => {
    let cancelled = false;
    setLoadingCatalog(true);
    setCatalogError('');
    void api.listMinimaxCloneVoices({ limit: 50 }).then((page) => {
      if (cancelled) return;
      setVoices(page.items);
      setTotalCount(page.totalCount);
      setNextCursor(page.nextCursor);
      onCatalogChange(page.items);
    }).catch((error: unknown) => {
      if (!cancelled) setCatalogError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (!cancelled) setLoadingCatalog(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, onCatalogChange]);

  function updateCatalog(next: MinimaxCloneVoice[]) {
    setVoices(next);
    onCatalogChange(next);
  }

  async function loadMore() {
    if (!nextCursor) return;
    await action.run(async () => {
      const page = await api.listMinimaxCloneVoices({ cursor: nextCursor, limit: 50 });
      const next = mergeCatalog(voices, page.items);
      updateCatalog(next);
      setTotalCount(page.totalCount);
      setNextCursor(page.nextCursor);
    });
  }

  function beginCreate() {
    setPendingDelete(null);
    setDraft(emptyDraft);
    setEditorOpen(true);
  }

  function beginEdit(voice: MinimaxCloneVoice) {
    setPendingDelete(null);
    setDraft({
      voiceId: voice.voiceId,
      displayName: voice.displayName,
      sourceAudioPath: voice.sourceAudioPath,
      editingVoiceId: voice.voiceId,
    });
    setEditorOpen(true);
  }

  async function selectSourceAudio() {
    const selected = await action.run(() => api.selectLocalAudio());
    if (selected.ok && selected.value) setDraft((current) => ({ ...current, sourceAudioPath: selected.value! }));
  }

  async function saveVoice() {
    const input: MinimaxCloneVoiceInput = {
      voiceId: draft.voiceId.trim(),
      displayName: draft.displayName.trim(),
      sourceAudioPath: draft.sourceAudioPath.trim(),
    };
    if (!input.voiceId || !input.displayName) return;
    await action.run(async () => {
      const result = await api.saveMinimaxCloneVoice(input);
      applyState(result);
      const saved = savedVoiceFromMutation(result);
      if (saved) {
        const existed = voices.some((voice) => voice.voiceId === saved.voiceId);
        updateCatalog(mergeCatalog(voices, [saved]));
        if (!existed) setTotalCount((count) => count + 1);
      }
      setDraft(emptyDraft);
      setEditorOpen(false);
    });
  }

  async function deleteVoice(voiceId: string) {
    await action.run(async () => {
      const result = await api.deleteMinimaxCloneVoice(voiceId);
      applyState(result);
      updateCatalog(voices.filter((voice) => voice.voiceId !== voiceId));
      setTotalCount((count) => Math.max(0, count - 1));
      setPendingDelete(null);
      if (draft.editingVoiceId === voiceId) {
        setDraft(emptyDraft);
        setEditorOpen(false);
      }
    });
  }

  return (
    <section className="minimax-clone-voice-manager" aria-label="已有 MiniMax 克隆音色">
      <div className="minimax-clone-voice-head">
        <div>
          <strong>已有 MiniMax 克隆音色</strong>
          <span>{totalCount} 个本地记录，仅登记已从 MiniMax 获得的音色 ID</span>
        </div>
        <button className="ghost-action" type="button" disabled={action.busy} onClick={beginCreate}>
          <Plus size={15} />登记音色
        </button>
      </div>

      {editorOpen ? (
        <div className="minimax-clone-voice-editor">
          <Field label="音色 ID">
            <input value={draft.voiceId} disabled={draft.editingVoiceId !== null} placeholder="MiniMax voice_id" onChange={(event) => setDraft((current) => ({ ...current, voiceId: event.target.value }))} />
          </Field>
          <Field label="显示名称">
            <input value={draft.displayName} placeholder="例如：纪录片旁白" onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} />
          </Field>
          <Field label="来源音频" hint="可选，仅作本地备注">
            <div className="upload-row">
              <input value={draft.sourceAudioPath} readOnly placeholder="未关联来源音频" />
              <button className="icon-button" type="button" title="选择来源音频" aria-label="选择来源音频" disabled={action.busy} onClick={selectSourceAudio}><FolderOpen size={15} /></button>
            </div>
          </Field>
          <div className="minimax-clone-voice-editor-actions">
            <button className="primary-action slim" type="button" disabled={action.busy || !draft.voiceId.trim() || !draft.displayName.trim()} onClick={saveVoice}>
              {action.busy ? <Loader2 className="spin" size={14} /> : <Save size={14} />}
              保存记录
            </button>
            <button className="ghost-action" type="button" disabled={action.busy} onClick={() => { setDraft(emptyDraft); setEditorOpen(false); }}><X size={14} />取消</button>
          </div>
        </div>
      ) : null}

      <div className="minimax-clone-voice-list">
        {loadingCatalog ? <div className="minimax-clone-voice-empty"><Loader2 className="spin" size={16} />正在加载音色目录</div> : null}
        {!loadingCatalog && voices.length === 0 ? <div className="minimax-clone-voice-empty">尚未登记 MiniMax 克隆音色</div> : null}
        {voices.map((voice) => (
          <div className="minimax-clone-voice-row" key={voice.voiceId}>
            <div>
              <strong>{voice.displayName}</strong>
              <code>{voice.voiceId}</code>
              <small>{voice.sourceAudioPath || '未关联来源音频'}</small>
            </div>
            <div className="minimax-clone-voice-actions">
              <button className="icon-button" type="button" title="编辑音色记录" aria-label={`编辑音色记录 ${voice.displayName}`} disabled={action.busy} onClick={() => beginEdit(voice)}><Pencil size={14} /></button>
              {pendingDelete === voice.voiceId ? (
                <>
                  <button className="icon-button danger-action" type="button" title="确认删除音色记录" aria-label={`确认删除音色记录 ${voice.displayName}`} disabled={action.busy} onClick={() => deleteVoice(voice.voiceId)}><Check size={14} /></button>
                  <button className="icon-button" type="button" title="取消删除" aria-label="取消删除音色记录" disabled={action.busy} onClick={() => setPendingDelete(null)}><X size={14} /></button>
                </>
              ) : (
                <button className="icon-button danger-action" type="button" title="删除音色记录" aria-label={`删除音色记录 ${voice.displayName}`} disabled={action.busy} onClick={() => setPendingDelete(voice.voiceId)}><Trash2 size={14} /></button>
              )}
            </div>
          </div>
        ))}
      </div>

      {nextCursor ? <button className="ghost-action minimax-clone-voice-more" type="button" disabled={action.busy} onClick={loadMore}>加载更多</button> : null}
      <InlineActionFeedback feedback={catalogError ? { tone: 'error', message: catalogError } : action.feedback} />
    </section>
  );
}
