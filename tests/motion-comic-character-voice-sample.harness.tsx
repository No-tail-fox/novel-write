import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StoryDreamProvider } from '../src/ui';
import { MotionComicCharacterVoiceSample, type MotionComicCharacterVoiceSampleProps } from '../src/features/motion-comic/MotionComicCharacterVoiceSample';
import '../src/styles/tokens.css';
const calls: string[] = [];
let finish: (mode: string) => void = () => {};
let mediaFinish: (url: string) => void = () => {};
let mediaReject: () => void = () => {};
const qa = { calls, finish: (mode: string) => finish(mode), mediaFinish: (url: string) => mediaFinish(url), mediaReject: () => mediaReject(), playError: false };
Object.assign(window, { voiceQA: qa });
HTMLMediaElement.prototype.play = function () { calls.push(`play:${this.getAttribute('src')}`); return qa.playError ? Promise.reject(new Error('模拟播放失败')) : Promise.resolve(); };
HTMLMediaElement.prototype.pause = function () { calls.push('pause'); };
HTMLMediaElement.prototype.load = function () { calls.push('reset'); };
function Fixture() {
  const [sample, setSample] = useState<MotionComicCharacterVoiceSampleProps['sample']>();
  const [shown, setShown] = useState(true);
  const [disabled, setDisabled] = useState(false);
  return <StoryDreamProvider theme="dark"><main style={{ maxWidth: 1040, margin: 'auto', padding: 24, color: 'var(--shell-text)' }}>
    <h1>人物详情 · 声音样本</h1><p>离线验收：真实组件、模拟回调，无生产接口。</p>
    <div style={{ marginBottom: 24, display: 'flex', gap: 8, flexWrap: 'wrap' }}><button onClick={() => setSample({ id: 'b', localPath: 'B.wav', durationMs: 18500 })}>切换样本B</button><button onClick={() => setSample({ id: 'missing' })}>缺失文件</button><button onClick={() => setShown(false)}>卸载</button><label><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} />禁用</label></div>
    {shown && <MotionComicCharacterVoiceSample characterName="林溪" sample={sample} disabled={disabled}
      onImport={() => { calls.push('import'); return new Promise((resolve, reject) => { finish = mode => { if (mode === 'error') reject(new Error('模拟保存失败')); else { if (mode === 'save') setSample({ id: 'a', localPath: '林溪-日常对白.wav', durationMs: 12500 }); resolve(); } }; }); }}
      onUnlink={() => { calls.push('unlink'); return new Promise((resolve, reject) => { finish = mode => { if (mode === 'error') reject(new Error('模拟解绑失败')); else { setSample(undefined); resolve(); } }; }); }}
      getMediaUrl={path => { calls.push(`url:${path}`); return new Promise((resolve, reject) => { mediaFinish = resolve; mediaReject = () => reject(new Error('模拟地址读取失败')); }); }} />}
  </main></StoryDreamProvider>;
}
document.body.style.margin = '0'; document.body.style.background = 'var(--shell-bg)';
createRoot(document.getElementById('root')!).render(<Fixture />);
