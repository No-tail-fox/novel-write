/** Await the runtime's render promise, decoded assets and presentation before capture. */
export function createHtmlVideoFrameSeekScript(time: number, timeoutMs = 15000): string {
  if (!Number.isFinite(time) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid HTML frame seek arguments.');
  return `(async () => {
    const cleanups = [];
    let timer;
    const work = async () => {
      const videos = Array.from(document.querySelectorAll('video')).map(media => {
        const before = media.currentTime;
        // A paused seek may select the already presented decoded frame (for
        // example 12fps source -> 24fps export), so rVFC is not a seek barrier.
        // Observe presentation when available; seeked + HAVE_CURRENT_DATA is
        // the decode contract even when Chromium submits no new video frame.
        let acknowledge;
        const decoded = new Promise(resolve => { acknowledge = resolve; });
        if (typeof media.requestVideoFrameCallback === 'function') {
          const id = media.requestVideoFrameCallback(() => { acknowledge(); });
          cleanups.push(() => media.cancelVideoFrameCallback(id));
        }
        return { media, before, decoded };
      });
      const timeline = window.__tl;
      const player = window.__player;
      const useRuntime = player && typeof player.renderSeek === 'function';
      const result = useRuntime
        ? player.renderSeek(${JSON.stringify(time)}, { suppressEvents: false })
        : timeline.seek(${JSON.stringify(time)}, false);
      // GSAP returns its thenable timeline; awaiting that paused timeline never settles.
      if (result !== timeline) await result;
      if (useRuntime && typeof window.__hfWaitForSeekCompletion === 'function') {
        await window.__hfWaitForSeekCompletion();
      }
      await Promise.all(Array.from(document.querySelectorAll('video, audio')).map((media) => {
        if (media.error) throw new Error('HTML scene media seek failed.');
        if (!media.seeking) return;
        return new Promise((resolve, reject) => {
          const cleanup = () => {
            media.removeEventListener('seeked', complete);
            media.removeEventListener('error', fail);
          };
          const complete = () => { cleanup(); resolve(); };
          const fail = () => { cleanup(); reject(new Error('HTML scene media seek failed.')); };
          cleanups.push(cleanup);
          media.addEventListener('seeked', complete, { once: true });
          media.addEventListener('error', fail, { once: true });
        });
      }));
      await Promise.all(videos.filter(({media, before}) => media.currentTime !== before).map(({media, decoded}) => {
        if (media.readyState >= 2) return;
        return Promise.race([decoded, new Promise((resolve, reject) => {
          const cleanup = () => {
            media.removeEventListener('loadeddata', complete);
            media.removeEventListener('error', fail);
          };
          const complete = () => { if (media.readyState >= 2) { cleanup(); resolve(); } };
          const fail = () => { cleanup(); reject(new Error('HTML scene video decode failed.')); };
          cleanups.push(cleanup);
          media.addEventListener('loadeddata', complete);
          media.addEventListener('error', fail, { once: true });
        })]);
      }));
      if (document.fonts) await document.fonts.ready;
      await Promise.all(Array.from(document.images || []).map(image => image.decode()));
      // Presentation follows the runtime commit; rAF is not the async-render contract.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    try {
      await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('HTML scene frame seek timed out after ${timeoutMs}ms.')), ${timeoutMs});
      })]);
    } finally {
      clearTimeout(timer);
      cleanups.forEach(cleanup => cleanup());
    }
  })()`;
}
