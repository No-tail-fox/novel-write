const PRELOAD_ERROR_EVENT = 'vite:preloadError';
const PRELOAD_ERROR_SIGNATURE_KEY = 'storydream:preload-error-signature';

type PreloadRecoveryTarget = Pick<Window, 'addEventListener' | 'removeEventListener' | 'location' | 'sessionStorage'>;

function preloadErrorSignature(event: Event): string {
  const payload = (event as Event & { payload?: unknown }).payload;
  if (payload instanceof Error) return payload.message;
  return String(payload ?? 'unknown-preload-error');
}

export function installPreloadRecovery(target: PreloadRecoveryTarget = window): () => void {
  let lastSignature = '';
  const handlePreloadError = (event: Event) => {
    const signature = preloadErrorSignature(event);
    if (lastSignature === signature) return;
    try {
      if (target.sessionStorage.getItem(PRELOAD_ERROR_SIGNATURE_KEY) === signature) return;
    } catch {
      // A blocked sessionStorage should not prevent recovery.
    }
    lastSignature = signature;
    try {
      target.sessionStorage.setItem(PRELOAD_ERROR_SIGNATURE_KEY, signature);
    } catch {
      // The in-memory signature still prevents a reload loop.
    }
    event.preventDefault();
    target.location.reload();
  };

  target.addEventListener(PRELOAD_ERROR_EVENT, handlePreloadError);
  return () => target.removeEventListener(PRELOAD_ERROR_EVENT, handlePreloadError);
}
