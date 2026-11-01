import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { SceneAsset, WriteJianyingDraftInput } from './draft';
import type { HtmlVideoComposition, HtmlVideoScene, HtmlVideoAudioClip } from './html-video';
import type { DraftTemplate, TaskArtifactVideoPreview } from './types';
import { getTemplate, resolveDraftTemplateForRatio, draftFontCssFamily } from './templates';
import { buildSubtitleTrack } from './story';
import { alignShortVideoSubtitles } from './short-video-subtitles';
import { resolveOrdinaryTaskCoverPageText } from './ordinary-task-cover';

export async function prepareShortVideoInput(input: WriteJianyingDraftInput, probe: (path: string) => Promise<number>): Promise<WriteJianyingDraftInput> {
  const narrationAudio: (SceneAsset & { durationMs: number })[] = [];
  for (const asset of input.narrationAudio) narrationAudio.push({ ...asset, durationMs: await probe(asset.path) });
  const scenes = input.scenes.map(scene => {
    const audio = narrationAudio.filter(a => a.sceneId === scene.id);
    if (!audio.length) throw new Error(`镜头 ${scene.id} 缺少配音`);
    return { ...scene, durationMs: Math.max(scene.durationMs, Math.ceil(audio.reduce((sum, a) => sum + a.durationMs, 0))) };
  });
  const template = resolveDraftTemplateForRatio(input.template ?? getTemplate(input.templateId), input.ratio);
  const original = input.subtitles ?? buildSubtitleTrack(input.scenes, { maxCharsPerLine: template.caption.maxCharsPerLine });
  // Preserve authored subtitle text; rebuild the single clock after measuring real audio.
  const subtitles = alignShortVideoSubtitles(scenes, narrationAudio, original);
  const bgm = input.bgm ? { ...input.bgm, durationMs: await probe(input.bgm.path) } : null;
  return { ...input, scenes, narrationAudio, subtitles, template, bgm };
}

