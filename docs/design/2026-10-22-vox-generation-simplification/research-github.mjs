import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.join(os.homedir(), '.agent-reach', 'vox-design-20261022');
await fs.mkdir(root, {recursive:true});
const repos = ['anthropics/skills', 'pbakaus/impeccable', 'nextlevelbuilder/ui-ux-pro-max-skill', 'vercel-labs/agent-skills'];
async function json(url) {
  const r=await fetch(url,{headers:{'User-Agent':'StoryDream-design-research','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(25000)});
  if(!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
const results=await Promise.allSettled(repos.map(async repo=>{
  const meta=await json(`https://api.github.com/repos/${repo}`);
  const commit=await json(`https://api.github.com/repos/${repo}/commits/${meta.default_branch}`);
  const tree=await json(`https://api.github.com/repos/${repo}/git/trees/${commit.sha}?recursive=1`);
  const candidates=tree.tree.filter(n=>n.type==='blob' && (/SKILL\.md$/.test(n.path)||/LICENSE[^/]*$/.test(n.path)));
  let selected=candidates.filter(n=>/frontend-design\/SKILL|simplify\/SKILL|distill\/SKILL|audit\/SKILL|web-design-guidelines\/SKILL|ui-ux-pro-max\/SKILL|^LICENSE/.test(n.path));
  if(repo==='pbakaus/impeccable') selected=selected.filter(n=>!n.path.startsWith('dist/')).slice(0,6);
  const files=[];
  for(const n of selected.slice(0,7)) {
    const url=`https://raw.githubusercontent.com/${repo}/${commit.sha}/${n.path}`;
    const response=await fetch(url,{signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw new Error(`${response.status} ${url}`);
    const text=await response.text();
    const filename=repo.replace('/','--')+'--'+n.path.replaceAll('/','--');
    await fs.writeFile(path.join(root,filename),text,'utf8');
    files.push({path:n.path,url,local:path.join(root,filename),text});
  }
  const record={repo,sha:commit.sha,stars:meta.stargazers_count,license:meta.license?.spdx_id,updatedAt:meta.updated_at,skillPaths:candidates.map(n=>n.path),files};
  await fs.writeFile(path.join(root,repo.replace('/','--')+'.json'),JSON.stringify(record,null,2));
  return record;
}));
for(let i=0;i<results.length;i++) {
  const r=results[i];
  console.log(JSON.stringify(r.status==='fulfilled'?{repo:r.value.repo,sha:r.value.sha,stars:r.value.stars,license:r.value.license,files:r.value.files.map(f=>({path:f.path,local:f.local})),skillPaths:r.value.skillPaths.slice(0,35)}:{repo:repos[i],error:String(r.reason)}));
}
