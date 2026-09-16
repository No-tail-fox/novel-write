import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fetchWithTimeout } from '../src/shared/http';
import { musicEnhancedRequestSchema, type MusicEnhancedJob, type MusicEnhancedRequest } from '../src/shared/music-enhanced';
import { normalizeMusicApiBaseUrl } from '../src/shared/music-provider';
const object = (value:unknown):Record<string,unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const text = (value:unknown) => typeof value === 'string' ? value : '';
export function createMusicEnhancedRuntime(options:{dataDir:string;storageDirectory?:string;baseUrl?:string;resolveApiKey:()=>Promise<string>;onSongsReady:(ids:string[])=>Promise<unknown>;fetchImpl?:typeof fetch}) {
  if (options.storageDirectory !== undefined && !isAbsolute(options.storageDirectory)) throw new Error('MUSIC_STORAGE_PATH_INVALID: 强化上传存储目录必须为绝对路径。');
  const root = options.storageDirectory === undefined ? resolve(options.dataDir,'music-enhanced') : resolve(options.storageDirectory);
  const baseUrl = normalizeMusicApiBaseUrl(options.baseUrl);
  const file=join(root,'jobs.json'); let queue:Promise<unknown>=Promise.resolve();
  async function save(jobs:MusicEnhancedJob[]) { await mkdir(root,{recursive:true}); const tmp=`${file}.${randomUUID()}.tmp`; await writeFile(tmp,JSON.stringify(jobs,null,2),'utf8'); await rename(tmp,file); }
  async function execute(raw:MusicEnhancedRequest) {
    const input=musicEnhancedRequestSchema.parse(raw);
    const jobs:MusicEnhancedJob[]=await readFile(file,'utf8').then((body)=>JSON.parse(body) as MusicEnhancedJob[]).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return []; throw error;});
    if(input.action==='list'){let changed=false;for(const job of jobs)if(job.status==='submitting'){job.status='needs-recovery';job.error='应用在提交期间关闭，请在网站核对本次上传，勿重复提交。';changed=true;}if(changed)await save(jobs);return jobs;}
    const key=(await options.resolveApiKey()).trim();if(!key)throw new Error('尚未配置音乐服务。');
    const redact=(value:string)=>value.split(key).join('[已隐藏]').slice(0,2000);
    async function request(path:string,body?:BodyInit,post=false) {
      try { const response=await fetchWithTimeout(`${baseUrl}${path}`,{method:post?'POST':'GET',headers:{Authorization:`Bearer ${key}`},body,timeoutMs:180000,maxBytes:4*1024*1024,maxRedirects:0,fetchImpl:options.fetchImpl});
        const value=object(await response.json());if(!response.ok||value.success===false||value.error||(value.code!==undefined&&![0,200,'0','200','success'].includes(value.code as number|string)))throw new Error(text(value.message??value.error)||`服务请求失败（${response.status}）`); return object(value.data??value);
      }catch(error){throw new Error(redact(error instanceof Error?error.message:String(error)));}
    }
    let job:MusicEnhancedJob;
    if(input.action==='submit'){
      const path=await realpath(input.audioPath); const bgmRoot=await realpath(join(options.dataDir,'bgm')); const rel=relative(bgmRoot,path);
      if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw new Error('请先选择受管音频文件。');
      if(!['.mp3','.wav','.m4a','.aac','.ogg','.flac'].includes(extname(path).toLowerCase()))throw new Error('请选择音频文件。');
      const info=await stat(path);if(!info.isFile()||info.size<16||info.size>80*1024*1024)throw new Error('强化上传的音频不得超过 80 MB。');
      const bytes=await readFile(path);const head=bytes.subarray(0,12).toString('ascii');
      const valid=head.startsWith('ID3')||bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0||head.startsWith('RIFF')&&head.slice(8,12)==='WAVE'||head.slice(4,8)==='ftyp'||head.startsWith('OggS')||head.startsWith('fLaC');
      if(!valid||bytes.length!==info.size)throw new Error('音频内容无法识别或读取时发生变化，请重新选择文件。');
      const form=new FormData();form.append('file',new Blob([new Uint8Array(bytes)]),basename(path));form.append('title',input.title||basename(path));
      job={id:randomUUID(),taskId:0,title:input.title||basename(path),status:'submitting',progress:0,stage:'正在提交',songId:'',error:'',createdAt:new Date().toISOString()}; jobs.unshift(job);await save(jobs);
      try {const result=await request('/api/music/enhanced-upload',form,true);const task=object(result.task??result);const taskId=Number(task.task_id??task.id);job.taskId=Number.isSafeInteger(taskId)&&taskId>0?taskId:0;job.status=job.taskId?text(task.status)||'queued':'needs-recovery';job.stage=job.taskId?'等待处理':'提交结果待核对';if(!job.taskId)job.error='未取得任务编号，请在网站核对，勿重复提交。';}
      catch(error){job.status='needs-recovery';job.error=error instanceof Error?error.message:String(error);}
    } else {
      const found=jobs.find((item)=>item.id===input.id);if(!found||!found.taskId)throw new Error('无法查询此任务，请先核对网站记录。');job=found;
      if(input.action==='cancel'&&job.status!=='queued')throw new Error('只有仍在排队的任务可以申请取消。');
      const result=await request(`/api/music/enhanced-upload/${job.taskId}${input.action==='cancel'?'/cancel':''}`,undefined,input.action==='cancel');
      const task=object(result.task??result);const progress=object(task.progress);job.status=text(task.status)||(input.action==='cancel'?'cancelled':job.status);job.progress=Math.max(0,Math.min(100,Number(progress.percent)||0));job.stage=text(progress.label??progress.stage);job.error=redact(text(task.error_message));job.songId=text(task.song_id)||job.songId;
      if(job.status==='completed'){
        let audioReady=false;try{const url=new URL(text(task.audio_url));audioReady=url.protocol==='https:'&&!url.username&&!url.password&&!url.pathname.includes('/api/forbidden');}catch{/* Still preparing media. */}
        if(job.songId&&!job.songId.startsWith('pending:')&&audioReady)await options.onSongsReady([job.songId]).catch(()=>{job.error='歌曲已完成，请再次查询以导入作品库。';});
        else{job.status='processing';job.progress=Math.min(job.progress,98);job.stage='正在准备播放资源';}
      }
    }
    await save(jobs);return jobs;
  }
  return {execute(input:MusicEnhancedRequest){const next=queue.catch(()=>undefined).then(()=>execute(input));queue=next;return next;}};
}
