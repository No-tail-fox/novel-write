import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { StoryDreamApi } from "../../shared/storydream-api";
import { useAsyncAction } from "../../ui/async-action";
import { AsyncActionFeedback as InlineActionFeedback } from "../../components/AsyncActionFeedback";
import type { ApplyMutationResult, RendererAppState as AppState } from "../../app/route-types";
import { ConfigInput, LocalInfo } from '../settings/settings-controls';

export function AccountPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [draft, setDraft] = useState(state.account);
  const accountAction = useAsyncAction();
  useEffect(() => setDraft(state.account), [state.account]);
  async function saveAccountProfile() {
    await accountAction.run(async () => {
      applyState(await api.saveAccount(draft));
    }, { successMessage: '账户资料已保存。' });
  }
  return (
    <section className="panel account-panel">
      <div className="profile-card">
        <div className="avatar">{draft.avatarInitial || 'S'}</div>
        <div>
          <h2>{draft.displayName}</h2>
          <span>{draft.email} · {draft.deviceId}</span>
        </div>
        <strong>{draft.balance.toFixed(2)} 积分</strong>
      </div>
      <ConfigInput label="显示名称" value={draft.displayName} onChange={(value) => setDraft({ ...draft, displayName: value, avatarInitial: value.slice(0, 1).toUpperCase() || 'S' })} />
      <ConfigInput label="邮箱" value={draft.email} onChange={(value) => setDraft({ ...draft, email: value })} />
      <ConfigInput label="工作区" value={draft.workspace} onChange={(value) => setDraft({ ...draft, workspace: value })} />
      <div className="account-actions">
        <button className="primary-action slim" disabled={accountAction.busy} onClick={saveAccountProfile}><Save size={15} />保存资料</button>
        <InlineActionFeedback feedback={accountAction.feedback} />
      </div>
      <LocalInfo title="账号与激活关系" value="本地复刻版只显示设备、账户和余额状态，不连接真实登录或付费系统。" />
    </section>
  );
}
