export interface DirectorRenderRequest {
  id: string;
}

export interface DirectorRenderResult {
  outputPath: string;
  durationMs: number;
  sizeBytes: number;
}

export interface DirectorRenderScene {
  id: string;
  index: number;
  title: string;
  caption: string;
  durationMs: number;
  imagePath: string;
  audioPath: string;
  layoutTemplate?: string;
  motionPreset?: string;
  subtitleStyle?: string;
}

export function directorCanvasForRatio(ratio: string): { width: number; height: number } {
  if (ratio === '9:16') return { width: 1080, height: 1920 };
  if (ratio === '1:1') return { width: 1440, height: 1440 };
  if (ratio === '4:3') return { width: 1440, height: 1080 };
  return { width: 1920, height: 1080 };
}

export function buildDirectorSceneHtml(input: {
  title: string;
  caption: string;
  imageUrl: string;
  durationMs: number;
  modeLabel: string;
  index: number;
  layoutTemplate?: string;
  motionPreset?: string;
  subtitleStyle?: string;
}): string {
  const durationSeconds = Math.max(0.8, input.durationMs / 1000);
  const title = escapeHtml(input.title);
  const caption = escapeHtml(input.caption);
  const imageUrl = escapeHtml(input.imageUrl);
  const modeLabel = escapeHtml(input.modeLabel);
  const shotIndex = String(input.index).padStart(2, '0');
  const layoutClass = input.layoutTemplate === '纪录片 · 纯画面' ? 'documentary' : input.layoutTemplate === '漫画分格 · 角色优先' ? 'comic' : 'collage';
  const subtitleClass = input.subtitleStyle === '简体中文 · 下方黑底' ? 'backplate' : 'outline';
  const motionPreset = input.motionPreset ?? '平移 + 缓慢推进';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'nonce-director-render'; script-src 'nonce-director-render';" />
  <style nonce="director-render">
    html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#090b0c;color:#fff;font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif}
    .frame{position:relative;width:100%;height:100%;overflow:hidden;background:#090b0c}
    .frame.comic{inset:2%;width:96%;height:96%;border:8px solid #fff;box-sizing:border-box}
    img{position:absolute;inset:-4%;width:108%;height:108%;object-fit:cover;transform-origin:center center;filter:saturate(.94) contrast(1.04)}
    .shade{position:absolute;inset:0;background:rgba(6,8,9,.16);box-shadow:inset 0 -260px 160px rgba(6,8,9,.7)}
    .meta{position:absolute;top:4.2%;left:4.2%;display:flex;gap:12px;align-items:center;font-size:22px;font-weight:700;text-shadow:0 2px 8px #000}
    .meta b{color:#ff6255}
    .title{position:absolute;left:7%;right:7%;bottom:17%;font-size:clamp(36px,4.2vw,76px);font-weight:800;line-height:1.12;text-align:center;text-shadow:0 3px 14px #000}
    .frame.documentary .title{font-size:clamp(30px,3.2vw,58px);text-align:left;right:32%}
    .frame.comic .title{bottom:15%;text-align:left}
    .caption{position:absolute;left:8%;right:8%;bottom:6%;padding:.6em .9em;font-size:clamp(28px,2.5vw,48px);font-weight:650;line-height:1.35;text-align:center}
    .caption.backplate{background:rgba(7,9,10,.82);text-shadow:0 2px 5px #000}
    .caption.outline{background:transparent;color:#fff;text-shadow:-2px -2px 0 #000,2px -2px 0 #000,-2px 2px 0 #000,2px 2px 0 #000,0 3px 8px #000}
  </style>
</head>
<body>
  <div class="frame ${layoutClass}">
    <img id="scene-image" src="${imageUrl}" alt="" />
    <div class="shade"></div>
    <div class="meta"><b>${modeLabel}</b><span>SHOT ${shotIndex}</span></div>
    <div class="title">${title}</div>
    <div class="caption ${subtitleClass}">${caption}</div>
  </div>
  <script nonce="director-render">
    (() => {
      const duration = ${JSON.stringify(durationSeconds)};
      const motionPreset = ${JSON.stringify(motionPreset)};
      const image = document.getElementById('scene-image');
      let current = 0;
      let playing = false;
      let startedAt = 0;
      let frame = 0;
      const seek = (time) => {
        current = Math.max(0, Math.min(duration, Number(time) || 0));
        const progress = duration > 0 ? current / duration : 0;
        if (motionPreset === '固定机位') {
          image.style.transform = 'scale(1) translate3d(0,0,0)';
        } else if (motionPreset === '轻微视差') {
          image.style.transform = 'scale(' + (1 + progress * 0.03).toFixed(4) + ') translate3d(' + (progress * 0.6).toFixed(3) + '%, ' + (progress * -0.45).toFixed(3) + '%, 0)';
        } else {
          image.style.transform = 'scale(' + (1 + progress * 0.055).toFixed(4) + ') translate3d(' + (progress * -0.9).toFixed(3) + '%, ' + (progress * -0.35).toFixed(3) + '%, 0)';
        }
      };
      const tick = (now) => {
        if (!playing) return;
        seek((now - startedAt) / 1000);
        if (current >= duration) { playing = false; return; }
        frame = requestAnimationFrame(tick);
      };
      window.__tl = {
        seek,
        duration: () => duration,
        play: () => { cancelAnimationFrame(frame); playing = true; startedAt = performance.now() - current * 1000; frame = requestAnimationFrame(tick); },
        pause: () => { playing = false; cancelAnimationFrame(frame); },
      };
      seek(0);
      window.__ready = true;
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);
}
