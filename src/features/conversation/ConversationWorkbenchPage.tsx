import { useMemo, useRef, useState } from 'react';
import { Bot, Check, Copy, FileText, FolderOpen, MessageCircle, Paperclip, Plus, Search, Send, Sparkles, UserRound } from 'lucide-react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { RendererAppState as AppState } from '../../app/route-types';
import { Button, IconButton, SegmentedControl, TextAreaField, TextField, Tooltip } from '../../ui';
import './conversation-workbench.css';

type ChatRole = 'assistant' | 'user';
type ChatMessage = { id: string; role: ChatRole; text: string; time: string; chips?: string[] };
type ChatSession = { id: string; title: string; meta: string; active?: boolean };

export function ConversationWorkbenchPage({ api, state }: { api: StoryDreamApi; state: AppState }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [sessionMessages, setSessionMessages] = useState<Record<string, ChatMessage[]>>({});
  const [draft, setDraft] = useState('');
  const [sessionQuery, setSessionQuery] = useState('');
  const [mode, setMode] = useState<'chat' | 'outline'>('chat');
  const model = state.config.llm.model || '当前 LLM';
  const [isThinking, setIsThinking] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const activeSession = useMemo(() => sessions.find((session) => session.active) ?? sessions[0], [sessions]);
  const messages = activeSession ? sessionMessages[activeSession.id] ?? [] : [];
  const projectTitle = state.tasks[0]?.title || '未选择项目';

  function selectSession(id: string) {
    setSessions((current) => current.map((session) => ({ ...session, active: session.id === id })));
  }

  function createSession() {
    const next: ChatSession = { id: crypto.randomUUID(), title: '新对话', meta: '刚刚', active: true };
    setSessions((current) => [next, ...current.map((session) => ({ ...session, active: false }))]);
    setSessionMessages((current) => ({ ...current, [next.id]: [] }));
    setDraft('');
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  async function sendMessage(text = draft) {
    const nextText = text.trim();
    if (!nextText || isThinking) return;
    const sessionId = activeSession?.id;
    if (!sessionId) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setSessionMessages((current) => ({ ...current, [sessionId]: [...(current[sessionId] ?? []), { id: crypto.randomUUID(), role: 'user', text: nextText, time }] }));
    setDraft('');
    setIsThinking(true);
    try {
      const history = [...messages, { role: 'user' as const, text: nextText }]
        .slice(-8)
        .map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：${message.text}`)
        .join('\n');
      const result = await api.composeResearchCopy({
        keyword: nextText,
        extraRequirements: `当前项目：${projectTitle}\n对话模式：${mode === 'outline' ? '结构化输出' : '自由对话'}\n请结合以下对话历史回答用户，直接给出可使用的中文内容，不要重复说明任务：\n${history}`,
        selectedSources: [],
        useBuiltinKnowledge: true,
        targetLength: mode === 'outline' ? 1200 : 900,
      });
      setSessionMessages((current) => ({ ...current, [sessionId]: [...(current[sessionId] ?? []), { id: crypto.randomUUID(), role: 'assistant', text: result.copy, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }] }));
    } catch (error) {
      setSessionMessages((current) => ({ ...current, [sessionId]: [...(current[sessionId] ?? []), { id: crypto.randomUUID(), role: 'assistant', text: `这次请求没有完成：${error instanceof Error ? error.message : '请检查模型配置后重试。'}`, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }] }));
    } finally {
      setIsThinking(false);
    }
  }

  const visibleSessions = sessions.filter((session) => session.title.toLocaleLowerCase().includes(sessionQuery.trim().toLocaleLowerCase()));

  return <div className="conversation-workbench">
    <aside className="conversation-sessions panel" aria-label="对话列表">
      <div className="conversation-panel-heading">
        <div><span className="eyebrow">CONVERSATIONS</span><h2>会话</h2></div>
        <Tooltip content="新建对话"><Button className="conversation-create-button" variant="secondary" density="compact" icon={<Plus size={14} />} onClick={createSession}>新建</Button></Tooltip>
      </div>
      <div className="conversation-session-search"><Search size={14} /><TextField label="" aria-label="搜索会话" placeholder="搜索会话" value={sessionQuery} onChange={(event) => setSessionQuery(event.target.value)} /></div>
      <div className="conversation-session-heading"><span>最近对话</span><small>{visibleSessions.length}</small></div>
      <div className="conversation-session-list">
        {visibleSessions.map((session) => <Button key={session.id} className={`conversation-session ${session.active ? 'is-active' : ''}`} variant="subtle" density="compact" onClick={() => selectSession(session.id)}>
          <span className="conversation-session-icon"><MessageCircle size={14} /></span><span className="conversation-session-copy"><strong>{session.title}</strong><small>{session.meta}</small></span>{session.active ? <span className="conversation-active-dot" /> : null}
        </Button>)}
        {visibleSessions.length === 0 ? <div className="conversation-session-empty">没有找到匹配的会话</div> : null}
      </div>
      <div className="conversation-sessions-footer"><span>当前工作区</span><small>{sessions.length ? '会话仅在当前工作区保留' : '新建对话后会显示在这里'}</small></div>
    </aside>

    <section className="conversation-thread panel" aria-label="当前对话">
      <header className="conversation-thread-header">
        <div className="conversation-thread-title"><div className="conversation-avatar assistant"><Bot size={17} /></div><div><h2>{activeSession?.title ?? '对话工作台'}</h2><span><span className="status-dot" /> {activeSession ? `项目上下文已连接 · ${state.config.llm.model || '未配置模型'}` : '新建对话后连接项目上下文'}</span></div></div>
        <div className="conversation-thread-actions"><Button density="compact" variant="secondary" icon={<FolderOpen size={14} />}>关联项目</Button><IconButton label="更多操作" icon={<Copy size={15} />} density="compact" variant="subtle" /></div>
      </header>
      {activeSession ? <div className="conversation-context-strip"><FileText size={14} /><span>当前上下文</span><strong>{projectTitle}</strong><span className="conversation-context-count">4 个资料</span><IconButton label="移除上下文" icon={<span aria-hidden="true">×</span>} density="compact" variant="subtle" /></div> : null}
      <div className="conversation-messages" role="log" aria-live="polite">
        {messages.length === 0 ? <div className="conversation-empty"><div className="conversation-empty-icon"><Sparkles size={22} /></div><strong>{activeSession ? '从一个问题开始' : '开始一个项目对话'}</strong><span>{activeSession ? '围绕项目资料提问，助手会把结果整理成可直接使用的创作素材。' : '先新建一个对话，再把项目问题、文案或分镜交给助手。'}</span>{!activeSession ? <Button density="compact" variant="primary" icon={<Plus size={14} />} onClick={createSession}>新建对话</Button> : null}</div> : messages.map((message) => <MessageBubble key={message.id} message={message} onAction={sendMessage} />)}
        {isThinking ? <div className="conversation-message-row assistant"><div className="conversation-avatar assistant"><Bot size={16} /></div><div className="conversation-thinking"><span /><span /><span /></div></div> : null}
      </div>
      <div className={`conversation-composer ${activeSession ? '' : 'is-disabled'}`}>
        <div className="conversation-composer-toolbar"><SegmentedControl label="对话模式" value={mode} onChange={(value) => setMode(value as 'chat' | 'outline')} options={[{ value: 'chat', label: '自由对话' }, { value: 'outline', label: '结构化输出' }]} /><span className="conversation-composer-hint">Enter 发送 · Shift + Enter 换行</span></div>
        <TextAreaField ref={composerRef} label="" aria-label="输入消息" placeholder={activeSession ? '问问项目、文案或分镜……' : '新建对话后开始输入'} value={draft} disabled={!activeSession} onChange={(_, data) => setDraft(data.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} resize="vertical" />
        <div className="conversation-composer-actions"><Button density="compact" variant="subtle" icon={<Paperclip size={14} />} disabled={!activeSession}>添加资料</Button><span className="conversation-composer-spacer" /><Button density="compact" variant="primary" icon={<Send size={14} />} disabled={!activeSession || !draft.trim() || isThinking} onClick={() => void sendMessage()}>发送</Button></div>
      </div>
    </section>

    <aside className="conversation-inspector panel" aria-label="对话设置">
      <div className="conversation-inspector-heading"><div><span className="eyebrow">ASSISTANT</span><h2>工作台设置</h2></div><span className="conversation-online"><span className="status-dot" /> 在线</span></div>
      <section className="conversation-inspector-section"><h3>当前模型</h3><div className="conversation-model-card"><Bot size={15} /><div><strong>{model}</strong><small>跟随系统设置中的 LLM 配置</small></div></div><div className="conversation-model-meta"><span>上下文窗口</span><strong>128K</strong><span>温度</span><strong>0.7</strong></div></section>
      <section className="conversation-inspector-section"><div className="conversation-section-title"><h3>输出偏好</h3><span>仅影响当前对话</span></div><div className="conversation-preference-row"><span>回答风格</span><strong>清晰 · 有观点</strong></div><div className="conversation-preference-row"><span>默认语言</span><strong>简体中文</strong></div></section>
      <div className="conversation-inspector-footer"><Check size={14} /><span>自动保存已开启</span></div>
    </aside>
  </div>;
}

function MessageBubble({ message, onAction }: { message: ChatMessage; onAction: (text: string) => void }) {
  const isAssistant = message.role === 'assistant';
  return <article className={`conversation-message-row ${isAssistant ? 'assistant' : 'user'}`}><div className={`conversation-avatar ${isAssistant ? 'assistant' : 'user'}`}>{isAssistant ? <Bot size={16} /> : <UserRound size={16} />}</div><div className="conversation-message-content"><div className="conversation-message-meta"><strong>{isAssistant ? 'StoryDream 助手' : '你'}</strong><time>{message.time}</time></div><div className="conversation-bubble">{message.text}</div>{message.chips?.length ? <div className="conversation-message-actions">{message.chips.map((chip) => <Button key={chip} density="compact" variant="subtle" onClick={() => onAction(chip)}>{chip}</Button>)}</div> : null}</div></article>;
}
