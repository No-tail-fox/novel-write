import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, Copy, Download, Eye, FileText, FolderOpen, Images, LayoutTemplate, ListChecks, Moon, PanelLeft, Plus, Save, Settings2, Sparkles, Sun, Type, X } from 'lucide-react';
import { Button, IconButton, TextField, TextAreaField, SelectField, SegmentedControl, Dialog } from '../../../src/ui';
import { StoryDreamProvider } from '../../../src/ui/StoryDreamProvider';
import '../../../src/styles/tokens.css';
import '../../../src/styles/storydream-ui.css';
import './content-studio.css';

type Mode = 'note' | 'article';
type Platform = 'xiaohongshu' | 'douyin' | 'toutiao' | 'baijiahao' | 'blog';
type Sheet = { id: string; title: string; body: string; eyebrow: string };
type Variant = { title: string; summary: string; tags: string; pages: Sheet[]; sections: Sheet[]; layout: string; ratio: string };
type Store = { version: 1; variants: Record<Platform, Variant>; brief: string; audience: string };
const STORE_KEY = 'storydream-content-design-v1';
const platformNames: Record<Platform, string> = { xiaohongshu: '小红书', douyin: '抖音图文', toutiao: '今日头条', baijiahao: '百家号', blog: '博客 / 网站' };
const noteOptions = [{ value: 'xiaohongshu', label: '小红书' }, { value: 'douyin', label: '抖音图文' }];
const articleOptions = [{ value: 'toutiao', label: '今日头条' }, { value: 'baijiahao', label: '百家号' }, { value: 'blog', label: '博客 / 网站' }];
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const samplePages: Sheet[] = [
  { id: 'cover', eyebrow: '每周生活提案', title: '把一周，\n过得更有条理', body: '给忙碌日常的 4 个小建议\n从一张简单的清单开始' },
  { id: 'one', eyebrow: '01 / 留一点空白', title: '清单不用\n写得太满', body: '先写下这周最想完成的三件事。\n把「必须做」和「可以晚点做」分开。\n留出空白，接住计划之外的日常。' },
  { id: 'two', eyebrow: '02 / 给事情归位', title: '让每一件事，\n都有自己的位置', body: '工作、生活、学习分开记录。\n把相关资料放在任务旁边。\n下次开始时，就不用重新寻找。' },
  { id: 'three', eyebrow: '03 / 从小处开始', title: '把下一步，\n写得再具体一点', body: '不是「学会摄影」，\n而是「今天拍一张窗边的照片」。\n行动越具体，开始就越轻松。' },
  { id: 'four', eyebrow: '04 / 给自己反馈', title: '周末留十分钟，\n看看这一周', body: '哪些事情让你有成就感？\n哪些安排可以少一点？\n下周，留下真正适合自己的节奏。' },
  { id: 'ending', eyebrow: '从今天的一件小事开始', title: '有条理，\n也可以很轻松', body: '先收藏，周末试一试。\n你会从哪一个小习惯开始？' },
];
const sampleSections: Sheet[] = [
  { id: 'intro', eyebrow: '导语', title: '让计划为生活服务', body: '周一列了很长的清单，周五回头看，却很难说清自己完成了什么。问题未必是做得不够多，也可能是计划本身太满、下一步不够具体。\n\n与其把时间表填满，不如从下面四个小调整开始，给生活建立一个容易坚持的节奏。' },
  { id: 's1', eyebrow: '正文', title: '一、先选三件真正重要的事', body: '写下这一周最希望完成的三件事，再把其他安排分成「必须做」和「可以晚点做」。清单的作用是帮你选择，而不是让每一项都变成负担。\n\n例如，把「整理全部资料」缩小为「整理本周项目的参考文件」，就更容易开始，也更容易看见进展。' },
  { id: 's2', eyebrow: '正文', title: '二、把资料放在任务旁边', body: '把工作、生活和学习分开记录，并给每项任务留下相关资料的位置。下次开始时，打开任务就能接着做，不必再次寻找文件。' },
  { id: 's3', eyebrow: '正文', title: '三、让下一步足够具体', body: '「学会摄影」很难立刻执行，「今天拍一张窗边的照片」则有清楚的起点。尝试把目标改写成一个可以完成的小动作，再根据实际反馈调整。' },
  { id: 's4', eyebrow: '正文', title: '四、用十分钟回顾这一周', body: '周末回顾一下：什么安排有帮助，什么事情可以少做一点。复盘不一定要打分，也可以只是为下周留下两条提醒。' },
  { id: 'end', eyebrow: '结语', title: '从一个小习惯开始', body: '有条理不意味着每一分钟都有安排。找到适合自己的工具和节奏，让重要的事情更容易开始，也让生活保留一些空白。' },
];
function initialStore(): Store {
  const base: Variant = { title: '把一周过得更有条理的 4 个小建议', summary: '不把计划写满，也能照顾好重要的事。分享四个日常安排的小习惯，从一张简单的清单开始。', tags: '#生活整理 #每周计划 #自我成长', pages: samplePages, sections: sampleSections, layout: 'editorial', ratio: '3:4' };
  return { version: 1, brief: '围绕每周计划，分享普通人容易开始的四个日常整理习惯。语气亲切，给出具体行动，避免夸大效果。', audience: '想让工作与生活更有条理的年轻人', variants: {
    xiaohongshu: clone(base), douyin: { ...clone(base), title: '清单总做不完？试试这 4 个小调整', ratio: '9:16' },
    toutiao: { ...clone(base), title: '每周计划总是做不完？从这四个小调整开始', tags: '生活方式, 时间安排' },
    baijiahao: { ...clone(base), title: '如何制定每周计划：四个简单的日常整理方法', tags: '每周计划, 任务清单, 时间安排' },
    blog: { ...clone(base), title: '我的每周计划方法：留白、归位与回顾', tags: '生活记录, 每周计划' },
  } };
}
function isSheet(value: unknown): value is Sheet { const s = value as Sheet; return !!s && ['id', 'title', 'body', 'eyebrow'].every(k => typeof s[k as keyof Sheet] === 'string'); }
function readStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Store;
    if (s?.version === 1 && typeof s.brief === 'string' && typeof s.audience === 'string' && Object.keys(platformNames).every(p => {
      const v = s.variants?.[p as Platform]; return v && ['title','summary','tags','layout','ratio'].every(k => typeof v[k as keyof Variant] === 'string') && ['pages','sections'].every(k => Array.isArray(v[k as 'pages']) && v[k as 'pages'].length > 0 && v[k as 'pages'].every(isSheet));
    })) return s;
  } catch { /* Fall back to a clearly labeled example without overwriting the saved draft. */ }
  return initialStore();
}
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
function App() {
  const [data, setData] = useState(readStore);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mode, setMode] = useState<Mode>('note');
  const [platform, setPlatform] = useState<Platform>('xiaohongshu');
  const [screen, setScreen] = useState<'editor' | 'start'>('editor');
  const [stage, setStage] = useState<'edit' | 'preview'>('edit');
  const [selected, setSelected] = useState('cover');
  const [inspector, setInspector] = useState<'content' | 'style' | 'caption'>('content');
  const [dialog, setDialog] = useState<'brief' | 'export' | 'adapt' | 'help' | null>(null);
  const [exportType, setExportType] = useState('html');
  const [saveState, setSaveState] = useState('尚未保存');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const variant = data.variants[platform];
  const items = mode === 'note' ? variant.pages : variant.sections;
  const current = items.find(p => p.id === selected) ?? items[0];
  const currentIndex = items.indexOf(current);
  const wordCount = [...variant.sections.map(s => s.title + s.body).join('')].filter(s => !/\s/.test(s)).length;
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!dirty) return;
    const listener = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timer); }, [notice]);
  function updateVariant(patch: Partial<Variant>) {
    setData(prev => ({ ...prev, variants: { ...prev.variants, [platform]: { ...prev.variants[platform], ...patch } } }));
    setDirty(true); setSaveState('有未保存修改');
  }
  function updateSheet(patch: Partial<Sheet>) { updateVariant({ [mode === 'note' ? 'pages' : 'sections']: items.map(p => p.id === current.id ? { ...p, ...patch } : p) }); }
  function choosePlatform(next: Platform) {
    setPlatform(next); setSelected((mode === 'note' ? data.variants[next].pages : data.variants[next].sections)[0].id); setShowOutline(false);
  }
  function chooseMode(next: Mode) {
    const nextPlatform = next === 'note' ? 'xiaohongshu' : 'toutiao';
    setMode(next); setPlatform(nextPlatform); setSelected((next === 'note' ? data.variants[nextPlatform].pages : data.variants[nextPlatform].sections)[0].id); setStage('edit'); setScreen('editor'); setInspector('content'); setShowOutline(false);
  }
  function addSheet() {
    const fresh = { id: makeId(), title: mode === 'note' ? '写下这一页的重点' : '新的段落标题', body: '', eyebrow: mode === 'note' ? '内容页' : '正文' };
    updateVariant({ [mode === 'note' ? 'pages' : 'sections']: [...items, fresh] }); setSelected(fresh.id); setStage('edit'); setInspector('content');
  }
  function moveSheet(delta: number) {
    const next = currentIndex + delta; if (next < 0 || next >= items.length) return;
    const reordered = [...items]; [reordered[currentIndex], reordered[next]] = [reordered[next], reordered[currentIndex]];
    updateVariant({ [mode === 'note' ? 'pages' : 'sections']: reordered });
  }
  function duplicateSheet() { const copy = { ...current, id: makeId() }; const next = [...items]; next.splice(currentIndex + 1, 0, copy); updateVariant({ [mode === 'note' ? 'pages' : 'sections']: next }); setSelected(copy.id); }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); setDirty(false); setSaveState('已保存到此浏览器'); setNotice('五个平台版本已保存，可关闭后继续编辑。'); }
    catch { setSaveState('保存失败，请导出备份'); setNotice('浏览器存储不可用或空间不足，请导出内容备份。'); }
  }
  function download() {
    const isNote = mode === 'note';
    const list = isNote ? variant.pages : variant.sections;
    const md = `# ${variant.title}\n\n${variant.summary}\n\n${list.map(s => `## ${s.title.replaceAll('\n', ' ')}\n\n${s.body}`).join('\n\n')}\n\n${variant.tags}\n`;
    const content = exportType === 'markdown' ? md : `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(variant.title)}</title><style>body{font:17px/1.85 system-ui,sans-serif;color:#242629;background:#f7f7f8;margin:32px auto;max-width:760px;padding:0 24px}h1{font-size:32px;line-height:1.4}section{background:white;padding:40px;margin:24px 0;${isNote ? `aspect-ratio:${variant.ratio.replace(':','/')};box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;` : ''}}h2{white-space:pre-line;line-height:1.4;${isNote ? 'font-size:38px;' : ''}}p{white-space:pre-wrap}small{color:#a93a2d}@media print{section{break-inside:avoid;${isNote ? 'break-after:page;' : ''}}}</style><h1>${escapeHtml(variant.title)}</h1><p>${escapeHtml(variant.summary)}</p>${list.map(s => `<section><small>${escapeHtml(s.eyebrow)}</small><h2>${escapeHtml(s.title)}</h2><p>${escapeHtml(s.body)}</p></section>`).join('')}<p>${escapeHtml(variant.tags)}</p></html>`;
    const blob = new Blob([content], { type: exportType === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `${variant.title.replace(/[<>:"/\\|?*\n]/g, '-').slice(0,60) || '未命名内容'}-${platform}.${exportType === 'markdown' ? 'md' : 'html'}`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setDialog(null); setNotice('已发起文件下载。');
  }
  function adapt() {
    const nextMode = mode === 'note' ? 'article' : 'note';
    const nextPlatform = nextMode === 'article' ? 'toutiao' : 'xiaohongshu';
    const source = mode === 'note' ? variant.pages : variant.sections;
    const converted = source.map(s => ({ ...s, id: makeId(), title: s.title.replaceAll('\n', ' '), eyebrow: nextMode === 'article' ? '正文' : s.eyebrow }));
    const nextVariant = { ...data.variants[nextPlatform], title: variant.title, summary: variant.summary, tags: variant.tags, [nextMode === 'article' ? 'sections' : 'pages']: converted };
    setData(prev => ({ ...prev, variants: { ...prev.variants, [nextPlatform]: nextVariant } })); setMode(nextMode); setPlatform(nextPlatform); setSelected(converted[0].id); setStage('edit'); setInspector('content'); setDialog(null); setDirty(true); setSaveState('有未保存修改'); setNotice('已复制内容结构，请继续编辑目标版本。');
  }
  const titleMissing = !variant.title.trim();
  return <StoryDreamProvider theme={theme}><div className="cs-app">
    <aside className="cs-sidebar" aria-label="创作导航">
      <div className="cs-brand"><span className="cs-brand-mark">S</span><div><strong>StoryDream</strong><small>创作工作台</small></div></div>
      <Button aria-label="新建创作" title="新建创作" variant="primary" icon={<Plus size={17}/>} onClick={() => setScreen('start')}>新建创作</Button>
      <div className="cs-side-label">创作</div>
      <Button aria-label="图文笔记" title="图文笔记" variant="subtle" className={mode === 'note' && screen === 'editor' ? 'is-current' : ''} icon={<Images size={18}/>} aria-pressed={mode === 'note' && screen === 'editor'} onClick={() => chooseMode('note')}>图文笔记</Button>
      <Button aria-label="文章博文" title="文章博文" variant="subtle" className={mode === 'article' && screen === 'editor' ? 'is-current' : ''} icon={<FileText size={18}/>} aria-pressed={mode === 'article' && screen === 'editor'} onClick={() => chooseMode('article')}>文章博文</Button>
      <div className="cs-side-rule"/>
      <div className="cs-side-label">当前项目</div>
      <div className="cs-project-note"><BookOpen size={16}/><span>每周生活提案<small>示例项目 · 可自由编辑</small></span></div>
      <Button aria-label="创作简报" title="创作简报" variant="subtle" icon={<Sparkles size={16}/>} onClick={() => setDialog('brief')}>创作简报</Button>
      <Button aria-label="导出内容" title="导出内容" variant="subtle" icon={<FolderOpen size={16}/>} onClick={() => setDialog('export')}>导出内容</Button>
      <div className="cs-side-bottom"><span className="cs-prototype-tag">交互设计原型</span><p>把一个想法，写成不同的作品。</p><Button variant="subtle" icon={<CircleHelp size={16}/>} onClick={() => setDialog('help')}>原型说明</Button></div>
    </aside>
    <main className="cs-main">
      <header className="cs-header"><div className="cs-header-left"><IconButton label="返回创作选择" variant="subtle" icon={<ArrowLeft size={18}/>} onClick={() => setScreen('start')}/><div><div className="cs-breadcrumb">项目 <span>/</span> 每周生活提案</div><h1>{screen === 'start' ? '新建创作' : mode === 'note' ? '图文笔记' : '文章博文'}</h1></div></div><div className="cs-header-actions"><span className={`cs-save-state ${dirty ? 'is-dirty' : ''}`}><span/>{saveState}</span><IconButton label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'} variant="subtle" icon={theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}/><Button icon={<Save size={15}/>} onClick={save}>保存</Button></div></header>
      {screen === 'start' ? <section className="cs-start"><div className="cs-start-heading"><span>新的创作方式</span><h2>一个想法，多种表达。</h2><p>先选择内容形式，再选择适合它的平台。</p></div><div className="cs-start-types"><Button className="cs-type-card" variant="subtle" onClick={() => chooseMode('note')}><Images size={30}/><h3>图文笔记</h3><p>用一组图片讲清一个主题。</p><span>封面 · 多页排版 · 配文 · 话题</span><small>小红书 / 抖音图文 <ArrowRight size={16}/></small></Button><Button className="cs-type-card" variant="subtle" onClick={() => chooseMode('article')}><FileText size={30}/><h3>文章博文</h3><p>把观点和资料组织成一篇好文章。</p><span>提纲 · 正文 · 配图 · 引用</span><small>今日头条 / 百家号 / 博客 <ArrowRight size={16}/></small></Button></div><div className="cs-start-info"><CheckCheck size={20}/><div><strong>内容可以延展，版本各自保存</strong><p>图文可以整理成文章，文章也能拆成多页图文。每个平台保留自己的标题与内容。</p></div></div></section> : <>
      <div className="cs-workbar"><div className="cs-platform-tabs"><span className="cs-field-prefix">平台版本</span><SegmentedControl label="平台版本" value={platform} options={mode === 'note' ? noteOptions : articleOptions} onChange={v => choosePlatform(v as Platform)}/></div><div className="cs-workbar-right"><Button variant="subtle" icon={<Sparkles size={15}/>} onClick={() => setDialog('adapt')}>{mode === 'note' ? '整理成文章' : '拆成图文'}</Button><Button variant="primary" icon={<Download size={15}/>} onClick={() => setDialog('export')}>导出</Button></div></div>
      <div className={`cs-workspace cs-workspace--${mode} ${showOutline ? 'show-outline' : ''}`}>
        <aside className="cs-outline" aria-label={mode === 'note' ? '图文页面' : '文章大纲'}><div className="cs-pane-heading"><strong>{mode === 'note' ? '图文页面' : '文章大纲'}</strong><span>{items.length} {mode === 'note' ? '页' : '节'}</span></div><div className="cs-outline-items">{items.map((item, i) => <Button key={item.id} variant="subtle" className={`cs-outline-item ${current.id === item.id ? 'is-selected' : ''}`} aria-pressed={current.id === item.id} onClick={() => { setSelected(item.id); setShowOutline(false); if (mode === 'article' && stage === 'preview') requestAnimationFrame(() => document.getElementById(`read-${item.id}`)?.scrollIntoView({ block: 'start' })); }}><span className="cs-outline-number">{String(i+1).padStart(2,'0')}</span>{mode === 'note' ? <span className={`cs-mini-page ${variant.layout}`}><small>{item.eyebrow}</small><b>{item.title}</b><i/></span> : <FileText size={16}/>}<span className="cs-outline-copy"><strong>{mode === 'note' ? (i === 0 ? '封面' : item.eyebrow) : item.title}</strong><small>{mode === 'note' ? item.title.replaceAll('\n','') : `${item.body.length} 字`}</small></span></Button>)}</div><div className="cs-outline-footer"><Button variant="subtle" icon={<Plus size={15}/>} onClick={addSheet}>{mode === 'note' ? '添加页面' : '添加段落'}</Button><div className="cs-reorder"><IconButton label="向上移动" variant="subtle" icon={<ArrowUp size={15}/>} disabled={currentIndex === 0} onClick={() => moveSheet(-1)}/><IconButton label="向下移动" variant="subtle" icon={<ArrowDown size={15}/>} disabled={currentIndex === items.length-1} onClick={() => moveSheet(1)}/><IconButton label="复制当前内容" variant="subtle" icon={<Copy size={15}/>} onClick={duplicateSheet}/></div></div></aside>
        <section className="cs-canvas-pane" aria-label="内容画布"><div className="cs-canvas-toolbar"><div><IconButton className="cs-outline-toggle" label="显示页面列表" variant="subtle" icon={<PanelLeft size={16}/>} onClick={() => setShowOutline(!showOutline)}/><span>{stage === 'preview' ? `${platformNames[platform]} · 阅读预览` : mode === 'note' ? `第 ${currentIndex + 1} 页 / ${items.length} 页` : '正文编辑'}</span></div><SegmentedControl label="工作区视图" value={stage} options={[{value:'edit',label:'编辑',icon:<Type size={14}/>},{value:'preview',label:'预览',icon:<Eye size={14}/>}]} onChange={setStage}/></div>
          <div className={`cs-canvas-scroll ${stage === 'preview' ? 'is-preview' : ''}`}>
            {mode === 'note' ? <div className={`cs-note-stage ${stage === 'preview' ? 'cs-feed-preview' : ''}`}>
              {stage === 'preview' && <div className="cs-feed-heading"><span className="cs-avatar"><BookOpen size={18}/></span><span>每周生活提案<small>阅读效果预览</small></span><span className="cs-preview-platform">{platformNames[platform]}</span></div>}
              <div className={`cs-note-paper ${variant.layout} ${variant.ratio === '9:16' ? 'is-tall' : ''}`} data-canvas-ratio={variant.ratio}><div className="cs-paper-top"><span>{current.eyebrow || '内容页'}</span><span>{String(currentIndex+1).padStart(2,'0')}</span></div><div className="cs-paper-main"><div className="cs-paper-rule"/><h2>{current.title || '填写页面标题'}</h2><p>{current.body || '在右侧写下这一页的内容。'}</p></div><div className="cs-paper-bottom"><span>每周生活提案</span><span>{currentIndex === 0 ? '向后翻，看看具体怎么做' : `${currentIndex+1} / ${items.length}`}</span></div></div>
              {stage === 'preview' && <div className="cs-feed-caption"><h3>{variant.title}</h3><p>{variant.summary}</p><span>{variant.tags}</span></div>}
            </div> : stage === 'preview' ? <article className="cs-article-paper"><div className="cs-article-kicker">{platformNames[platform]} · 阅读预览</div><h2>{variant.title || '填写文章标题'}</h2><p className="cs-article-summary">{variant.summary}</p>{platform === 'blog' && <nav className="cs-article-toc" aria-label="文章目录"><strong>目录</strong>{variant.sections.map((s,i)=><a href={`#read-${s.id}`} key={s.id}>{i+1}. {s.title}</a>)}</nav>}{variant.sections.map(s=><section key={s.id} id={`read-${s.id}`}><h3>{s.title}</h3>{s.body.split('\n\n').map((p,i)=><p key={i}>{p}</p>)}</section>)}<div className="cs-article-tags">{variant.tags}</div></article> : <div className="cs-article-editor"><div className="cs-article-meta"><FileText size={16}/> {platformNames[platform]}独立版本 <span>{wordCount} 字</span></div><TextAreaField rows={2} label="文章标题" value={variant.title} validationMessage={titleMissing ? '请输入文章标题' : undefined} onChange={e=>updateVariant({title:e.target.value})} fieldClassName="cs-article-title-field"/><TextAreaField label="摘要 / 导语" value={variant.summary} onChange={e=>updateVariant({summary:e.target.value})} rows={2}/><div className="cs-section-divider"><span>当前段落 · {currentIndex+1} / {items.length}</span><span>左侧选择其他段落</span></div><TextField label="段落标题" value={current.title} onChange={e=>updateSheet({title:e.target.value})}/><TextAreaField label="段落正文" value={current.body} onChange={e=>updateSheet({body:e.target.value})} rows={12} hint="空行划分自然段。切换段落会保留正在编辑的内容。"/><div className="cs-next-section"><Button variant="subtle" icon={<ChevronLeft size={15}/>} disabled={currentIndex===0} onClick={()=>setSelected(items[currentIndex-1].id)}>上一段</Button><Button variant="subtle" icon={<ChevronRight size={15}/>} disabled={currentIndex===items.length-1} onClick={()=>setSelected(items[currentIndex+1].id)}>下一段</Button></div></div>}
          </div><footer className="cs-canvas-footer"><span>{mode === 'note' ? `${variant.ratio} · ${variant.layout === 'editorial' ? '清单手册' : variant.layout === 'minimal' ? '留白文字' : '重点提案'}` : `${wordCount} 字 · 约 ${Math.max(1,Math.ceil(wordCount/400))} 分钟阅读`}</span>{mode === 'note' ? <div><IconButton label="上一页" variant="subtle" disabled={currentIndex===0} icon={<ChevronLeft size={15}/>} onClick={()=>setSelected(items[currentIndex-1].id)}/><span>{currentIndex+1} / {items.length}</span><IconButton label="下一页" variant="subtle" disabled={currentIndex===items.length-1} icon={<ChevronRight size={15}/>} onClick={()=>setSelected(items[currentIndex+1].id)}/></div> : <span>示例内容，可自由改写</span>}</footer>
        </section>
        <aside className="cs-inspector" aria-label="内容属性"><div className="cs-pane-heading"><strong>{mode === 'note' ? '页面与配文' : '文章设置'}</strong><Settings2 size={15}/></div>
          {mode === 'note' ? <><SegmentedControl className="cs-inspector-tabs" label="属性分类" value={inspector} options={[{value:'content',label:'内容'},{value:'style',label:'版式'},{value:'caption',label:'配文'}]} onChange={setInspector}/><div className="cs-inspector-scroll">{inspector === 'content' ? <><div className="cs-section-label"><span>当前页面</span><span>{currentIndex===0?'封面':`第 ${currentIndex+1} 页`}</span></div><TextField label="页眉标签" value={current.eyebrow} onChange={e=>updateSheet({eyebrow:e.target.value})}/><TextAreaField label="页面标题" value={current.title} rows={3} onChange={e=>updateSheet({title:e.target.value})} hint="建议只讲一个重点，换行会同步到画布。"/><TextAreaField label="页面正文" value={current.body} rows={6} onChange={e=>updateSheet({body:e.target.value})}/><div className="cs-writing-tip"><Type size={16}/><p>先让封面说清楚看点，再用内容页逐一展开，最后留一个自然的互动问题。</p></div></> : inspector === 'style' ? <><SelectField label="画布比例" value={variant.ratio} options={[{value:'3:4',label:'3:4 · 竖版笔记'},{value:'9:16',label:'9:16 · 全屏图文'},{value:'1:1',label:'1:1 · 方形卡片'}]} onChange={e=>updateVariant({ratio:e.target.value})}/><span className="cs-field-label">整组版式</span><div className="cs-layout-options">{[{id:'editorial',name:'清单手册',hint:'大标题 · 条理清楚'},{id:'minimal',name:'留白文字',hint:'干净排版 · 轻阅读'},{id:'bold',name:'重点提案',hint:'醒目封面 · 强层级'}].map(t=><Button key={t.id} className={variant.layout===t.id?'is-selected':''} variant="subtle" aria-pressed={variant.layout===t.id} onClick={()=>updateVariant({layout:t.id})}><LayoutTemplate size={20}/><span><strong>{t.name}</strong><small>{t.hint}</small></span>{variant.layout===t.id&&<Check size={15}/>}</Button>)}</div><p className="cs-hint">版式应用于当前平台的全部页面，其他平台版本保持独立。</p></> : <><TextField label="发布标题" value={variant.title} validationMessage={titleMissing?'请输入发布标题':undefined} onChange={e=>updateVariant({title:e.target.value})}/><TextAreaField label="笔记配文" value={variant.summary} rows={8} onChange={e=>updateVariant({summary:e.target.value})}/><TextAreaField label="话题标签" value={variant.tags} rows={3} onChange={e=>updateVariant({tags:e.target.value})}/><p className="cs-hint">配文与图片文字分别编辑。切换到预览可以一起检查。</p></>}</div></> : <div className="cs-inspector-scroll"><div className="cs-section-label">发布信息</div><TextField label={platform==='blog'?'文章分类':'内容分类'} value={variant.tags} onChange={e=>updateVariant({tags:e.target.value})}/><div className="cs-guidance"><h3>{platform==='toutiao'?'把观点讲清楚':platform==='baijiahao'?'回答一个具体问题':'写成可长期阅读的内容'}</h3><p>{platform==='toutiao'?'标题呈现核心观点，开头交代问题；用小标题组织案例与解释。':platform==='baijiahao'?'标题对准读者的问题，正文围绕问题展开，资料来源随段落保留。':'正文保持清晰层级，提供目录、分类与摘要，方便读者回访。'}</p></div><div className="cs-section-label">参考资料</div><div className="cs-sources-empty"><BookOpen size={22}/><strong>当前使用原创示例文案</strong><p>正式创作可从热榜、链接或本地资料带入内容与出处。</p></div><Button variant="subtle" icon={<Sparkles size={15}/>} onClick={()=>setDialog('brief')}>查看创作简报</Button><div className="cs-writing-tip"><ListChecks size={18}/><p>AI 辅助将围绕选中段落提供续写、精简和改写，修改前先展示差异。</p></div></div>}
          <div className="cs-check-footer"><CheckCheck size={16}/><span>平台版本独立保存<small>示例预设，发布前以平台要求为准</small></span></div>
        </aside>
      </div></>}
    </main>
    {notice&&<div className="cs-toast" role="status"><Check size={17}/>{notice}<IconButton label="关闭提示" variant="subtle" icon={<X size={14}/>} onClick={()=>setNotice('')}/></div>}
    <Dialog open={dialog==='brief'} onOpenChange={open=>!open&&setDialog(null)} title="创作简报" actions={<Button variant="primary" onClick={()=>setDialog(null)}>回到编辑</Button>}><div className="cs-dialog-form"><p>一份简报统筹内容，各平台版本单独编辑。</p><TextAreaField label="主题与表达要求" value={data.brief} rows={5} onChange={e=>{setData({...data,brief:e.target.value});setDirty(true);setSaveState('有未保存修改');}}/><TextField label="目标读者" value={data.audience} onChange={e=>{setData({...data,audience:e.target.value});setDirty(true);setSaveState('有未保存修改');}}/><div className="cs-brief-steps"><span>选题与资料</span><ArrowRight size={14}/><span>结构与初稿</span><ArrowRight size={14}/><span>排版与版本</span></div><p className="cs-hint">此原型演示编辑流程。正式版本会在这里调用已配置的模型，生成可审核的提纲、图文分页面与初稿。</p></div></Dialog>
    <Dialog open={dialog==='export'} onOpenChange={open=>!open&&setDialog(null)} title="导出当前平台版本" actions={<><Button onClick={()=>setDialog(null)}>取消</Button><Button variant="primary" icon={<Download size={15}/>} disabled={titleMissing} onClick={download}>下载文件</Button></>}><div className="cs-dialog-form"><div className="cs-export-heading"><FileText size={22}/><span><strong>{variant.title||'尚未填写标题'}</strong><small>{platformNames[platform]} · {mode==='note'?`${variant.pages.length} 页图文`:`${wordCount} 字`}</small></span></div><SelectField label="文件格式" value={exportType} options={[{value:'html',label:mode==='note'?'HTML · 可浏览和打印的图文页面':'HTML · 排版文章'},{value:'markdown',label:'Markdown · 标题、正文与标签'}]} onChange={e=>setExportType(e.target.value)}/><p className="cs-hint">{mode==='note'?'当前原型导出可阅读的图文 HTML 或文案。正式版本增加整组 PNG / JPG 与素材打包。':'正文按当前段落顺序导出，适合复制到内容平台或继续编辑。'}</p>{titleMissing&&<p className="cs-error" role="alert">先填写发布标题，再导出内容。</p>}<div className="cs-export-check"><Check size={16}/>保留当前平台的标题、正文与标签</div></div></Dialog>
    <Dialog open={dialog==='adapt'} onOpenChange={open=>!open&&setDialog(null)} title={mode==='note'?'把图文整理成文章':'把文章拆成图文'} actions={<><Button onClick={()=>setDialog(null)}>取消</Button><Button variant="primary" onClick={adapt}>复制结构并打开</Button></>}><div className="cs-dialog-form"><p>{mode==='note'?'每页的标题和文字将按顺序复制为文章段落。':'每个段落将复制成一页图文，之后可以继续精简和排版。'}</p><p>将替换「{mode==='note'?'今日头条':'小红书'}」当前原型中的目标版本。原稿保留；建议先保存或导出目标版本。</p><p className="cs-hint">原型只转换内容结构。正式版本可让 AI 先提供改编草稿，审核后再创建新的作品。</p></div></Dialog>
    <Dialog open={dialog==='help'} onOpenChange={open=>!open&&setDialog(null)} title="图文与文章创作 · 设计原型" actions={<Button variant="primary" onClick={()=>setDialog(null)}>开始体验</Button>}><div className="cs-dialog-form"><p>可以体验多页图文编辑、文章段落编辑、平台独立版本、三种图文版式、阅读预览、主题切换、本地保存和文件导出。</p><p>内容是可编辑示例。AI 生成、素材导入、整组图片导出和平台发布属于后续接入范围。</p><p>保存只写入当前浏览器，尚未连接 StoryDream 项目数据库。</p></div></Dialog>
  </div></StoryDreamProvider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