export function buildShortVideoComposition(input: WriteJianyingDraftInput): HtmlVideoComposition {
  const template = resolveDraftTemplateForRatio(input.template ?? getTemplate(input.templateId), input.ratio);
  const width = template.canvas.width, height = template.canvas.height;
  if (width % 2 || height % 2) throw new Error('MP4 画布宽高必须为偶数');
  if (!input.scenes.length) throw new Error('短片至少需要一个镜头');
  const subtitles = input.subtitles ?? buildSubtitleTrack(input.scenes, { maxCharsPerLine: template.caption.maxCharsPerLine });
  const coverMs = input.coverPage?.durationMs ?? 0;
  const totalMs = coverMs + input.scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  const scenes: HtmlVideoScene[] = [];
  const bgmGain = template.audio.bgmVolume === 3 ? input.bgm?.volume ?? .3 : template.audio.bgmVolume / 10;
  function bgmClips(start: number, duration: number): HtmlVideoAudioClip[] {
    if (!input.bgm || bgmGain <= 0) return [];
    const length = input.bgm.durationMs;
    if (!Number.isFinite(length) || length <= 0) throw new Error('背景音乐时长无效');
    const clips: HtmlVideoAudioClip[] = [];
    let cursor = 0;
    while (cursor < duration - .001) {
      const sourceStart = (start + cursor) % length;
      const size = Math.min(duration - cursor, length - sourceStart);
      clips.push({ id: `bgm-${start}-${cursor}`, path: input.bgm.path, trackType: 'music', startMs: cursor, sourceStartMs: sourceStart, sourceDurationMs: size, durationMs: size, gainDb: 20 * Math.log10(bgmGain),
        fadeEnvelope: { offsetMs: start + cursor, durationMs: totalMs, fadeInMs: template.audio.bgmFadeInMs, fadeOutMs: template.audio.bgmFadeOutMs } });
      cursor += size;
    }
    return clips;
  }
  if (input.coverPage) {
    if (coverMs <= 0) throw new Error('封面页时长无效');
    const text = resolveOrdinaryTaskCoverPageText(input.coverPage.text, input.coverPage.useGeneratedTitleFallback === false ? undefined : input.cover.title);
    scenes.push({ sceneId: -1, title: text, caption: '', description: '', imagePath: input.coverPage.imagePath, audioPath: '', audioClips: bgmClips(0, coverMs), durationMs: coverMs, duration: coverMs / 1000,
      html: shortVideoSceneHtml(template, input.coverPage.imagePath, undefined, text, '', [], coverMs, true) });
  }
  let cursor = 0;
  for (const [index, scene] of input.scenes.entries()) {
    if (!Number.isFinite(scene.durationMs) || scene.durationMs <= 0) throw new Error(`镜头 ${scene.id} 时长无效`);
    const video = input.generatedVideos?.find(a => a.sceneId === scene.id);
    const imagePath = input.generatedImages.find(a => a.sceneId === scene.id)?.path ?? '';
    if (!imagePath && !video) throw new Error(`镜头 ${scene.id} 缺少画面素材`);
    const voices = input.narrationAudio.filter(a => a.sceneId === scene.id).sort((a, b) => (a.turnIndex ?? Number.MAX_SAFE_INTEGER) - (b.turnIndex ?? Number.MAX_SAFE_INTEGER));
    if (!voices.length) throw new Error(`镜头 ${scene.id} 缺少配音`);
    const audioClips = bgmClips(coverMs + cursor, scene.durationMs);
    let voiceCursor = 0;
    for (const [voiceIndex, voice] of voices.entries()) {
      if (!voice.durationMs || voice.durationMs <= 0) throw new Error(`配音未测量真实时长：${voice.path}`);
      if (template.audio.narrationVolume > 0) audioClips.push({ id: `voice-${scene.id}-${voiceIndex}`, path: voice.path, trackType: 'narration', startMs: voiceCursor, durationMs: voice.durationMs, sourceDurationMs: voice.durationMs, gainDb: 20 * Math.log10(template.audio.narrationVolume / 10), fadeInMs: template.audio.narrationFadeInMs, fadeOutMs: template.audio.narrationFadeOutMs });
      voiceCursor += voice.durationMs;
    }
    if (voiceCursor > scene.durationMs + 1) throw new Error(`镜头 ${scene.id} 比实际配音短，请先同步时间轴`);
    const cues = subtitles.cues.filter(c => c.sceneId === scene.id).map(c => ({ text: c.text, start: c.startMs - cursor, end: c.endMs - cursor }));
    const title = input.cover.title.trim() || input.title || template.title.text;
    const subtitle = input.cover.subtitle.filter(Boolean).join('\n') || input.cover.summary || template.subtitle.text;
    scenes.push({ sceneId: scene.id, title, caption: scene.cap, description: scene.descPrompt, imagePath, audioPath: voices[0].path, audioClips, durationMs: scene.durationMs, duration: scene.durationMs / 1000,
      ...(index > 0 && /叠化|dissolve|fade/i.test(template.audio.transitionType) ? { transitionIn: { type: 'dissolve' as const, durationMs: Math.min(500, template.audio.transitionDurationMs, Math.floor(scene.durationMs / 2)) } } : {}),
      html: shortVideoSceneHtml(template, imagePath, video, title, subtitle, cues, scene.durationMs) });
    cursor += scene.durationMs;
  }
  return { workDir: join(input.workDir, 'mp4-render'), outputPath: join(input.workDir, 'output', 'short-video.mp4'), title: input.title, fps: 24, canvas_w: width, canvas_h: height, totalDurationS: totalMs / 1000, scenes };
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
function colorWithAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return color;
  return `rgba(${parseInt(full.slice(0, 2), 16)},${parseInt(full.slice(2, 4), 16)},${parseInt(full.slice(4, 6), 16)},${Math.max(0, Math.min(1, alpha))})`;
}
function textCss(style: DraftTemplate['title'] | DraftTemplate['caption'], width: number): string {
  return `position:absolute;left:${(style.x + 1) * 50}%;top:${(style.y + 1) * 50}%;transform:translate(-50%,-50%);width:${style.width * 100}%;color:${style.color};opacity:${style.alpha};font:${style.bold ? 700 : 400} ${style.fontSize / 180 * width}px ${draftFontCssFamily(style.fontFamily)};line-height:${Math.max(.5, 1 + style.lineSpacing / 10)};text-align:${['left', 'center', 'right'][style.align] ?? 'center'};letter-spacing:${style.letterSpacing}px;white-space:pre-wrap;overflow-wrap:anywhere;text-decoration:${style.underline ? 'underline' : 'none'};-webkit-text-stroke:${style.border.alpha > 0 ? Math.max(1, Math.min(4, style.border.width / 5000 * width)) : 0}px ${colorWithAlpha(style.border.color, style.border.alpha)};paint-order:stroke fill;`;
}
function shortVideoSceneHtml(template: DraftTemplate, image: string, video: TaskArtifactVideoPreview | undefined, title: string, subtitle: string, cues: {text: string; start: number; end: number}[], duration: number, cover = false): string {
  const { width, height } = template.canvas;
  const area = video ? { ...template.image, focusX: .5, focusY: .5, mediaScale: 1, motion: '', animation: '' } : template.image;
  const media = video ? `<video id="media" muted preload="auto" src="${escapeHtml(pathToFileURL(video.path).href)}"></video>` : `<img id="media" src="${escapeHtml(pathToFileURL(image).href)}">`;
  const layer = (id: string, style: DraftTemplate['title'] | DraftTemplate['caption'], text: string) => style.visible && text ? `<div id="${id}" style="${escapeHtml(textCss(style, width) + (id === 'caption' ? `background-color:${colorWithAlpha(template.caption.background.color, template.caption.background.alpha)};border-radius:${template.caption.background.roundRadius * 24}px;padding:${width * .0125}px ${width * .03125}px;` : ''))}">${escapeHtml(text)}</div>` : '';
  const background = template.canvas.backgroundImage ? `<img class="background" src="${escapeHtml(pathToFileURL(template.canvas.backgroundImage).href)}">` : '';
  const safeCoverStyle = { ...template.title, visible: true, x: 0, y: .6, width: .88 };
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; media-src file:; font-src file: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
*{box-sizing:border-box}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${template.canvas.backgroundColor}}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}#frame{position:absolute;overflow:hidden;left:${cover ? 0 : area.left * 100}%;top:${cover ? 0 : area.top * 100}%;width:${cover ? 100 : area.width * 100}%;height:${cover ? 100 : area.height * 100}%;display:${cover || area.visible ? 'block' : 'none'};${!cover && template.frame.enabled ? `border:${template.frame.imageBorderWidth}px solid ${template.frame.imageBorderColor};${template.frame.imageBorderSides === 'horizontal' ? 'border-left:0;border-right:0;' : template.frame.imageBorderSides === 'vertical' ? 'border-top:0;border-bottom:0;' : ''}` : ''}}#media{width:100%;height:100%;object-fit:${cover ? 'contain' : video?.fit ?? area.fit};object-position:${area.focusX * 100}% ${area.focusY * 100}%;transform-origin:${area.focusX * 100}% ${area.focusY * 100}%}#caption{display:none}
</style></head><body>${background}${!cover && template.frame.enabled ? `<div style="position:absolute;inset:0 0 auto;height:${area.top * 100}%;background:linear-gradient(${template.frame.headerColor},${template.frame.headerColorEnd})"></div><div style="position:absolute;inset:${(area.top + area.height) * 100}% 0 0;background:linear-gradient(${template.frame.footerColor},${template.frame.footerColorEnd})"></div>` : ''}<div id="frame">${media}</div>${cover ? layer('title', safeCoverStyle, title) : layer('title', template.title, title) + layer('subtitle', template.subtitle, subtitle) + layer('disclaimer', template.disclaimer, template.disclaimer.text) + layer('caption', template.caption, ' ')}<script>
const cues=${json(cues)}, duration=${duration}, config=${json(area)}, cover=${cover}, trim=${video?.trimStartMs ?? 0};
const media=document.getElementById('media'), caption=document.getElementById('caption');
window.__tl={seek(seconds){const ms=Math.min(duration,Math.max(0,seconds*1000));const p=ms/duration;const motion=cover?'':config.motion || (config.animation==='缩放'?'zoom_in':'');let scale=cover?1:config.mediaScale;let x=0,y=0;const strength=.08*config.motionStrength;if(motion==='zoom_in')scale*=1+strength*p;if(motion==='zoom_out')scale*=1+strength*(1-p);if(motion.startsWith('pan_')||motion.startsWith('zoom_pan_')){scale*=1+strength;x=motion==='pan_left'?-strength*p*50:motion==='pan_right'?strength*p*50:0;y=motion==='zoom_pan_up'?-strength*p*50:motion==='zoom_pan_down'?strength*p*50:0}media.style.transform='translate('+x+'%,'+y+'%) scale('+scale+')';if(media.tagName==='VIDEO'){const available=Math.max(0,media.duration*1000-trim),speed=Math.min(1,available/duration);const at=Math.min(Math.max(0,media.duration-.04),(trim+ms*speed)/1000);if(Number.isFinite(at)&&Math.abs(media.currentTime-at)>.001)media.currentTime=at}if(caption){const cue=cues.find(c=>c.start<=ms&&ms<c.end);caption.textContent=cue?cue.text:'';caption.style.display=cue?'block':'none'}return this;},play(){return this;}};
Promise.all([document.fonts.ready,...Array.from(document.images).map(img=>img.decode()),...(media.tagName==='VIDEO'?[new Promise((resolve,reject)=>{media.onloadeddata=resolve;media.onerror=()=>reject(new Error('视频读取失败'));if(media.readyState>=2)resolve()})]:[])]).then(()=>{window.__tl.seek(0);window.__ready=true}).catch(e=>window.__mediaError=String(e));
</script></body></html>`;
}