from pathlib import Path
p=Path(__file__).resolve().parent
s=(p/'storyboard-preview.html').read_text(encoding='utf-8')
s=s.replace('漫剧分镜编辑器 · 动效原型','漫剧分镜编辑器 · 分镜总览')
s=s.replace('</style>', '''
/* 总览版：镜头网格承担主要工作区，序列条只保留节奏信息。 */
.rail{width:160px}.inspector{width:300px}.stage-canvas{padding:18px;display:flex;flex-direction:column;gap:16px}
.overview-heading{display:flex;align-items:end;justify-content:space-between;gap:12px}.overview-heading h2{font-size:19px;margin:0 0 5px}.overview-heading p{margin:0;color:var(--shell-muted);font-size:12px}
.board-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.board{padding:0;min-width:0;background:var(--shell-surface-raised);border:1px solid var(--shell-border);border-radius:9px;overflow:hidden;text-align:left;color:var(--shell-text);cursor:pointer;transition:transform 200ms var(--ease-spring),box-shadow 200ms,border-color 140ms}
.board:hover{transform:translateY(-3px);box-shadow:var(--elev-2)}.board[aria-pressed=true]{border-color:var(--shell-accent);box-shadow:0 0 0 1px var(--shell-accent)}
.board-image{aspect-ratio:16/9;overflow:hidden;position:relative;background:#111}.board-image img{width:100%;height:100%;object-fit:cover;transition:transform 220ms var(--ease-out)}
.board:nth-child(2) img{transform:scale(1.55);transform-origin:43% 42%}.board:nth-child(3) img{transform:scale(1.18);transform-origin:65% 50%}.board:nth-child(4) img{transform:scale(1.8);transform-origin:35% 35%}
.board-info{padding:12px}.board-info strong{font-size:13px}.board-info p{margin:6px 0;color:var(--shell-muted);font-size:12px;line-height:1.5}.board-meta{display:flex;justify-content:space-between;color:var(--shell-muted);font-size:11px}.shot-number{position:absolute;top:8px;left:8px;background:#101214dd;padding:3px 7px;border-radius:4px;color:#fff;font-size:11px}
.timeline{height:91px}.timeline-track{gap:8px;padding:10px 16px}.shot{width:calc((100% - 128px)/4);min-width:120px}.shot-thumb{display:none}.shot-foot{border-top:0;padding:8px 12px}.shot.active{background:#352321}.shot-add{width:88px}
.scene-summary,.context-row{display:none}.frame{flex:none}.overview-hint{font-size:12px;color:var(--shell-muted);margin:0}.inspector-title{font-size:14px;margin:0;padding-bottom:12px;border-bottom:1px solid var(--shell-border)}
@media(min-width:1600px){.stage-canvas{padding:20px 28px}.board-grid{gap:20px}}
@media(max-width:1100px){.rail{width:132px}.inspector{width:250px}.stage-canvas{padding:12px}.board-grid{gap:12px}.board-info{padding:9px}}
@media(max-width:780px){.rail{width:auto}.inspector{width:auto}.stage-canvas{display:block}.board-grid{margin:16px 0}.overview-hint{margin-bottom:12px}.timeline-track{overflow:auto}.timeline{height:96px}.inspector-title{grid-column:1/-1}}
@media(max-width:480px){.board-grid{grid-template-columns:1fr}.overview-heading{align-items:start;flex-direction:column}}
@media(prefers-reduced-motion:reduce){.board:hover{transform:none}}
</style>''')
s=s.replace('<aside class="inspector">','<aside class="inspector"><h2 class="inspector-title">镜头 01 · 画面设置</h2>')
s=s.replace('<button class="on">画布</button><button disabled>流程</button><button disabled>成稿</button>', '<button class="on" id="overview-mode" aria-pressed="true">分镜总览</button><button id="single-mode" aria-pressed="false">单镜头</button>')
s=s.replace('分镜序列 · 4 格 · 同一风格图用于布局示意','镜头顺序 · 4 个镜头 · 预计 16 秒（示例）')
s=s.replace('</script>', '''
const stage=document.querySelector('.stage-canvas');
const grid=document.createElement('div');grid.className='board-grid';
const heading=document.createElement('div');heading.className='overview-heading';heading.innerHTML='<div><h2>把故事，排成画面。</h2><p>第 1 话 / 序章 · 4 个镜头</p></div><span style="color:var(--shell-muted);font-size:12px">布局草案 02</span>';
const hint=document.createElement('p');hint.className='overview-hint';hint.textContent='点击编辑 · 双击放大 · 图片为同一素材的裁切示意';
const names=['开场 / 建立氛围','特写 / 角色登场','推进 / 捕捉反应','收尾 / 留下悬念'];
const descriptions=['霓虹穿过夜色，视线落在人物身上。','拉近面部，让人物情绪成为视觉中心。','镜头缓慢推进，短暂停顿后接入对白。','用一个近景结束，为下一幕留下空间。'];
const boards=names.map((name,i)=>{const b=document.createElement('button');b.className='board';b.type='button';b.setAttribute('aria-pressed',String(i===0));b.innerHTML='<div class="board-image"><img alt="镜头裁切示意"><span class="shot-number">SHOT 0'+(i+1)+'</span></div><div class="board-info"><strong>'+name+'</strong><p>'+descriptions[i]+'</p><div class="board-meta"><span>示意画面</span><span>0'+(i+1)+' / 04 · 4.0s</span></div></div>';b.querySelector('img').src=document.querySelector('#scene-image').src;b.onclick=()=>selectShot(i);b.ondblclick=()=>setMode(true);grid.append(b);return b;});
stage.prepend(heading,grid,hint);
const baseSelect=selectShot;
selectShot=function(i){baseSelect(i);boards.forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)));document.querySelector('.inspector-title').textContent='镜头 0'+(i+1)+' · 画面设置';};
function setMode(single){grid.hidden=single;heading.hidden=single;hint.hidden=single;document.querySelector('.frame').hidden=!single;document.querySelector('#overview-mode').classList.toggle('on',!single);document.querySelector('#single-mode').classList.toggle('on',single);document.querySelector('#overview-mode').setAttribute('aria-pressed',String(!single));document.querySelector('#single-mode').setAttribute('aria-pressed',String(single));}
document.querySelector('#overview-mode').onclick=()=>setMode(false);document.querySelector('#single-mode').onclick=()=>setMode(true);setMode(false);
</script>''')
(p/'storyboard-overview.html').write_text(s,encoding='utf-8')
print('Created storyboard-overview.html')
