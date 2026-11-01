/** Seek the full composition runtime before capturing, including clip gates and media. */
export function createHtmlVideoFrameSeekScript(time: number): string {
  return `(async () => {
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
      if (!media.seeking) return;
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          media.removeEventListener('seeked', complete);
          media.removeEventListener('error', fail);
        };
        const complete = () => { cleanup(); resolve(); };
        const fail = () => { cleanup(); reject(new Error('HTML scene media seek failed.')); };
        media.addEventListener('seeked', complete, { once: true });
        media.addEventListener('error', fail, { once: true });
      });
    }));
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
    });
  })()`;
}
