import type { VoxAnimationPayload } from '../vox-animation';

/** The page keeps its own drawing, CSS and text. Only the clock and local dependencies are bridged. */
export function buildLemoNativeHtml(runtime: string, payload: VoxAnimationPayload, localAssetUrls: readonly string[] = []): string {
  const safe = (source: string) => source.replace(/<\/script/gi, '<\\/script');
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');
  // Only render-host-staged files are allowed; the editor preview remains data/blob-only.
  const localSources = localAssetUrls.map(value => {
    const url = new URL(value);
    if (url.protocol !== 'file:' || url.host || url.search || url.hash) throw new Error('LEMO_ASSET_URL: Expected a staged local file.');
    return url.href.replace(/'/g, '%27').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }).join(' ');
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-storydream-html-video'; style-src 'unsafe-inline'; img-src data: blob: ${localSources}; media-src data: blob: ${localSources}; connect-src data: blob:; font-src data:; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const boot = `${policy}<script nonce="storydream-html-video">${safe(runtime)}</script><script nonce="storydream-html-video">(()=>{const payload=${data};window.LEMO_ASSETS=Object.fromEntries(payload.assets.map(a=>[a.id,a.url]));window.LemoHost.install(payload);})();</script>`;
  const finish = `<script nonce="storydream-html-video">window.LemoHost.start().catch(window.LemoHost.fail);</script>`;
  let page = payload.animation.code.compiled;
  if (!/<head(?:\s[^>]*)?>/i.test(page) || !/<\/body\s*>/i.test(page)) throw new Error('LEMO_HTML_INVALID: 原生动画需要完整 HTML 页面。');
  page = page.replace(/<head(?:\s[^>]*)?>/i, match => match + '<meta charset="utf-8">' + boot);
  return page.replace(/<\/body\s*>/i, finish + '</body>');
}
