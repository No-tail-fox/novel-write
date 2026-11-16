from pathlib import Path
import base64
import re
root = Path(__file__).resolve().parent.parent
p = root / 'artifacts/storyboard-preview.html'
s = p.read_text(encoding='utf-8')
asset = root / 'src/assets/creative-style-previews/cel-anime-80s.webp'
uri = 'data:image/webp;base64,' + base64.b64encode(asset.read_bytes()).decode()
s = s.replace('../src/assets/creative-style-previews/cel-anime-80s.webp', uri)
s = re.sub(r'<div class="rail-thumb">(\d+)</div>', lambda m: '<div class="rail-thumb"><img src="'+uri+'" alt="">'+ '</div>', s)
s = re.sub(r'<div class="shot-thumb">分镜 (\d+)</div>', lambda m: '<div class="shot-thumb"><img src="'+uri+'" alt="分镜 '+m[1]+' 风格示意"></div>', s)
s = s.replace('<button class="btn ghost">预览</button>', '<button class="btn ghost" id="preview-toggle" aria-pressed="false">专注画面</button>')
s = s.replace('<button class="btn primary">一键全部生成</button>', '<button class="btn primary" disabled title="交互原型尚未连接生成服务">生成（未接入）</button>')
s = s.replace('<button>流程</button><button>成稿</button>', '<button disabled>流程</button><button disabled>成稿</button>')
s = s.replace('<button class="btn ghost">对比</button>', '<span style="font-size:12px;color:var(--shell-muted)">风格预览 · 16:9</span>')
s = s.replace('<div class="shot-add">＋ 添加分镜</div>', '<button class="shot-add" disabled title="此版仅预览布局">＋ 添加分镜</button>')
s = s.replace('<div class="timeline-head">时间轴 · 共 4 格</div>', '<div class="timeline-head">分镜序列 · 4 格 · 同一风格图用于布局示意</div>')
for i, label in enumerate(['画面描述 Prompt', '对白', '画幅比例', '风格预设', '镜头景别']):
    s = s.replace('<label>'+label+'</label>', '<label for="field-'+str(i)+'">'+label+'</label>')
    pattern = r'(<label for="field-'+str(i)+r'">[^<]+</label>\s*<(textarea|input|select))'
    s = re.sub(pattern, r'\1 id="field-'+str(i)+'"', s)
s = s.replace('黄昏的都市天台，主角背对镜头远眺，风吹动外套，冷色调，电影感构图。', '霓虹灯下的少女，佩戴耳麦与护目镜，风吹动发丝，赛璐璐风格，蓝紫色调。')
s = s.replace('<label>生成参数</label>', '<span style="color:var(--shell-muted);font-size:12px">参数示例 · 只读</span>')
s = s.replace('<input value="角色一致性 0.75" readonly>', '<input aria-label="角色一致性示例" value="一致性 0.75" readonly>')
s = s.replace('<input value="风格强度 0.60" readonly>', '<input aria-label="风格强度示例" value="风格 0.60" readonly>')
s = s.replace('</body>', '''<script>
const items=[...document.querySelectorAll('.rail-item')];
const shots=[...document.querySelectorAll('.shot')];
const drafts=items.map(()=>({prompt:document.querySelector('#field-0').value,dialogue:document.querySelector('#field-1').value}));
let current=0;
function selectShot(i){
 drafts[current]={prompt:document.querySelector('#field-0').value,dialogue:document.querySelector('#field-1').value};current=i;
 [items,shots].forEach(group=>group.forEach((el,n)=>{el.classList.toggle('active',n===i);el.setAttribute('aria-pressed',String(n===i));}));
 document.querySelector('#scene-title').textContent=String(i+1).padStart(2,'0')+' / '+items[i].querySelector('.rail-name').textContent;
 document.querySelector('.badge').textContent='分镜 '+String(i+1).padStart(2,'0')+' · 风格示意';
 document.querySelector('#field-0').value=drafts[i].prompt;document.querySelector('#field-1').value=drafts[i].dialogue;
}
[items,shots].forEach(group=>group.forEach((el,i)=>{el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label','选择分镜 '+(i+1));el.setAttribute('aria-pressed',String(i===0));el.onclick=()=>selectShot(i);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectShot(i);}};}));
document.querySelector('#preview-toggle').onclick=function(){const active=this.getAttribute('aria-pressed')!=='true';this.setAttribute('aria-pressed',String(active));document.querySelector('.rail').hidden=active;document.querySelector('.inspector').hidden=active;this.textContent=active?'返回编辑':'专注画面';};
document.querySelector('#field-2').onchange=function(){const ratio=['16/9','9/16','1/1'][this.selectedIndex];document.querySelector('.frame').style.aspectRatio=ratio;document.querySelector('.scene-summary small').textContent=this.value+' · 示例画面';};
</script>
</body>''')
s=s.replace('</style>', '[hidden]{display:none!important}\n[role="button"]:focus-visible{outline:2px solid var(--shell-accent);outline-offset:2px}\n</style>')
p.write_text(s, encoding='utf-8')
print('Updated standalone preview with embedded illustration and selection interactions.')
