import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, BookOpenText, Box, Check, ChevronRight, Clapperboard, FileText, FolderOpen, Image, Layers3, MapPin, Pin, Plus, Save, Users } from 'lucide-react';
import { Button, IconButton, StoryDreamProvider, Tabs, TextAreaField, TextField, Toolbar } from '../../../src/ui';
import referenceImage from '../../../src/assets/drawing-style-previews/ghibli.webp';
import '../../../src/styles/tokens.css';
import '../../../src/styles/storydream-ui.css';
import './concept.css';

const episodes = ['一封旧信', '河边的书铺', '消失的落款', '旧街重逢', '藏在书里的答案', '雨停之前'];
const scenes = [
  { act: '第一幕 · 来信', title: '书铺的午后', place: '临河书铺', text: '林夏在窗前修补旧书。一封没有邮戳的信，被压在待修的书页之间。', line: '这本书，是谁送来的？' },
  { act: '第一幕 · 来信', title: '熟悉的笔迹', place: '临河书铺', text: '林夏展开信纸，指尖停在熟悉的落款上。她转头看向柜台，老陈避开了她的目光。', line: '三年了……你还活着。' },
  { act: '第二幕 · 寻找', title: '河边的约定', place: '石桥', text: '林夏沿河走向石桥，在桥洞下找到一枚刻有日期的旧铜钥匙。', line: '明天日落前，到老地方。' },
  { act: '第二幕 · 寻找', title: '桥上的身影', place: '石桥', text: '一道人影在桥上停留。林夏抬头时，只看见翻飞的衣角。', line: '等等！' },
];
const query = new URLSearchParams(location.search);
const theme = query.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.dataset.theme = theme;

