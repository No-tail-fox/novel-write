/** Runs inside the actual render browser. SVG uses glyph geometry, HTML uses layout boxes. */
export function creativeLayoutInspectionScript(minimumFontSize: number): string {
  return `(() => {
          const issues=[], texts=[], native=!!window.__lemo, root=native?document.body:document.querySelector('#root');
          if(!root) return {issues:['未找到动画内容'],text:''};
          const minimumFontSize=${minimumFontSize};
          const backgroundCandidates=Array.from(root.querySelectorAll('*')).flatMap(element=>{
            const r=element.getBoundingClientRect(),s=getComputedStyle(element);
            return r.left<=2&&r.top<=2&&r.right>=innerWidth-2&&r.bottom>=innerHeight*.8&&s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>=.95&&s.backgroundColor!=='rgba(0, 0, 0, 0)'?[s.backgroundColor]:[];
          });
          const caption=document.querySelector('.caption'), captionRect=caption?.getBoundingClientRect();
          const safeBottom=native?innerHeight:Math.min(innerHeight*.84,captionRect&&captionRect.height>0?captionRect.top:innerHeight);
           if(native){
             if(typeof window.TEXTS!=='function')issues.push('LEMO_TEXTS: 缺少原生文字边界协议');
             // Include actual stage draws so omitted or inaccurate TEXTS rows cannot hide annotations.
             for(const row of [...window.__lemo.texts(), ...(window.__lemo.frameTexts?.()??[])]){
               if(!row||typeof row.text!=='string'||![row.x0,row.y0,row.x1,row.y1,row.fontSize].every(Number.isFinite)||!row.fontFamily){issues.push('原生文字边界或字体无效');continue;}
               texts.push(row.text);
               if(row.clipped)issues.push('LEMO_TEXT_CLIPPED: 文字在离屏画布或贴图源区域被裁切：'+row.text.slice(0,80)+'。按实际字形宽高扩展文字面板或换行，保留完整文字并同步 texts(t)，不能删除边界记录。');
               if(row.fontSize<minimumFontSize-.5)issues.push('文字过小（'+Math.round(row.fontSize)+'px，至少'+Math.ceil(minimumFontSize)+'px；按最终画布缩放后计算）：'+row.text.slice(0,50));
               if(row.x0< -2||row.y0< -2||row.x1>innerWidth+2||row.y1>innerHeight+2||row.x1<=row.x0||row.y1<=row.y0)issues.push('原生文字超出画布或边界为空：'+row.text.slice(0,50));
             }
           }
          const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
          let node;
          while(node=walker.nextNode()) {
            const element=node.parentElement, text=node.textContent?.trim();
            if(!element||!text||element.closest('.caption,script,style,defs')) continue;
            let visible=true;
            for(let parent=element;parent;parent=parent.parentElement){const s=getComputedStyle(parent);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.1){visible=false;break;}}
            if(!visible) continue;
            const range=document.createRange();range.selectNodeContents(node);const r=range.getBoundingClientRect();
            if(r.width<1||r.height<1) continue;
            texts.push(text);
            const s=getComputedStyle(element),fontSize=parseFloat(s.fontSize),elementRect=element.getBoundingClientRect();
            const svgMatrix=typeof element.getScreenCTM==='function'?element.getScreenCTM():null;
            const renderedScale=element.offsetHeight?elementRect.height/element.offsetHeight:svgMatrix?Math.hypot(svgMatrix.c,svgMatrix.d):1;
            const renderedFontSize=fontSize*renderedScale;
            if(renderedFontSize<minimumFontSize-.5) issues.push('文字过小（'+Math.round(renderedFontSize)+'px，至少'+Math.ceil(minimumFontSize)+'px）：'+text.slice(0,50));
            const svgText=element.namespaceURI==='http://www.w3.org/2000/svg';
            if(!svgText&&(element.scrollWidth>element.clientWidth+6 || element.scrollHeight>element.clientHeight+6)) issues.push('文字容器溢出：'+text.slice(0,50));
            if(svgText) for(let viewport=element.closest('svg');viewport;viewport=viewport.parentElement?.closest('svg')) {
              const box=viewport.getBoundingClientRect(),overflow=getComputedStyle(viewport).overflow;
              if(overflow!=='visible' && (r.left<box.left-2 || r.top<box.top-2 || r.right>box.right+2 || r.bottom>box.bottom+2)){issues.push('SVG 文字被视口裁切：'+text.slice(0,50));break;}
            }
            if(r.left< -2||r.top< -2||r.right>innerWidth+2||r.bottom>innerHeight+2) issues.push('文字超出画布：'+text.slice(0,50));
            if(r.bottom>safeBottom+2) issues.push('文字侵入字幕保留区：'+text.slice(0,50));
          }
          return {issues:[...new Set(issues)].slice(0,8),text:texts.join(' '),background:backgroundCandidates.at(-1)};
        })()`;
}

