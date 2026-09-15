import ts from 'typescript';
import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildVoxAnimationHtml, voxAnimationSchema, voxSavedTemplateSchema, type VoxCompileResult, type VoxAnimationPayload, type VoxSavedTemplate } from '../src/shared/vox-animation';

export function compileVoxCode(source:string):VoxCompileResult {
  source=source.trim().replace(/^```(?:tsx|typescript|jsx|javascript)?\s*/i,'').replace(/\s*```$/,'');
  if(!source||source.length>100000)throw new Error('动画代码应为 1–100000 字符');
  const file=ts.createSourceFile('animation.tsx',source,ts.ScriptTarget.ES2020,true,ts.ScriptKind.TSX);
  const banned=new Set(['eval','Function','require','fetch','XMLHttpRequest','WebSocket','Worker','SharedWorker','window','globalThis','document','parent','top','opener','process','localStorage','sessionStorage','navigator','setTimeout','setInterval','requestAnimationFrame','Date']);
  let defaultExport=false;
  const visit=(node:ts.Node)=>{
    if(ts.isImportDeclaration(node)){
      if(!ts.isStringLiteral(node.moduleSpecifier)||!['react','remotion'].includes(node.moduleSpecifier.text))throw new Error('动画仅支持 react 和 remotion 依赖');
    }
    if(ts.isExportAssignment(node)&&!node.isExportEquals)defaultExport=true;
    if(ts.canHaveModifiers(node)&&ts.getModifiers(node)?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword))defaultExport=true;
    if(ts.isExportDeclaration(node)&&node.moduleSpecifier)throw new Error('不支持从外部模块重新导出');
    if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)throw new Error('不支持动态导入');
    if(ts.isIdentifier(node)&&banned.has(node.text))throw new Error(`动画代码不能访问 ${node.text}`);
    if(ts.isPropertyAccessExpression(node)&&node.expression.getText(file)==='Math'&&node.name.text==='random')throw new Error('请使用由帧驱动的确定性动画，不能使用 Math.random');
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){const tag=node.tagName.getText(file).toLowerCase();if(['script','iframe','object','embed','link','style','audio','video'].includes(tag))throw new Error(`不支持 ${tag} 标签，请使用传入素材和画面组件`);}
    ts.forEachChild(node,visit);
  };visit(file);
  if(!defaultExport)throw new Error('请用 export default 导出一个 React 动画组件');
  const result=ts.transpileModule(source,{fileName:'animation.tsx',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,esModuleInterop:true}});
  const errors=result.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)??[];
  if(errors.length)throw new Error(errors.map(d=>{const pos=d.file&&d.start!==undefined?d.file.getLineAndCharacterOfPosition(d.start):undefined;return `${pos?`第 ${pos.line+1} 行：`:''}${ts.flattenDiagnosticMessageText(d.messageText,' ')}`;}).join('\n'));
  return {source,compiled:result.outputText};
}
export async function readVoxAsset(path:string):Promise<string>{
  const extension=extname(path).toLowerCase();const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.ogg':'audio/ogg','.flac':'audio/flac'};
  if(!mime[extension])throw new Error('动画素材支持 PNG/JPG/WebP/GIF 和 MP3/WAV/M4A/OGG/FLAC');
  const info=await stat(path);if(!info.isFile()||info.size>48*1024*1024)throw new Error('单个动画素材不能超过 48 MB');
  return `data:${mime[extension]};base64,${(await readFile(path)).toString('base64')}`;
}
export async function prepareVoxHtml(runtimePath:string,payload:VoxAnimationPayload):Promise<string>{
  const animation=voxAnimationSchema.parse(payload.animation);
  if(animation.mode==='code')animation.code={...animation.code,...compileVoxCode(animation.code.source)};
  return buildVoxAnimationHtml(await readFile(runtimePath,'utf8'),{...payload,animation});
}
export class VoxTemplateStore {
  private pending=Promise.resolve();
  constructor(private directory:string){}
  async list():Promise<VoxSavedTemplate[]>{try{return z.array(voxSavedTemplateSchema).max(200).parse(JSON.parse(await readFile(join(this.directory,'templates.json'),'utf8')));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}}
  async save(input:VoxSavedTemplate):Promise<VoxSavedTemplate[]>{return this.change(rows=>{const row=voxSavedTemplateSchema.parse(input);if(row.animation.mode==='code')row.animation.code={...row.animation.code,...compileVoxCode(row.animation.code.source)};const next=[row,...rows.filter(r=>r.id!==row.id)];if(next.length>200)throw new Error('个人模板最多 200 个，请先删除不用的模板');return next;});}
  async remove(id:string){return this.change(rows=>rows.filter(x=>x.id!==id));}
  private async change(fn:(rows:VoxSavedTemplate[])=>VoxSavedTemplate[]){let result:VoxSavedTemplate[]=[];const work=this.pending.then(async()=>{result=fn(await this.list());await mkdir(this.directory,{recursive:true});const tmp=join(this.directory,`templates-${randomUUID()}.tmp`);await writeFile(tmp,JSON.stringify(result),'utf8');await rename(tmp,join(this.directory,'templates.json'));});this.pending=work.then(()=>{},()=>{});await work;return result;}
}