function Concept() {
  const [area, setArea] = useState(query.get('view') === 'assets' ? 'assets' : 'production');
  const [episode, setEpisode] = useState(0);
  const [scene, setScene] = useState(0);
  const [category, setCategory] = useState('人物');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('林夏');
  const [saved, setSaved] = useState(true);
  const [reviewTab, setReviewTab] = useState('scenes');
  const active = scenes[scene];
  const names = category === '人物' ? ['林夏', '老陈', '林远'] : category === '地点' ? ['临河书铺', '石桥'] : ['旧信封', '铜钥匙'];
  return <StoryDreamProvider theme={theme}><div className="concept-app">
    <aside className="concept-global"><span className="concept-brand">S<span>StoryDream</span></span><Button variant="primary" icon={<Plus size={15} />}>新建项目</Button><nav><span><FolderOpen size={17} />项目</span><span><Image size={17} />素材库</span><span className="active"><Clapperboard size={17} />AI 漫剧</span><span><Layers3 size={17} />HTML 动画</span></nav><small>本地工作区</small></aside>
    <main className="concept-main"><header className="concept-page-heading"><div><small>项目 / AI 漫剧</small><h1>河畔来信</h1></div><span className="concept-status"><i />工作区已同步</span></header>
      <div className="concept-project-heading"><span><IconButton label="返回项目" variant="subtle" icon={<ArrowLeft size={15} />} /><BookOpenText size={17} /><strong>河畔来信</strong><small>6 集 · 国风动画</small></span><Toolbar aria-label="概念稿项目操作"><small>{saved ? '已保存' : '未保存'}</small><Button variant={saved ? 'subtle' : 'primary'} density="compact" icon={<Save size={14} />} onClick={() => setSaved(true)}>保存</Button></Toolbar></div>
      <div className="concept-project-tabs"><Tabs label="项目功能区" value={area} onChange={setArea} items={[{ value: 'production', label: '分集制作', icon: <Clapperboard size={15} /> }, { value: 'assets', label: '项目资产', icon: <Users size={15} /> }]} /><small>3 人物 · 2 地点 · 2 道具</small></div>
      {area === 'production' ? <><div className="concept-stages">{['剧本导入', '分集拆解', '分幕分场', '分镜图', '视频生成', '配音合成', '成片导出'].map((label, i) => <span key={label} className={i === 1 ? 'active' : i === 0 ? 'done' : ''}>{i === 0 ? <Check size={14} /> : <span>{i + 1}</span>}{label}</span>)}</div>
        <div className="concept-production"><aside className="concept-episodes"><header><strong>分集剧本</strong><small>6 集</small></header><TextField label="查找分集" placeholder="集数或标题" value={search} onChange={(_, data) => setSearch(data.value)} /><div className="concept-scroll">{episodes.map((title, i) => ({ title, i })).filter(({ title, i }) => `${i + 1}${title}`.includes(search)).map(({ title, i }) => <Button key={title} variant="subtle" aria-pressed={episode === i} onClick={() => setEpisode(i)}><span><small>EP {String(i + 1).padStart(2, '0')}</small><strong>{title}</strong><small>{i === 0 ? '待审核 · 2 幕 4 场' : i < 3 ? '剧本已生成' : '待生成剧本'}</small></span><span className={i === 0 ? 'concept-dot warn' : 'concept-dot'} /></Button>)}</div><footer>本集来源 · 原文第 1–3 段</footer></aside>
          <section className="concept-script"><header><div><h2>第 {episode + 1} 集 · {episodes[episode]}</h2><small>待审核 · 剧本版本 2 · 约 65 秒</small></div><span className="concept-badge warn">待确认项目资产</span></header><Tabs label="分集视图" value="script" onChange={() => {}} items={[{ value: 'source', label: '原文与边界' }, { value: 'script', label: '剧本与对白' }, { value: 'board', label: '分镜 (0)' }]} /><div className="concept-overview"><strong>本集梗概</strong><span>修书师林夏收到失踪哥哥的来信，循着信中线索前往河边。</span><ChevronRight size={14} /></div>
            <Tabs label="剧本拆解视图" value={reviewTab} onChange={setReviewTab} items={[{ value: 'scenes', label: '分幕分场' }, { value: 'characters', label: '人物 (3)' }, { value: 'locations', label: '地点 (2)' }, { value: 'props', label: '道具 (2)' }]} />
            {reviewTab === 'scenes' ? <div className="concept-scene-layout"><aside className="concept-scene-nav"><header><strong>2 幕 · 4 场</strong></header><div className="concept-scroll">{scenes.map((item, i) => <div key={item.title}>{i % 2 === 0 ? <h3>{item.act}</h3> : null}<Button variant="subtle" aria-pressed={scene === i} onClick={() => setScene(i)}><span><small>{String(i + 1).padStart(2, '0')}</small><strong>{item.title}</strong><small><MapPin size={12} />{item.place}</small></span></Button></div>)}</div></aside><article className="concept-beats"><header><div><small>{active.act}</small><h3>{active.title}</h3></div><span><MapPin size={13} />{active.place}</span></header><div className="concept-scroll"><div className="concept-beat"><span>01 <small>动作</small></span><TextAreaField label="剧情内容" rows={3} value={active.text} onChange={() => setSaved(false)} /><small>原文依据 S1–S2 <ChevronRight size={12} /></small></div><div className="concept-beat"><span>02 <small>对白 · 林夏</small></span><TextAreaField label="对白内容" rows={2} value={active.line} onChange={() => setSaved(false)} /><small>原文依据 S2 <ChevronRight size={12} /></small></div><div className="concept-beat"><span>03 <small>动作</small></span><p>她收起信纸，看向窗外的河面。</p></div></div></article></div> : <div className="concept-identity-list">{(reviewTab === 'characters' ? ['林夏', '老陈', '林远'] : reviewTab === 'locations' ? ['临河书铺', '石桥'] : ['旧信封', '铜钥匙']).map((name) => <div key={name}><Users size={16} /><strong>{name}</strong><span>复用项目资产</span><Check size={15} /></div>)}</div>}
            <footer className="concept-script-actions"><small><Users size={14} />3 人物 · 2 地点 · 2 道具已匹配</small><Button variant="primary" icon={<Check size={14} />} onClick={() => setSaved(true)}>批准本集剧本</Button></footer>
          </section></div></> : <div className="concept-library"><aside className="concept-library-list"><Tabs label="资产分类" value={category} onChange={(value) => { setCategory(value); setSelected(value === '人物' ? '林夏' : value === '地点' ? '临河书铺' : '旧信封'); setSearch(''); }} items={[{ value: '人物', label: '人物 3', icon: <Users size={14} /> }, { value: '地点', label: '地点 2', icon: <MapPin size={14} /> }, { value: '道具', label: '道具 2', icon: <Box size={14} /> }]} /><TextField label="搜索项目资产" placeholder="名称或别名" value={search} onChange={(_, data) => setSearch(data.value)} /><div className="concept-scroll">{names.filter((name) => name.includes(search)).map((name, i) => <Button key={name} variant="subtle" aria-pressed={selected === name} onClick={() => setSelected(name)}><span className="concept-asset-symbol">{category === '人物' ? <Users size={18} /> : category === '地点' ? <MapPin size={18} /> : <Box size={18} />}</span><span><strong>{name}</strong><small>{i === 0 ? '固定参考已就绪' : '待补参考图'}</small></span><span className={`concept-dot ${i ? 'warn' : ''}`} /></Button>)}</div><footer><FileText size={14} />系列设定</footer></aside>
        <section className="concept-asset-detail"><header><div><h2>{selected}</h2><small>{category} · 跨集共用</small></div><Button variant="secondary" density="compact" icon={<Plus size={14} />}>新增{category}</Button></header><small className="concept-id">身份 ID · character-lin-xia</small><div className="concept-identity"><TextField label={`${category}名称`} value={selected} onChange={(_, data) => { setSelected(data.value); setSaved(false); }} /><TextField label="别名" value="小夏、修书师" onChange={() => setSaved(false)} /><TextAreaField label="身份定义" rows={2} value="27 岁修书师，沉静敏锐。棕黑色长发，左眉尾有细小疤痕。" onChange={() => setSaved(false)} /></div><div className="concept-look-title"><strong>造型与固定参考</strong><Button variant="secondary" density="compact" icon={<Plus size={13} />}>新增造型</Button></div><div className="concept-look"><div className="concept-look-image"><img src={referenceImage} alt="仓库已有风格样图，用于概念稿参考区占位" /><span><Pin size={13} />固定参考 · v2</span></div><div className="concept-look-fields"><TextField label="造型名称" value="书铺常服" onChange={() => setSaved(false)} /><TextAreaField label="外观与服装" rows={3} value="米白交领上衣，深灰围裙。长发松挽，额前保留碎发。" onChange={() => setSaved(false)} /><TextAreaField label="连续性要求" rows={2} value="左眉疤痕、发髻和围裙颜色保持一致。" onChange={() => setSaved(false)} /></div></div><div className="concept-use"><strong>分集引用</strong><span>EP 01</span><span>EP 02</span><span>EP 03</span><small>3 集共用同一身份</small></div></section></div>}
    </main>
  </div></StoryDreamProvider>;
}

createRoot(document.getElementById('root')!).render(<Concept />);
