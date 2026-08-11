import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Check,
  Clipboard,
  FileSearch,
  ImageIcon,
  Loader2,
  LogIn,
  Plus,
  Radar,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import { FormField as Field } from '../../components/FormField';
import { AsyncActionFeedback as InlineActionFeedback } from '../../components/AsyncActionFeedback';
import type { ApplyMutationResult } from '../../app/route-types';
import {
  benchmarkMetricNumber,
  benchmarkOpportunityTotal,
  benchmarkPlatformLabel,
  benchmarkPlatforms,
  classifyBenchmarkUrl,
  scoreBenchmarkPost,
} from '../../shared/benchmark-monitoring';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type {
  BenchmarkGroup,
  BenchmarkGroupInput,
  BenchmarkMetricKey,
  BenchmarkMetrics,
  BenchmarkPlatform,
  BenchmarkPost,
  BenchmarkPostInput,
  BenchmarkRefreshPolicy,
  BookProductInfo,
  ShellView,
} from '../../shared/types';
import { countVisibleCharacters } from '../../shared/content-metrics';
import { useAsyncAction } from '../../ui/async-action';
import { taskFromMutation } from '../tasks/task-formatters';
import '../../styles/features/local-labs.css';

type PlatformFilter = 'all' | BenchmarkPlatform;

const emptyGroupDraft = {
  id: '',
  name: '',
  track: '',
  tags: '',
  notes: '',
  refreshPolicy: 'manual' as BenchmarkRefreshPolicy,
  douyinUrl: '',
  wechatUrl: '',
  bilibiliUrl: '',
};

const editableMetricKeys = ['plays', 'likes', 'comments', 'favorites', 'shares', 'coins', 'danmaku'] as const;

const emptyPostDraft = {
  platform: 'douyin' as BenchmarkPlatform,
  sourceLink: '',
  coverUrl: '',
  title: '',
  author: '',
  keyword: '',
  publishedAt: '',
  durationSeconds: '',
  plays: '',
  likes: '',
  comments: '',
  favorites: '',
  shares: '',
  coins: '',
  danmaku: '',
  script: '',
};

