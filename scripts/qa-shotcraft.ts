import {build} from 'esbuild';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildVoxAnimationHtml, createVoxAnimation, voxItemSchema, voxTemplate, validateVoxAnimation} from '../src/shared/vox-animation';
import {directorCanvasForRatio} from '../src/shared/director-render';

// Generate from the current production entry, never a possibly stale dist bundle.
const out = '.artifacts/shotcraft-qa';
await mkdir(`${out}/frames`, {recursive:true});
await build({entryPoints:['src/features/vox-animation/runtime.tsx'], outfile:`${out}/runtime.js`, bundle:true, platform:'browser', format:'iife', target:'chrome120', define:{'process.env.NODE_ENV':'"production"'}, minify:true, logLevel:'warning'});
const runtime = await readFile(`${out}/runtime.js`, 'utf8');
const ids = ['shotcraft-paper-tape','shotcraft-paper-popup','shotcraft-paper-title','shotcraft-timeline-travel','shotcraft-source-merge','shotcraft-ring-reveal'];
const assets = await Promise.all((['cover','page','replacement'] as const).map(async id => ({id,label:{cover:'合成封面',page:'合成资料页',replacement:'替换图片'}[id],kind:'image' as const,path:`${id}.png`,url:`data:image/png;base64,${(await readFile(`${out}/${id}.png`)).toString('base64')}`})));
const cases = [];
for (const id of ids) {
  const template = voxTemplate(id);
  if (!template) throw new Error(`Template is not registered: ${id}`);
  const animation = createVoxAnimation('从观察走向理解', '用证据连接信息，让复杂概念变得清晰。');
  animation.template.id = id;
  const p = animation.template.props;
  p.author = '本地验收'; p.source = '合成内容 · 不代表真实研究'; p.highlight = '观察,理解';
  p.items = [['观察','记录变化与事实','2000'],['理解','整理不同来源的证据','2010'],['行动','把理解转化为行动','2020']].map(([label,detail,date]) => voxItemSchema.parse({label,detail,date}));
  p.items = p.items.slice(0, template.maxItems ?? 24);
  p.assetIds = ['cover','page'].slice(0,template.maxImages ?? 24);
  const issues = validateVoxAnimation(animation,assets);
  if (issues.length) throw new Error(`${id}: ${issues.join('; ')}`);
  for (const ratio of ['16:9','9:16','1:1','4:3']) for (const fps of [24,30]) {
    const name = `${id}-${ratio.replace(':','x')}-${fps}`;
    const payload = {animation,assets,...directorCanvasForRatio(ratio),fps,durationMs:4000,cues:[]};
    await writeFile(`${out}/frames/${name}.html`,buildVoxAnimationHtml(runtime,payload),'utf8');
    cases.push({name,id,ratio,fps,width:payload.width,height:payload.height,animation});
  }
}
await writeFile(`${out}/fixture.json`,JSON.stringify({assets,ids,cases,runtimeSha256:createHash('sha256').update(runtime).digest('hex')},null,2),'utf8');
await build({entryPoints:['tests/shotcraft.harness.tsx'],outfile:`${out}/harness.js`,bundle:true,format:'esm',platform:'browser',target:'chrome120',define:{'process.env.NODE_ENV':'"production"'},loader:{'.woff2':'file','.png':'file'},logLevel:'warning'});
await writeFile(`${out}/index.html`,'<!doctype html><html data-theme="dark" data-theme-ready="true"><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="harness.css"><div id="root"></div><script type="module" src="harness.js"></script></html>','utf8');
console.log(`Prepared ${cases.length} current-runtime ShotCraft cases.`);
