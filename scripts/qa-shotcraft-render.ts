import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {runBoundedProcess} from '../src/shared/process-runner';

const root=resolve('.'),out=join(root,'.artifacts/shotcraft-qa'),entry=join(out,'electron-entry');
await mkdir(entry,{recursive:true});
await build({entryPoints:['scripts/qa-shotcraft-render-entry.ts'],outfile:join(entry,'entry.mjs'),bundle:true,platform:'node',format:'esm',target:'node22',external:['electron'],banner:{js:"import {createRequire as __createRequire} from 'node:module';import {fileURLToPath as __filePath} from 'node:url';import {dirname as __pathDirname} from 'node:path';const require=__createRequire(import.meta.url);const __filename=__filePath(import.meta.url);const __dirname=__pathDirname(__filename);"},logLevel:'warning'});
await writeFile(join(entry,'bootstrap.cjs'),`const {app,dialog}=require('electron');app.disableHardwareAcceleration();const fs=require('node:fs');dialog.showErrorBox=(title,message)=>{fs.writeFileSync(${JSON.stringify(join(out,'bootstrap-error.txt'))},title+'\\n'+message);app.exit(1);};import('./entry.mjs').catch(e=>dialog.showErrorBox('QA startup',e.stack||String(e)));`,'utf8');
await writeFile(join(entry,'package.json'),JSON.stringify({name:'shotcraft-local-qa',version:'1.0.0',type:'module',main:'bootstrap.cjs'}),'utf8');
const env:NodeJS.ProcessEnv={...process.env,STORYDREAM_SHOTCRAFT_RENDER_QA:JSON.stringify({root,out})};
delete env.ELECTRON_RUN_AS_NODE;
const result=await runBoundedProcess(createRequire(import.meta.url)('electron'),[entry],{cwd:root,env,timeoutMs:600000,maxStdoutBytes:1000000,maxStderrBytes:2000000});
await writeFile(join(out,'render-process.json'),JSON.stringify(result,null,2),'utf8');
const report=JSON.parse(await readFile(join(out,'render-report.json'),'utf8'));
console.log(JSON.stringify({status:report.status,error:report.error,durationMs:report.result?.durationMs,sceneIds:report.sceneIds,width:report.result?.width,height:report.result?.height,externalCalls:report.externalCalls,stderr:result.stderr.slice(-1500)},null,2));
if(result.code!==0||report.status!=='passed')process.exitCode=1;