export function BenchmarkImportPage({
  api,
  applyState,
  openTaskDetail,
  navigate,
  isBrowserPreview,
}: {
  api: StoryDreamApi;
  applyState: ApplyMutationResult;
  openTaskDetail: (taskId: string) => void;
  navigate: (view: ShellView) => void;
  isBrowserPreview: boolean;
}) {
  const [groups, setGroups] = useState<BenchmarkGroup[]>([]);
  const [posts, setPosts] = useState<BenchmarkPost[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedPostId, setSelectedPostId] = useState('');
  const [selectedPostIds, setSelectedPostIds] = useState<string[]>([]);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showPostDialog, setShowPostDialog] = useState(false);
  const [groupDraft, setGroupDraft] = useState(emptyGroupDraft);
  const [postDraft, setPostDraft] = useState(emptyPostDraft);
  const [detailNote, setDetailNote] = useState('');
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [syncingGroupId, setSyncingGroupId] = useState('');
  const [loginAccountId, setLoginAccountId] = useState('');
  const benchmarkAction = useAsyncAction();

  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
  const groupPosts = posts.filter((post) => post.groupId === selectedGroup?.id);
  const scores = useMemo(() => new Map(groupPosts.map((post) => [post.id, scoreBenchmarkPost(post, groupPosts)])), [groupPosts]);
  const filteredPosts = groupPosts.filter((post) => {
    if (platformFilter !== 'all' && post.platform !== platformFilter) return false;
    if (onlyFavorites && !post.isFavorite) return false;
    const query = search.trim().toLowerCase();
    return !query || [post.title, post.author, post.tags.join(' '), post.transcript].some((value) => value.toLowerCase().includes(query));
  });
  const selectedPost = filteredPosts.find((post) => post.id === selectedPostId) ?? filteredPosts[0] ?? null;
  const effectiveSelection = selectedPostIds.length > 0 ? selectedPostIds : selectedPost ? [selectedPost.id] : [];

  useEffect(() => {
    let active = true;
    const incomingSearch = sessionStorage.getItem('benchmark_search');
    if (incomingSearch) setSearch(incomingSearch);
    sessionStorage.removeItem('benchmark_search');
    Promise.all([api.listBenchmarkGroups(), api.listBenchmarkPosts()])
      .then(([nextGroups, nextPosts]) => {
        if (!active) return;
        setGroups(nextGroups);
        setPosts(nextPosts);
        const focusPostId = sessionStorage.getItem('benchmark_focus_post');
        const focusPost = focusPostId ? nextPosts.find((post) => post.id === focusPostId) : undefined;
        setSelectedGroupId((current) => focusPost?.groupId ?? (current && nextGroups.some((group) => group.id === current) ? current : nextGroups[0]?.id ?? ''));
        if (focusPost) setSelectedPostId(focusPost.id);
        sessionStorage.removeItem('benchmark_focus_post');
      })
      .catch(benchmarkAction.reportError);
    return () => {
      active = false;
    };
  }, [api, benchmarkAction.reportError]);

  useEffect(() => {
    setDetailNote(selectedPost?.note ?? '');
  }, [selectedPost?.id, selectedPost?.note]);

  async function reload(preferredGroupId?: string, preferredPostId?: string) {
    const [nextGroups, nextPosts] = await Promise.all([api.listBenchmarkGroups(), api.listBenchmarkPosts()]);
    setGroups(nextGroups);
    setPosts(nextPosts);
    setSelectedGroupId(preferredGroupId && nextGroups.some((group) => group.id === preferredGroupId) ? preferredGroupId : nextGroups[0]?.id ?? '');
    setSelectedPostId(preferredPostId && nextPosts.some((post) => post.id === preferredPostId) ? preferredPostId : '');
  }

  function openNewGroup() {
    setGroupDraft(emptyGroupDraft);
    setShowGroupDialog(true);
    setMessage('');
  }

  function openEditGroup(group: BenchmarkGroup) {
    setGroupDraft({
      id: group.id,
      name: group.name,
      track: group.track,
      tags: group.tags.join('、'),
      notes: group.notes,
      refreshPolicy: group.refreshPolicy,
      douyinUrl: group.accounts.find((account) => account.platform === 'douyin')?.url ?? '',
      wechatUrl: group.accounts.find((account) => account.platform === 'wechat-channels')?.url ?? '',
      bilibiliUrl: group.accounts.find((account) => account.platform === 'bilibili')?.url ?? '',
    });
    setShowGroupDialog(true);
  }

  async function saveGroup() {
    const accounts: BenchmarkGroupInput['accounts'] = [
      { platform: 'douyin', url: groupDraft.douyinUrl },
      { platform: 'wechat-channels', url: groupDraft.wechatUrl },
      { platform: 'bilibili', url: groupDraft.bilibiliUrl },
    ].filter((account) => account.url.trim()) as BenchmarkGroupInput['accounts'];
    const result = await benchmarkAction.run(async () => api.saveBenchmarkGroup({
      id: groupDraft.id || undefined,
      name: groupDraft.name,
      track: groupDraft.track,
      tags: splitTags(groupDraft.tags),
      notes: groupDraft.notes,
      refreshPolicy: groupDraft.refreshPolicy,
      accounts,
    }), { onError: (error) => setMessage(error.message) });
    if (!result.ok || !result.value) return;
    await reload(result.value.id);
    setShowGroupDialog(false);
    setMessage(isBrowserPreview ? '对标组已保存。浏览器预览只保留本地数据，请在 Electron 桌面端同步账号。' : '对标组已保存，可立即同步账号作品与公开指标。');
  }

  async function syncGroup(group: BenchmarkGroup) {
    if (isBrowserPreview) {
      setMessage('浏览器预览不执行跨站账号同步；请在 Electron 桌面端操作。');
      return;
    }
    setSyncingGroupId(group.id);
    setMessage(`正在同步「${group.name}」的 ${group.accounts.length} 个平台账号...`);
    const result = await benchmarkAction.run(() => api.syncBenchmarkGroup(group.id), { onError: (error) => setMessage(error.message) });
    setSyncingGroupId('');
    if (!result.ok || !result.value) return;
    await reload(group.id, selectedPost?.id);
    const ready = result.value.accounts.filter((account) => account.syncState === 'ready').length;
    const needsLogin = result.value.accounts.filter((account) => account.syncState === 'requires-login').length;
    const limited = result.value.accounts.filter((account) => account.syncState === 'limited' || account.syncState === 'error').length;
    setMessage([
      `${ready}/${result.value.accounts.length} 个账号同步成功`,
      `新增 ${result.value.importedCount} 条，更新 ${result.value.updatedCount} 条`,
      needsLogin ? `${needsLogin} 个需要登录` : '',
      limited ? `${limited} 个受限或失败` : '',
    ].filter(Boolean).join('；'));
  }

  async function openAccountLogin(group: BenchmarkGroup, account: BenchmarkGroup['accounts'][number]) {
    setLoginAccountId(account.id);
    setMessage(`请在打开的${benchmarkPlatformLabel(account.platform)}窗口完成登录，关闭窗口后会重新同步。`);
    try {
      await api.openBenchmarkLogin({ platform: account.platform, url: account.url });
      await syncGroup(group);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoginAccountId('');
    }
  }

  async function deleteGroup(group: BenchmarkGroup) {
    if (!window.confirm(`删除对标组「${group.name}」及其本地作品？`)) return;
    const result = await benchmarkAction.run(() => api.deleteBenchmarkGroup(group.id));
    if (!result.ok) return;
    await reload();
    setSelectedPostIds([]);
    setMessage('对标组已删除。');
  }

  function openNewPost() {
    if (!selectedGroup) {
      setMessage('请先添加对标组。');
      return;
    }
    setPostDraft(emptyPostDraft);
    setShowPostDialog(true);
    setMessage('');
  }

  function handlePostLink(value: string) {
    const classification = classifyBenchmarkUrl(value);
    setPostDraft((current) => ({
      ...current,
      sourceLink: value,
      platform: classification.platform === 'unknown' ? current.platform : classification.platform,
    }));
  }

  async function savePost() {
    if (!selectedGroup) return;
    const metrics = collectMetrics(postDraft);
    const result = await benchmarkAction.run(() => api.saveBenchmarkPost({
      groupId: selectedGroup.id,
      platform: postDraft.platform,
      sourceUrl: postDraft.sourceLink,
      coverUrl: postDraft.coverUrl.trim() || undefined,
      title: postDraft.title,
      author: postDraft.author,
      publishedAt: postDraft.publishedAt ? Date.parse(postDraft.publishedAt) : null,
      durationSeconds: numberOrNull(postDraft.durationSeconds),
      transcript: postDraft.script,
      tags: splitTags(postDraft.keyword),
      metrics,
      metricCapturedAt: Date.now(),
    }), { onError: (error) => setMessage(error.message) });
    if (!result.ok || !result.value) return;
    await reload(selectedGroup.id, result.value.id);
    setShowPostDialog(false);
    setMessage('作品与本次指标快照已保存。');
  }

  async function patchPost(post: BenchmarkPost, patch: Partial<BenchmarkPostInput>) {
    const result = await benchmarkAction.run(() => api.saveBenchmarkPost(benchmarkPostInput(post, patch)));
    if (result.ok && result.value) await reload(post.groupId, result.value.id);
    return result;
  }

  async function saveDetailNote() {
    if (!selectedPost) return;
    const result = await patchPost(selectedPost, { note: detailNote });
    if (result.ok) setMessage('备注已保存。');
  }

  async function deletePost(post: BenchmarkPost) {
    if (!window.confirm(`删除本地作品「${post.title}」？`)) return;
    const result = await benchmarkAction.run(() => api.deleteBenchmarkPost(post.id));
    if (!result.ok) return;
    await reload(post.groupId);
    setSelectedPostIds((items) => items.filter((id) => id !== post.id));
  }

  async function addSelectedToSelections() {
    const targets = posts.filter((post) => effectiveSelection.includes(post.id));
    if (targets.length === 0 || !selectedGroup) return;
    const result = await benchmarkAction.run(async () => {
      const existingSelections = await api.listBookSelections();
      for (const post of targets) {
        const score = scores.get(post.id) ?? scoreBenchmarkPost(post, groupPosts);
        const bookId = `benchmark-${post.id}`;
        const existing = existingSelections.find((record) => record.bookId === bookId);
        const evidence = {
          postId: post.id,
          platform: post.platform,
          title: post.title,
          sourceUrl: post.sourceUrl,
          burstScore: score.score,
          note: score.explanation,
        };
        const opportunityInputs = {
          demand: score.score ?? 50,
          gap: Math.round(55 + score.components.crossPlatform * 0.25),
          fit: 70,
          conversion: Math.round(score.components.deepEngagement),
          executionEase: 65,
        };
        const data: BookProductInfo = {
          ...(existing?.data ?? {}),
          name: existing?.data.name || post.title,
          category: existing?.data.category || selectedGroup.track || '对标候选',
          keyword: existing?.data.keyword || post.tags.join('、'),
          sellPoint: existing?.data.sellPoint || score.explanation,
          url: post.sourceUrl,
          note: existing?.data.note || post.transcript.slice(0, 600),
          selectionStatus: existing?.data.selectionStatus ?? 'candidate',
          opportunityScore: existing?.data.opportunityScore ?? {
            ...opportunityInputs,
            total: benchmarkOpportunityTotal(opportunityInputs),
            confidence: score.confidence,
            confirmed: false,
          },
          evidence: [...(existing?.data.evidence ?? []).filter((item) => item.postId !== post.id), evidence],
        };
        await api.saveBookSelection({
          theme: existing?.theme ?? (selectedGroup.track || selectedGroup.name),
          bookId,
          previousIdentity: existing ? { theme: existing.theme, bookId: existing.bookId } : undefined,
          data,
        });
        await api.saveBenchmarkPost(benchmarkPostInput(post, { workflowStatus: 'shortlisted' }));
      }
      await reload(selectedGroup.id, selectedPost?.id);
    }, { onError: (error) => setMessage(error.message) });
    if (!result.ok) return;
    setMessage(`已把 ${targets.length} 条作品加入选品候选。`);
    setSelectedPostIds([]);
  }

  function deepAnalyze(post: BenchmarkPost) {
    if (post.platform === 'wechat-channels') {
      setMessage('视频号深度拆解连接器尚未接入；可以先保存文案并创建任务。');
      return;
    }
    sessionStorage.setItem('benchmark_viral_url', post.sourceUrl);
    sessionStorage.setItem('benchmark_viral_platform', post.platform);
    navigate('viral-analyzer');
  }

  async function createBenchmarkTask(post: BenchmarkPost) {
    const script = post.transcript.trim();
    if (!script) {
      setMessage('该作品没有文案，请编辑或重新导入文案后再创建任务。');
      return;
    }
    if (isBrowserPreview) {
      sessionStorage.setItem('benchmark_script', script);
      navigate('new-task');
      return;
    }
    await benchmarkAction.run(async () => {
      setRunning(true);
      try {
        const next = await api.createAndRunTask({
          title: post.title,
          inputText: script,
          mode: 'paste',
          track: 'character-story',
          keepPromotion: false,
          pausePoints: [],
        });
        applyState(next);
        const task = taskFromMutation(next);
        if (task) openTaskDetail(task.id);
      } finally {
        setRunning(false);
      }
    }, { onError: (error) => setMessage(error.message) });
  }

  function toggleSelectedPost(id: string) {
    setSelectedPostIds((items) => items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  const abnormalCount = groupPosts.filter((post) => (scores.get(post.id)?.score ?? 0) >= 75).length;
  const shortlistedCount = groupPosts.filter((post) => post.workflowStatus === 'shortlisted').length;

  return (
    <div className="local-lab-workbench benchmark-import-layout" data-local-lab-workbench="benchmark">
      <aside className="local-lab-rail benchmark-group-rail">
        <div className="panel-title-row benchmark-panel-head">
          <div>
            <h2>对标组</h2>
            <span>{groups.length} 组 · 三平台独立状态</span>
          </div>
          <button className="icon-button" type="button" title="添加对标组" aria-label="添加对标组" onClick={openNewGroup}><Plus size={16} /></button>
        </div>
        <label className="benchmark-search-field">
          <Search size={14} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索作品或账号" />
        </label>
        <div className="benchmark-group-list">
          {groups.length === 0 ? <EmptyState title="暂无对标组" action={<button className="mini-button" type="button" onClick={openNewGroup}><Plus size={14} />添加对标组</button>} /> : null}
          {groups.map((group) => (
            <article key={group.id} className={selectedGroup?.id === group.id ? 'benchmark-group-item active' : 'benchmark-group-item'}>
              <button type="button" className="benchmark-group-main" onClick={() => {
                setSelectedGroupId(group.id);
                setSelectedPostId('');
                setSelectedPostIds([]);
              }}>
                <strong>{group.name}</strong>
                <span>{group.track || '未设置赛道'} · {posts.filter((post) => post.groupId === group.id).length} 条作品</span>
              </button>
              <div className="benchmark-account-statuses">
                {benchmarkPlatforms.map((platform) => {
                  const account = group.accounts.find((item) => item.platform === platform);
                  return (
                    <div className="benchmark-account-status-item" key={platform} data-state={account?.syncState ?? 'missing'}>
                      <span title={account?.errorMessage || undefined}>{benchmarkPlatformLabel(platform)} · {account ? benchmarkAccountStateLabel(account) : '未添加'}</span>
                      {account?.syncState === 'requires-login' ? (
                        <button
                          type="button"
                          className="mini-button"
                          disabled={loginAccountId === account.id || syncingGroupId === group.id}
                          onClick={() => void openAccountLogin(group, account)}
                        ><LogIn size={12} />登录</button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="benchmark-group-actions">
                <button type="button" className="mini-button" onClick={() => openEditGroup(group)}>编辑</button>
                <button
                  type="button"
                  className="mini-button"
                  disabled={benchmarkAction.busy || isBrowserPreview || group.accounts.length === 0}
                  title={isBrowserPreview ? '浏览器预览只显示本地快照' : '同步账号公开作品与指标'}
                  onClick={() => void syncGroup(group)}
                >{syncingGroupId === group.id ? <Loader2 className="spin" size={13} /> : <RefreshCw size={13} />}{syncingGroupId === group.id ? '同步中' : '同步账号'}</button>
                <button type="button" className="icon-button danger" title="删除对标组" aria-label={`删除${group.name}`} disabled={benchmarkAction.busy} onClick={() => deleteGroup(group)}><Trash2 size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      </aside>

      <section className="benchmark-results-panel">
        <div className="benchmark-local-toolbar">
          <div className="segmented benchmark-platform-tabs" role="tablist" aria-label="平台筛选">
            {(['all', ...benchmarkPlatforms] as PlatformFilter[]).map((platform) => (
              <button key={platform} type="button" className={platformFilter === platform ? 'selected' : ''} onClick={() => setPlatformFilter(platform)}>
                {platform === 'all' ? '全部' : benchmarkPlatformLabel(platform)}
              </button>
            ))}
          </div>
          <button className="ghost-action compact-action" type="button" onClick={openNewPost}><FileSearch size={15} />单视频解析</button>
          <button className="primary-action slim" type="button" onClick={openNewGroup}><Plus size={15} />添加对标组</button>
        </div>

        <div className="benchmark-summary-strip">
          <span><strong>{groupPosts.length}</strong>全部作品</span>
          <span><strong>{abnormalCount}</strong>异常上涨</span>
          <span><strong>{groupPosts.filter((post) => post.workflowStatus !== 'analyzed').length}</strong>待拆解</span>
          <span><strong>{shortlistedCount}</strong>已入选品</span>
        </div>

        <div className="benchmark-filter-row">
          <button type="button" className={onlyFavorites ? 'mini-button active' : 'mini-button'} onClick={() => setOnlyFavorites((value) => !value)}><Star size={14} />只看收藏</button>
          <span>{selectedGroup ? `${selectedGroup.name} · ${filteredPosts.length} 条` : '请先添加对标组'}</span>
          <button type="button" className="ghost-action compact-action" disabled={!selectedGroup} onClick={openNewPost}><Plus size={14} />导入作品</button>
        </div>

        {effectiveSelection.length > 0 ? (
          <div className="benchmark-batch-bar">
            <span>已选 {effectiveSelection.length} 项</span>
            <button className="primary-action slim" type="button" disabled={benchmarkAction.busy} onClick={addSelectedToSelections}><Check size={14} />加入候选</button>
            <button className="mini-button" type="button" onClick={() => setSelectedPostIds([])}>取消选择</button>
          </div>
        ) : null}

        <div className="benchmark-post-list" role="listbox" aria-label="对标作品">
          {!selectedGroup ? <EmptyState title="先添加三平台对标组" action={<button className="mini-button" type="button" onClick={openNewGroup}><Plus size={14} />添加对标组</button>} /> : null}
          {selectedGroup && filteredPosts.length === 0 ? <EmptyState title="暂无匹配作品" action={<button className="mini-button" type="button" onClick={openNewPost}><Plus size={14} />导入作品</button>} /> : null}
          {filteredPosts.map((post) => {
            const score = scores.get(post.id) ?? scoreBenchmarkPost(post, groupPosts);
            return (
              <article key={post.id} className={selectedPost?.id === post.id ? 'benchmark-post-row active' : 'benchmark-post-row'} role="option" aria-selected={selectedPost?.id === post.id}>
                <input type="checkbox" aria-label={`选择${post.title}`} checked={selectedPostIds.includes(post.id)} onChange={() => toggleSelectedPost(post.id)} />
                <button type="button" className="benchmark-post-main" onClick={() => setSelectedPostId(post.id)}>
                  <BenchmarkCover coverUrl={post.coverUrl} platform={post.platform} />
                  <span className="benchmark-post-copy">
                    <strong>{post.title}</strong>
                    <small>{post.author || '未填账号'} · {formatDate(post.publishedAt)}</small>
                    <span>{post.tags.length ? post.tags.join(' · ') : '未添加标签'}</span>
                  </span>
                </button>
                <div className="benchmark-post-metrics">
                  <Metric label="播放" value={benchmarkMetricNumber(post.metrics, 'plays')} reason={post.metrics.plays?.reason} />
                  <Metric label="点赞" value={benchmarkMetricNumber(post.metrics, 'likes')} reason={post.metrics.likes?.reason} />
                  <Metric label="评论" value={benchmarkMetricNumber(post.metrics, 'comments')} reason={post.metrics.comments?.reason} />
                  <Metric label="收藏" value={benchmarkMetricNumber(post.metrics, 'favorites')} reason={post.metrics.favorites?.reason} />
                </div>
                <div className="benchmark-burst-score">
                  <strong>{score.score ?? '—'}</strong>
                  <span>爆发分 · {confidenceLabel(score.confidence)}</span>
                </div>
                <div className="benchmark-row-actions">
                  <button className="icon-button" type="button" title={post.isFavorite ? '取消收藏' : '收藏'} aria-label={post.isFavorite ? '取消收藏' : '收藏'} disabled={benchmarkAction.busy} onClick={() => patchPost(post, { isFavorite: !post.isFavorite })}><Star size={15} fill={post.isFavorite ? 'currentColor' : 'none'} /></button>
                  <button className="mini-button" type="button" disabled={post.platform === 'wechat-channels'} title={post.platform === 'wechat-channels' ? '视频号连接器待接入' : '进入爆款拆解'} onClick={() => deepAnalyze(post)}><Radar size={13} />拆解</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="benchmark-inspector">
        <div className="panel-title-row benchmark-panel-head">
          <div>
            <h3>作品详情</h3>
            <span>{selectedPost ? benchmarkPlatformLabel(selectedPost.platform) : '未选择作品'}</span>
          </div>
          {selectedPost ? <button className="icon-button danger" type="button" title="删除作品" aria-label="删除作品" disabled={benchmarkAction.busy} onClick={() => deletePost(selectedPost)}><Trash2 size={15} /></button> : null}
        </div>
        {!selectedPost ? <EmptyState title="选择一条作品查看详情" /> : (
          <>
            <div className="benchmark-inspector-body">
              <div className="benchmark-inspector-title">
                <strong>{selectedPost.title}</strong>
                <span>{selectedPost.author || '未填账号'} · {formatDate(selectedPost.publishedAt)}</span>
              </div>
              <BenchmarkCover coverUrl={selectedPost.coverUrl} platform={selectedPost.platform} variant="detail" />
              <div className="benchmark-inspector-score">
                <BarChart3 size={18} />
                <div>
                  <strong>{scores.get(selectedPost.id)?.score ?? '—'} 爆发分</strong>
                  <span>置信度 {confidenceLabel(scores.get(selectedPost.id)?.confidence ?? 'low')}</span>
                </div>
              </div>
              <p className="benchmark-score-explanation">{scores.get(selectedPost.id)?.explanation}</p>
              <div className="benchmark-inspector-metrics">
                {metricEntries(selectedPost.metrics).map(([key, metric]) => <Metric key={key} label={metricLabel(key)} value={metric.value} reason={metric.reason} />)}
              </div>
              <div className="benchmark-source-box">
                <span className="field-title">来源链接</span>
                <button type="button" className="mini-button" onClick={() => navigator.clipboard.writeText(selectedPost.sourceUrl)}><Clipboard size={13} />复制链接</button>
                <small>{selectedPost.sourceUrl}</small>
              </div>
              <Field label="对标文案">
                <textarea className="small-textarea" value={selectedPost.transcript} readOnly placeholder="导入作品时可粘贴转写稿或口播文案" />
              </Field>
              <Field label="备注">
                <textarea className="small-textarea" value={detailNote} onChange={(event) => setDetailNote(event.target.value)} />
              </Field>
            </div>
            <div className="benchmark-inspector-actions">
              <button className="mini-button" type="button" onClick={saveDetailNote}><Save size={14} />保存备注</button>
              <button className="mini-button" type="button" disabled={selectedPost.platform === 'wechat-channels'} onClick={() => deepAnalyze(selectedPost)}><Radar size={14} />深度拆解</button>
              <button className="mini-button" type="button" disabled={!selectedPost.transcript.trim() || running || benchmarkAction.busy} onClick={() => createBenchmarkTask(selectedPost)}>{running ? <Loader2 size={14} className="spin" /> : <FileSearch size={14} />}用此文案创建任务</button>
              <button className="primary-action slim" type="button" disabled={benchmarkAction.busy} onClick={addSelectedToSelections}><Check size={14} />加入选品候选</button>
            </div>
          </>
        )}
        {message ? <span className="local-note benchmark-message">{message}</span> : null}
        <InlineActionFeedback feedback={benchmarkAction.feedback} />
      </aside>

      {showGroupDialog ? (
        <div className="benchmark-dialog-backdrop" role="presentation">
          <section className="benchmark-dialog" role="dialog" aria-modal="true" aria-labelledby="benchmark-group-dialog-title">
            <div className="panel-title-row benchmark-panel-head">
              <div><h3 id="benchmark-group-dialog-title">{groupDraft.id ? '编辑对标组' : '添加对标组'}</h3><span>三个平台分别验证，至少填写一个账号主页链接</span></div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowGroupDialog(false)}><X size={16} /></button>
            </div>
            <div className="benchmark-dialog-grid">
              <Field label="对标组名称"><input value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} placeholder="例如：传统文化矩阵" /></Field>
              <Field label="赛道"><input value={groupDraft.track} onChange={(event) => setGroupDraft({ ...groupDraft, track: event.target.value })} placeholder="例如：图书带货" /></Field>
              <Field label="标签"><input value={groupDraft.tags} onChange={(event) => setGroupDraft({ ...groupDraft, tags: event.target.value })} placeholder="历史、文化、书单" /></Field>
              <Field label="监控频率"><select value={groupDraft.refreshPolicy} onChange={(event) => setGroupDraft({ ...groupDraft, refreshPolicy: event.target.value as typeof groupDraft.refreshPolicy })}><option value="manual">手动</option><option value="six-hours">每 6 小时（当前手动触发）</option><option value="daily">每天（当前手动触发）</option></select></Field>
            </div>
            <Field label="抖音账号主页链接"><input value={groupDraft.douyinUrl} onChange={(event) => setGroupDraft({ ...groupDraft, douyinUrl: event.target.value })} placeholder="https://www.douyin.com/user/..." /></Field>
            <Field label="视频号账号主页 / 分享入口"><input value={groupDraft.wechatUrl} onChange={(event) => setGroupDraft({ ...groupDraft, wechatUrl: event.target.value })} placeholder="https://channels.weixin.qq.com/..." /></Field>
            <Field label="B 站 UP 主空间链接"><input value={groupDraft.bilibiliUrl} onChange={(event) => setGroupDraft({ ...groupDraft, bilibiliUrl: event.target.value })} placeholder="https://space.bilibili.com/..." /></Field>
            <Field label="备注"><textarea className="small-textarea" value={groupDraft.notes} onChange={(event) => setGroupDraft({ ...groupDraft, notes: event.target.value })} /></Field>
            <div className="benchmark-dialog-actions"><button className="mini-button" type="button" onClick={() => setShowGroupDialog(false)}>取消</button><button className="primary-action slim" type="button" disabled={benchmarkAction.busy || !groupDraft.name.trim()} onClick={saveGroup}><Save size={14} />保存对标组</button></div>
          </section>
        </div>
      ) : null}

      {showPostDialog ? (
        <div className="benchmark-dialog-backdrop" role="presentation">
          <section className="benchmark-dialog benchmark-post-dialog" role="dialog" aria-modal="true" aria-labelledby="benchmark-post-dialog-title">
            <div className="panel-title-row benchmark-panel-head">
              <div><h3 id="benchmark-post-dialog-title">导入作品与指标快照</h3><span>账号同步之外，也可手动补充单条作品和可见数据</span></div>
              <button className="icon-button" type="button" aria-label="关闭" onClick={() => setShowPostDialog(false)}><X size={16} /></button>
            </div>
            <div className="benchmark-dialog-grid">
              <Field label="平台"><select value={postDraft.platform} onChange={(event) => setPostDraft({ ...postDraft, platform: event.target.value as BenchmarkPlatform })}>{benchmarkPlatforms.map((platform) => <option key={platform} value={platform}>{benchmarkPlatformLabel(platform)}</option>)}</select></Field>
              <Field label="来源链接"><input value={postDraft.sourceLink} onChange={(event) => handlePostLink(event.target.value)} placeholder="作品分享链接" /></Field>
              <Field label="封面图链接"><input value={postDraft.coverUrl} onChange={(event) => setPostDraft({ ...postDraft, coverUrl: event.target.value })} placeholder="https://...jpg" /></Field>
              <Field label="账号 / 标题"><input value={postDraft.title} onChange={(event) => setPostDraft({ ...postDraft, title: event.target.value })} placeholder="作品标题" /></Field>
              <Field label="账号名称"><input value={postDraft.author} onChange={(event) => setPostDraft({ ...postDraft, author: event.target.value })} /></Field>
              <Field label="关键词"><input value={postDraft.keyword} onChange={(event) => setPostDraft({ ...postDraft, keyword: event.target.value })} placeholder="历史、文化、图书" /></Field>
              <Field label="发布时间"><input type="datetime-local" value={postDraft.publishedAt} onChange={(event) => setPostDraft({ ...postDraft, publishedAt: event.target.value })} /></Field>
              <Field label="时长（秒）"><input type="number" min="0" value={postDraft.durationSeconds} onChange={(event) => setPostDraft({ ...postDraft, durationSeconds: event.target.value })} /></Field>
            </div>
            <span className="field-title">素材来源 · 平台可见指标</span>
            <div className="benchmark-metric-input-grid">
              {editableMetricKeys.map((key) => (
                <Field key={key} label={metricLabel(key)}><input type="number" min="0" value={postDraft[key]} onChange={(event) => setPostDraft({ ...postDraft, [key]: event.target.value })} placeholder="未提供则留空" /></Field>
              ))}
            </div>
            <Field label="对标文案"><textarea className="source-textarea benchmark-dialog-script" value={postDraft.script} onChange={(event) => setPostDraft({ ...postDraft, script: event.target.value })} placeholder="粘贴转写稿、口播文案或人工整理文本" /></Field>
            <div className="benchmark-meta-row"><span>字数：{countVisibleCharacters(postDraft.script)}</span><span>指标只保存本次真实输入，空值不会记为 0</span></div>
            <div className="benchmark-dialog-actions"><button className="mini-button" type="button" onClick={() => setShowPostDialog(false)}>取消</button><button className="primary-action slim" type="button" disabled={benchmarkAction.busy || !postDraft.sourceLink.trim() || !postDraft.title.trim()} onClick={savePost}><Save size={14} />保存作品</button></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function BenchmarkCover({
  coverUrl,
  platform,
  variant = 'thumbnail',
}: {
  coverUrl: string;
  platform: BenchmarkPlatform;
  variant?: 'thumbnail' | 'detail';
}) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(coverUrl.trim()) && !failed;
  const platformLabel = benchmarkPlatformLabel(platform);

  useEffect(() => {
    setFailed(false);
  }, [coverUrl]);

  return (
    <span className={variant === 'detail' ? 'benchmark-cover detail' : 'benchmark-cover'} data-cover-state={hasImage ? 'ready' : 'fallback'}>
      {hasImage ? <img src={coverUrl.trim()} alt={`${platformLabel}对标封面`} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} onLoad={() => setFailed(false)} /> : (
        <span className="benchmark-cover-fallback">
          <ImageIcon size={variant === 'detail' ? 28 : 18} strokeWidth={1.7} />
          <span>暂无封面</span>
        </span>
      )}
      <span className={`benchmark-cover-platform-badge ${platform}`}>{platformLabel}</span>
    </span>
  );
}

function collectMetrics(input: typeof emptyPostDraft): BenchmarkMetrics {
  const metrics: BenchmarkMetrics = {};
  for (const key of editableMetricKeys) {
    const value = numberOrNull(input[key]);
    metrics[key] = value === null ? { value: null, reason: '本次导入未提供' } : { value };
  }
  return metrics;
}

function benchmarkPostInput(post: BenchmarkPost, patch: Partial<BenchmarkPostInput>): BenchmarkPostInput {
  return {
    id: post.id,
    groupId: post.groupId,
    platform: post.platform,
    sourceUrl: post.sourceUrl,
    title: post.title,
    author: post.author,
    accountUrl: post.accountUrl || undefined,
    coverUrl: post.coverUrl || undefined,
    publishedAt: post.publishedAt,
    durationSeconds: post.durationSeconds,
    transcript: post.transcript,
    tags: post.tags,
    isFavorite: post.isFavorite,
    workflowStatus: post.workflowStatus,
    note: post.note,
    ...patch,
  };
}

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function splitTags(value: string): string[] {
  return [...new Set(value.split(/[、,，\s]+/u).map((item) => item.trim()).filter(Boolean))];
}

function formatDate(value: number | null): string {
  if (value === null) return '未填发布时间';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function benchmarkAccountStateLabel(account: BenchmarkGroup['accounts'][number]): string {
  if (account.syncState === 'ready') {
    return account.lastSyncedAt
      ? `已同步 ${new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(account.lastSyncedAt)}`
      : '已同步';
  }
  if (account.syncState === 'requires-login') return '需要登录';
  if (account.syncState === 'limited') return '平台受限';
  if (account.syncState === 'error') return '同步失败';
  return '待首次同步';
}

function formatMetric(value: number | null): string {
  if (value === null) return '—';
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)}w`;
  return new Intl.NumberFormat('zh-CN').format(value);
}

function Metric({ label, value, reason }: { label: string; value: number | null; reason?: string }) {
  return <span className="benchmark-metric" title={value === null ? reason || '平台未提供' : `${label} ${value}`}><strong>{formatMetric(value)}</strong><small>{label}</small></span>;
}

function metricEntries(metrics: BenchmarkMetrics): Array<[BenchmarkMetricKey, { value: number | null; reason?: string }]> {
  return Object.entries(metrics) as Array<[BenchmarkMetricKey, { value: number | null; reason?: string }]>;
}

function metricLabel(key: BenchmarkMetricKey): string {
  return { plays: '播放', likes: '点赞', comments: '评论', favorites: '收藏', shares: '转发', coins: '投币', danmaku: '弹幕', followers: '粉丝' }[key];
}

function confidenceLabel(value: 'low' | 'medium' | 'high'): string {
  return { low: '低', medium: '中', high: '高' }[value];
}
