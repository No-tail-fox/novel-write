import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMusicVoiceRuntime, normalizeMusicVoice } from '../electron/music-voice-runtime';
import { createMusicEnhancedRuntime } from '../electron/music-enhanced-runtime';
import { musicVoiceRequestSchema } from '../src/shared/music-voice';
import { musicEnhancedRequestSchema } from '../src/shared/music-enhanced';
import { storyDreamApi } from '../electron/preload';
import { ipcRenderer } from 'electron';
vi.mock('electron',()=>({contextBridge:{exposeInMainWorld:vi.fn()},ipcRenderer:{invoke:vi.fn(),on:vi.fn(),off:vi.fn()}}));
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map((dir)=>rm(dir,{recursive:true,force:true})));});
async function directory(){const dir=await mkdtemp(join(tmpdir(),'music-voice-test-'));directories.push(dir);await mkdir(join(dir,'bgm'));await writeFile(join(dir,'bgm','sample.mp3'),Buffer.concat([Buffer.from('ID3'),Buffer.alloc(100)]));return dir;}
const json=(data:unknown)=>new Response(JSON.stringify({success:true,data}),{status:200,headers:{'content-type':'application/json'}});
const generation={action:'generate' as const,taskId:12,model:'suno-v6' as const,prompt:'山间的故事',custom:false,style:'folk',title:'山间',maxMode:false,variety:0,styleWeight:0.5,weirdness:0.5};

