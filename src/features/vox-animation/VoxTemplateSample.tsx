import { useEffect, useMemo, useState } from 'react';
import type { VoxAnimation } from '../../shared/vox-animation';
import { VoxAnimationPreview, type VoxApi, type VoxLocalAsset } from './VoxAnimationPreview';
import { createVoxTemplateExample, voxTemplateExampleAssets } from './vox-template-examples';

const previewApis = new WeakMap<VoxApi, VoxApi>();
let examples: ReturnType<typeof voxTemplateExampleAssets> | undefined;
function sampleContext(api: VoxApi) {
  const assets = examples ??= voxTemplateExampleAssets();
  let previewApi = previewApis.get(api);
  if (!previewApi) {
    previewApi = { ...api, readVoxAnimationAsset: async path => assets.find(asset => asset.path === path)?.url ?? api.readVoxAnimationAsset(path) };
    previewApis.set(api, previewApi);
  }
  return { api: previewApi, assets };
}

/** Only mounted by the active hover; its frames use the export composition. */
export function VoxTemplateSample({ templateId, api, ratio = '16:9', animation, assets = [], durationMs = 6000 }: {
  templateId: string; api: VoxApi; ratio?: string; animation?: VoxAnimation; assets?: readonly VoxLocalAsset[]; durationMs?: number;
}) {
  const sample = useMemo(() => createVoxTemplateExample(templateId), [templateId]);
  const context = useMemo(() => sampleContext(api), [api]);
  const [ready, setReady] = useState(false), [timeMs, setTimeMs] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const duration = animation ? durationMs : sample.durationMs;
  const loopDuration = Math.min(duration, 6000);
  const cues = useMemo(() => !animation ? sample.cues : sample.cues.map(cue => ({ ...cue, startMs: cue.startMs * duration / sample.durationMs, endMs: cue.endMs * duration / sample.durationMs,
    tokens: cue.tokens?.map(token => ({ ...token, startMs: token.startMs * duration / sample.durationMs, endMs: token.endMs * duration / sample.durationMs })),
  })), [animation, sample, duration]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!ready) return;
    if (reducedMotion) { setTimeMs(loopDuration * .4); return; }
    let frame = 0, previous = performance.now();
    const started = previous;
    const tick = (now: number) => {
      if (now - previous >= 1000 / 24) { previous = now; setTimeMs((now - started) % loopDuration); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, reducedMotion, loopDuration]);
  return <div className="vox-template-sample" data-ratio={ratio} style={{ aspectRatio: ratio.replace(':', '/') }}>
    <VoxAnimationPreview animation={animation ?? sample.animation} api={context.api} assets={animation ? assets : context.assets} ratio={ratio} durationMs={duration} timeMs={timeMs} cues={cues} onReady={setReady} />
  </div>;
}
