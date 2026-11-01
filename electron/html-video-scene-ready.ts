/** Wait for an exportable first frame, including initial media trim seeks. */
export function createHtmlVideoSceneReadyScript(): string {
  return `new Promise((resolve, reject) => {
    const mediaFailure = () => {
      const error = window.__mediaError || window.__htmlVideoMediaError;
      return typeof error === 'string' && error ? new Error(error) : null;
    };
    const isReady = () => document.readyState !== 'loading'
      && window.__ready === true
      && (!window.__playerReady || window.__renderReady === true)
      && window.__tl
      && typeof window.__tl.seek === 'function';
    const finish = () => {
      const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
      const imagesReady = Promise.all(Array.from(document.images).map((image) => {
        const imageError = () => new Error('HTML scene image failed to load. Verify the task image assets and retry.');
        if (image.complete) {
          return image.naturalWidth > 0 ? Promise.resolve() : Promise.reject(imageError());
        }
        return new Promise((imageResolve, imageReject) => {
          image.addEventListener('load', () => {
            if (image.naturalWidth > 0) imageResolve();
            else imageReject(imageError());
          }, { once: true });
          image.addEventListener('error', () => imageReject(imageError()), { once: true });
        });
      }));
      const videosReady = Promise.all(Array.from(document.querySelectorAll('video')).map((video) => {
        const videoError = () => new Error('HTML scene video failed to load. Verify the task video asset and retry.');
        if (video.error) return Promise.reject(videoError());
        const frameReady = () => !video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
        if (frameReady()) return Promise.resolve();
        return new Promise((videoResolve, videoReject) => {
          // Seeking after loadeddata can temporarily lower readyState without a second loadeddata event.
          const events = ['loadeddata', 'canplay', 'seeked', 'error'];
          const check = () => {
            if (!video.error && !frameReady()) return;
            events.forEach((event) => video.removeEventListener(event, check));
            if (video.error) videoReject(videoError());
            else videoResolve();
          };
          events.forEach((event) => video.addEventListener(event, check));
          check();
        });
      }));
      Promise.all([fontsReady, imagesReady, videosReady]).then(
        () => requestAnimationFrame(() => resolve(true)),
        reject,
      );
    };
    const initialFailure = mediaFailure();
    if (initialFailure) {
      reject(initialFailure);
      return;
    }
    if (isReady()) {
      finish();
      return;
    }
    const timer = setInterval(() => {
      const failure = mediaFailure();
      if (failure) {
        clearInterval(timer);
        reject(failure);
        return;
      }
      if (isReady()) {
        clearInterval(timer);
        finish();
      }
    }, 16);
  })`;
}