describe('musicLabVoice and musicLabEnhanced recovery',()=>{
  it('isolates voice records by profile and keeps subsequent queries at the original configured service', async () => {
    const dataDir = await directory();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/check')
      ? json({ voice: { voice_task_id: 12, voice_name: '本人', is_available: true, voice_id: 'real-voice' } })
      : String(url).includes('/results?') ? json({ status: 'completed', items: [{ song_id: 'voice-song' }] })
        : json({ client_request_id: 'voice-request' }));
    const ready = vi.fn().mockResolvedValue(undefined);
    const options = { dataDir, storageDirectory: join(dataDir, 'music-voices', 'profiles', 'a'), baseUrl: 'https://voice-a.example/', resolveApiKey: async () => 'voice-a-test-key', onSongsReady: ready, fetchImpl };
    const runtime = createMusicVoiceRuntime(options);
    const result = await runtime.execute(generation);
    options.baseUrl = 'https://voice-b.example';
    expect(await createMusicVoiceRuntime({ ...options, storageDirectory: join(dataDir, 'music-voices', 'profiles', 'b') }).execute({ action: 'list' })).toEqual({ voices: [], jobs: [] });
    expect(await createMusicVoiceRuntime({ ...options, storageDirectory: undefined }).execute({ action: 'list' })).toEqual({ voices: [], jobs: [] });
    await runtime.execute({ action: 'poll', jobId: result.jobs[0].id });
    expect(fetchImpl.mock.calls.every(([url]) => String(url).startsWith('https://voice-a.example/'))).toBe(true);
    expect(ready).toHaveBeenCalledWith(['voice-song'], 'suno-v6');
    expect((await createMusicVoiceRuntime({ ...options, baseUrl: 'https://voice-a.example' }).execute({ action: 'list' })).jobs[0].songIds).toEqual(['voice-song']);
    expect(await readFile(join(options.storageDirectory, 'voices.json'), 'utf8')).not.toContain('voice-a-test-key');
    expect(() => createMusicVoiceRuntime({ ...options, storageDirectory: 'relative/path' })).toThrow('MUSIC_STORAGE_PATH_INVALID');
  });

  it('stores enhanced jobs separately while sourcing audio from shared managed storage', async () => {
    const dataDir = await directory();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url) => String(url).endsWith('/enhanced-upload')
      ? json({ task_id: 8, status: 'queued' })
      : json({ task: { task_id: 8, status: 'completed', song_id: 'enhanced-song', audio_url: 'https://media.example/ready.mp3', progress: { percent: 100 } } }));
    const ready = vi.fn().mockResolvedValue(undefined);
    const options = { dataDir, storageDirectory: join(dataDir, 'music-enhanced', 'profiles', 'a'), baseUrl: 'https://enhanced-a.example/', resolveApiKey: async () => 'enhanced-a-test-key', onSongsReady: ready, fetchImpl };
    const runtime = createMusicEnhancedRuntime(options);
    const result = await runtime.execute({ action: 'submit', audioPath: join(dataDir, 'bgm', 'sample.mp3'), title: '共享录音' });
    options.baseUrl = 'https://enhanced-b.example';
    expect(await createMusicEnhancedRuntime({ ...options, storageDirectory: join(dataDir, 'music-enhanced', 'profiles', 'b') }).execute({ action: 'list' })).toEqual([]);
    expect(await createMusicEnhancedRuntime({ ...options, storageDirectory: undefined }).execute({ action: 'list' })).toEqual([]);
    await runtime.execute({ action: 'poll', id: result[0].id });
    expect(fetchImpl.mock.calls.every(([url]) => String(url).startsWith('https://enhanced-a.example/'))).toBe(true);
    expect(ready).toHaveBeenCalledWith(['enhanced-song']);
    expect((await createMusicEnhancedRuntime({ ...options, baseUrl: 'https://enhanced-a.example' }).execute({ action: 'list' }))[0].songId).toBe('enhanced-song');
    expect(await readFile(join(options.storageDirectory, 'jobs.json'), 'utf8')).not.toContain('enhanced-a-test-key');
    expect(() => createMusicEnhancedRuntime({ ...options, storageDirectory: 'relative/path' })).toThrow('MUSIC_STORAGE_PATH_INVALID');
  });

  it('normalizes nested voice records and rejects invalid ranges and injected credentials',()=>{
    expect(normalizeMusicVoice({data:{voice:{voice_task_id:12,voice_name:'本人',validate_info:'请朗读',is_available:true}}})).toMatchObject({id:12,name:'本人',validationText:'请朗读',available:true});
    expect(musicVoiceRequestSchema.safeParse({...generation,apiKey:'not-allowed'}).success).toBe(false);
    expect(musicVoiceRequestSchema.safeParse({action:'validate',audioPath:'C:/a.mp3',name:'本人',description:'',style:'',language:'zh',start:20,end:10}).success).toBe(false);
    expect(musicEnhancedRequestSchema.safeParse({action:'submit',audioPath:'C:/a.mp3',title:'x',endpoint:'https://other.test'}).success).toBe(false);
  });
  it('persists voice task and final song IDs across restarts without charging again',async()=>{
    const dataDir=await directory();const ready=vi.fn().mockResolvedValue(undefined);const calls:string[]=[];
    const fetchImpl=vi.fn(async(url: string | URL | Request,init?:RequestInit)=>{const path=String(url);calls.push(path);
      if(path.endsWith('/validate'))return json({voice:{voice_task_id:12,voice_name:'本人',validate_info:'请朗读这段文字',is_available:false}});
      if(path.endsWith('/check'))return json({voice:{voice_task_id:12,voice_name:'本人',is_available:true,voice_id:'voice-real'}});
      if(path.includes('/results?'))return json({status:'completed',items:[{song_id:'song-a'},{song_id:'song-b'}]});
      expect(new Headers(init?.headers).get('Idempotency-Key')).toBeTruthy();return json({client_request_id:'client-one',items:[{placeholder_id:'pending:one'}]});
    }) as typeof fetch;
    const options={dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:ready,fetchImpl};let runtime=createMusicVoiceRuntime(options);
    await runtime.execute({action:'validate',audioPath:join(dataDir,'bgm','sample.mp3'),name:'本人',description:'温暖',style:'folk',language:'zh',start:0,end:18});
    const submitted=await runtime.execute({...generation,model:'suno-v6-wild'});expect(submitted.jobs[0]).toMatchObject({requestId:'client-one',status:'processing',model:'suno-v6-wild'});
    runtime=createMusicVoiceRuntime(options);const result=await runtime.execute({action:'poll',jobId:submitted.jobs[0].id});
    expect(result.jobs[0].songIds).toEqual(['song-a','song-b']);expect(ready).toHaveBeenCalledWith(['song-a','song-b'],'suno-v6-wild');
    expect(calls.filter((path)=>path.endsWith('/generate-with-voice'))).toHaveLength(1);
    expect(await readFile(join(dataDir,'music-voices','voices.json'),'utf8')).not.toContain('test-only-key');
  });
  it('marks ambiguous paid submission for recovery and never retries on list',async()=>{
    const dataDir=await directory();const fetchImpl=vi.fn(async(url:string|URL|Request)=>String(url).endsWith('/check')?json({voice:{voice_task_id:12,is_available:true}}):Promise.reject(new Error('network failed test-only-key'))) as typeof fetch;
    const runtime=createMusicVoiceRuntime({dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:async()=>undefined,fetchImpl});
    const next=await runtime.execute(generation);expect(next.jobs[0].status).toBe('needs-recovery');expect(next.jobs[0].error).not.toContain('test-only-key');
    await runtime.execute({action:'list'});expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('keeps enhanced upload at media-preparing until real audio exists and restricts cancel',async()=>{
    const dataDir=await directory();const ready=vi.fn().mockResolvedValue(undefined);let polls=0;
    const fetchImpl=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{
      expect(new Headers(init?.headers).get('content-type')).toBeNull();
      if(String(url).endsWith('/enhanced-upload'))return json({task_id:8,status:'queued'});
      polls++;return json({task:{task_id:8,status:polls===1?'processing':'completed',song_id:polls===1?'pending:a':'real-song',audio_url:polls===1?'':'https://media.example/song.mp3',progress:{percent:polls===1?98:100,label:'正在准备播放资源'}}});
    }) as typeof fetch;
    const runtime=createMusicEnhancedRuntime({dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:ready,fetchImpl});
    const submitted=await runtime.execute({action:'submit',audioPath:join(dataDir,'bgm','sample.mp3'),title:'本地音乐'});
    await runtime.execute({action:'poll',id:submitted[0].id});expect(ready).not.toHaveBeenCalled();
    await expect(runtime.execute({action:'cancel',id:submitted[0].id})).rejects.toThrow('排队');
    await runtime.execute({action:'poll',id:submitted[0].id});expect(ready).toHaveBeenCalledWith(['real-song']);expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('rejects files outside approved audio storage before uploading',async()=>{
    const dataDir=await directory();const path=join(dataDir,'private.mp3');await writeFile(path,Buffer.alloc(100));const fetchImpl=vi.fn() as typeof fetch;
    const runtime=createMusicEnhancedRuntime({dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:async()=>undefined,fetchImpl});
    await expect(runtime.execute({action:'submit',audioPath:path,title:'test'})).rejects.toThrow('受管');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('bridges enhanced actions through trusted IPC',async()=>{
    vi.mocked(ipcRenderer.invoke).mockResolvedValue({ok:true,value:[]});
    await storyDreamApi.musicLabEnhanced({action:'list'});expect(ipcRenderer.invoke).toHaveBeenCalledWith('music-lab:enhanced',{action:'list'});
  });

  it('keeps completed enhanced placeholders pending and rejects business error envelopes',async()=>{
    const dataDir=await directory();const ready=vi.fn().mockResolvedValue(undefined);
    const fetchImpl=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({task_id:8,status:'queued'}))
      .mockResolvedValueOnce(json({task:{task_id:8,status:'completed',song_id:'real-song',audio_url:'https://media.example/api/forbidden',progress:{percent:100}}}))
      .mockResolvedValueOnce(new Response(JSON.stringify({code:500,message:'service failed test-only-key'}),{headers:{'content-type':'application/json'}}));
    const runtime=createMusicEnhancedRuntime({dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:ready,fetchImpl});
    const submitted=await runtime.execute({action:'submit',audioPath:join(dataDir,'bgm','sample.mp3'),title:'test'});
    const polled=await runtime.execute({action:'poll',id:submitted[0].id});
    expect(polled[0]).toMatchObject({status:'processing',progress:98});expect(ready).not.toHaveBeenCalled();
    await expect(runtime.execute({action:'poll',id:submitted[0].id})).rejects.toThrow('已隐藏');
    expect((await runtime.execute({action:'list'}))[0].status).toBe('processing');
  });

  it('rejects renamed documents before either audio upload',async()=>{
    const dataDir=await directory();const audioPath=join(dataDir,'bgm','fake.mp3');await writeFile(audioPath,'<html>This is not an audio file.</html>','utf8');
    const fetchImpl=vi.fn() as typeof fetch;const options={dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:async()=>undefined,fetchImpl};
    await expect(createMusicEnhancedRuntime(options).execute({action:'submit',audioPath,title:'test'})).rejects.toThrow('无法识别');
    await expect(createMusicVoiceRuntime(options).execute({action:'validate',audioPath,name:'本人',description:'',style:'',language:'zh',start:0,end:18})).rejects.toThrow('无法识别');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('recovers interrupted uploads locally without any repeated network submission',async()=>{
    const dataDir=await directory();const job={id:'bbc5cc2a-58b8-4671-9bdb-b1c6498c8dbd',taskId:0,title:'test',status:'submitting',progress:0,stage:'正在提交',songId:'',error:'',createdAt:new Date().toISOString()};
    await mkdir(join(dataDir,'music-enhanced'));await writeFile(join(dataDir,'music-enhanced','jobs.json'),JSON.stringify([job]),'utf8');
    const fetchImpl=vi.fn() as typeof fetch;const runtime=createMusicEnhancedRuntime({dataDir,resolveApiKey:async()=>'test-only-key',onSongsReady:async()=>undefined,fetchImpl});
    expect((await runtime.execute({action:'list'}))[0].status).toBe('needs-recovery');
    await expect(runtime.execute({action:'poll',id:job.id})).rejects.toThrow('核对');expect(fetchImpl).not.toHaveBeenCalled();
  });
});
