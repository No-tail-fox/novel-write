import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { ActivationState } from "../../shared/types";
import type { StoryDreamApi } from "../../shared/storydream-api";
import { useAsyncAction } from "../../ui/async-action";
import { SegmentedControl as Segmented } from "../../components/SegmentedControl";
import { AsyncActionFeedback as InlineActionFeedback } from "../../components/AsyncActionFeedback";
import { StatusBadge as StatusPill } from "../../components/StatusBadge";
import type { ApplyMutationResult, RendererAppState as AppState } from "../../app/route-types";
import { ConfigInput, LocalInfo } from '../settings/settings-controls';

export function ActivationPage({ api, state, applyState }: { api: StoryDreamApi; state: AppState; applyState: ApplyMutationResult }) {
  const [draft, setDraft] = useState(state.activation);
  const activationAction = useAsyncAction();
  useEffect(() => setDraft(state.activation), [state.activation]);
  async function saveActivationState() {
    await activationAction.run(async () => {
      applyState(await api.saveActivation(draft));
    }, { successMessage: '本地激活状态已保存。' });
  }
  return (
    <div className="two-column">
      <section className="panel">
        <div className="panel-title-row">
          <h2>激活状态</h2>
          <StatusPill status={draft.status === 'active' ? 'completed' : 'paused'} />
        </div>
        <ConfigInput label="激活码" value={draft.code} onChange={(value) => setDraft({ ...draft, code: value })} />
        <Segmented label="计划" value={draft.plan} options={['trial', 'local', 'inactive']} labels={['试用', '本地激活', '未激活']} onChange={(value) => setDraft({ ...draft, plan: value as ActivationState['plan'] })} />
        <ConfigInput label="状态说明" value={draft.message} onChange={(value) => setDraft({ ...draft, message: value })} />
        <button className="primary-action slim" disabled={activationAction.busy} onClick={saveActivationState}><Save size={15} />保存状态</button>
        <InlineActionFeedback feedback={activationAction.feedback} />
      </section>
      <section className="panel faq-panel">
        <LocalInfo title="立即激活" value="这里是本地模拟状态页，不做真实购买、登录或付费限制。" />
        <LocalInfo title="常见问题" value="激活码、订阅、设备解绑均为本地 UI 状态，可用于后续接入真实服务。" />
      </section>
    </div>
  );
}
