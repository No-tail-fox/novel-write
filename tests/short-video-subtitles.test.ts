import { describe, it, expect } from 'vitest';
import { alignShortVideoSubtitles } from '../src/shared/short-video-subtitles';
import { buildSubtitleTrackFromSceneLines } from '../src/shared/story';
import type { SceneAsset } from '../src/shared/draft';
import type { HtmlVideoTimedCaptionCue } from '../src/shared/types';
const scene = { id: 1, cap: '第一句。第二句。', descPrompt: '', durationMs: 3000 };
const timed = (text: string, startSec: number, endSec: number): HtmlVideoTimedCaptionCue => ({ text, startSec, endSec, source: 'tts', confidence: 1 });
function run(voices: SceneAsset[], lines = ['第一句。', '第二句。']) {
  return alignShortVideoSubtitles([scene], voices, buildSubtitleTrackFromSceneLines([scene], [{ sceneId: 1, lines }]));
}
const voice = (): SceneAsset => ({ sceneId: 1, path: 'voice.wav', durationMs: 2500, captionCues: [timed('第一句', .2, .9), timed('第二句', 1.3, 2.2)] });
describe('short-video shared subtitle clock', () => {
  it('preserves measured pauses and trailing silence without replacing authored punctuation', () => {
    const result = run([voice()]);
    expect(result.cues.map(c => [c.startMs, c.endMs, c.text])).toEqual([[200,900,'第一句。'],[1300,2200,'第二句。']]);
    expect(result.srt).toContain('00:00:01,300 --> 00:00:02,200');
  });
  it('uses measured word boundaries when a long TTS cue is split for display', () => {
    const audio = voice();
    audio.captionCues = [{...timed('第一句第二句', .1, 2.3), words: [{text:'第一句',startSec:.2,endSec:.9},{text:'第二句',startSec:1.3,endSec:2.2}]}];
    expect(run([audio]).cues.map(c => [c.startMs,c.endMs])).toEqual([[200,900],[1300,2200]]);
  });
  it('sorts multiple audio turns and offsets by measured full file duration', () => {
    const one = {...voice(), turnIndex:0, durationMs:1000,captionCues:[timed('第一句',.1,.8)]};
    const two = {...voice(), turnIndex:1, durationMs:1500,captionCues:[timed('第二句',.2,1.3)]};
    expect(run([two,one]).cues.map(c=>[c.startMs,c.endMs])).toEqual([[100,800],[1200,2300]]);
  });
  it.each(['estimated','overlap','outside','missing','nan','text-mismatch'] as const)('falls back without inventing trustworthy timings for %s', mode => {
    const audio = voice();
    if(mode==='estimated') audio.captionCues![0].source='estimated';
    if(mode==='overlap') audio.captionCues![1].startSec=.5;
    if(mode==='outside') audio.captionCues![1].endSec=5;
    if(mode==='missing') delete audio.captionCues;
    if(mode==='nan') audio.captionCues![0].confidence=NaN;
    if(mode==='text-mismatch') audio.captionCues![0].text='旧的配音';
    const result=run([audio]);
    expect(result.cues[0].startMs).toBe(0);
    expect(result.cues.at(-1)?.endMs).toBe(3000);
    expect(result.cues.map(c=>c.text)).toEqual(['第一句。','第二句。']);
  });
  it('does not rewrite an independently edited caption to match speech', () => {
    expect(run([voice()],['用户重新编辑的字幕']).cues[0].text).toBe('用户重新编辑的字幕');
  });
  it('uses scene duration rather than speech end to offset the next scene', () => {
    const scenes=[scene,{...scene,id:2}];
    const lines=scenes.map(s=>({sceneId:s.id,lines:['第一句。','第二句。']}));
    const result=alignShortVideoSubtitles(scenes,[voice(),{...voice(),sceneId:2}],buildSubtitleTrackFromSceneLines(scenes,lines));
    expect(result.cues[2]).toMatchObject({index:3,sceneId:2,startMs:3200,endMs:3900});
  });
});
