export type HtmlVideoMediaLoader = (taskId: string, path: string) => Promise<string>;
export type HtmlVideoMediaStatus = 'ready' | 'loading' | 'unavailable' | 'desktop-only';

export interface HtmlVideoMediaCache {
  taskId: string;
  urls: Map<string, string>;
  requests: Map<string, Promise<string>>;
}

export interface HtmlVideoMediaElementScope {
  taskId: string;
  pathKey: string;
  generation: number;
}

export interface HtmlVideoMediaElementFailureState extends HtmlVideoMediaElementScope {
  failedPaths: string[];
}

export function htmlVideoMediaElementScopeMatches(
  scope: HtmlVideoMediaElementScope,
  currentScope: HtmlVideoMediaElementScope,
): boolean {
  return scope.taskId === currentScope.taskId
    && scope.pathKey === currentScope.pathKey
    && scope.generation === currentScope.generation;
}

export function recordHtmlVideoMediaElementFailure(
  current: HtmlVideoMediaElementFailureState,
  eventScope: HtmlVideoMediaElementScope,
  currentScope: HtmlVideoMediaElementScope,
  path: string,
): HtmlVideoMediaElementFailureState {
  if (!htmlVideoMediaElementScopeMatches(eventScope, currentScope)) return current;
  const failedPaths = htmlVideoMediaElementScopeMatches(current, eventScope) ? current.failedPaths : [];
  if (failedPaths.includes(path)) return current;
  return { ...eventScope, failedPaths: [...failedPaths, path] };
}

export function htmlVideoMediaStatus(
  path: string,
  mediaUrls: Readonly<Record<string, string>>,
  failedMediaPaths: ReadonlySet<string>,
  isBrowserPreview: boolean,
): HtmlVideoMediaStatus {
  if (failedMediaPaths.has(path)) return 'unavailable';
  if (mediaUrls[path]) return 'ready';
  return isBrowserPreview ? 'desktop-only' : 'loading';
}

export function htmlVideoMediaElementKey(taskId: string, path: string, generation: number): string {
  return JSON.stringify([taskId, path, generation]);
}

export function createHtmlVideoMediaCache(): HtmlVideoMediaCache {
  return { taskId: '', urls: new Map(), requests: new Map() };
}

export function syncHtmlVideoMediaCache(
  cache: HtmlVideoMediaCache,
  taskId: string,
  paths: readonly string[],
): HtmlVideoMediaCache {
  if (cache.taskId !== taskId) {
    cache.taskId = taskId;
    cache.urls.clear();
    cache.requests.clear();
  }
  const activePaths = new Set(paths);
  for (const path of cache.urls.keys()) {
    if (!activePaths.has(path)) cache.urls.delete(path);
  }
  for (const path of cache.requests.keys()) {
    if (!activePaths.has(path)) cache.requests.delete(path);
  }
  return cache;
}

export function loadHtmlVideoMedia(
  cache: HtmlVideoMediaCache,
  taskId: string,
  path: string,
  loader: HtmlVideoMediaLoader,
): Promise<string> {
  if (cache.taskId !== taskId) {
    return Promise.reject(new Error('HTML video media cache task does not match the request.'));
  }
  const cachedUrl = cache.urls.get(path);
  if (cachedUrl !== undefined) return Promise.resolve(cachedUrl);
  const pendingRequest = cache.requests.get(path);
  if (pendingRequest) return pendingRequest;

  let request: Promise<string>;
  request = Promise.resolve()
    .then(() => loader(taskId, path))
    .then((url) => {
      if (!url.trim()) throw new Error('HTML video media URL is empty.');
      if (cache.taskId === taskId && cache.requests.get(path) === request) {
        cache.urls.set(path, url);
      }
      return url;
    })
    .finally(() => {
      if (cache.requests.get(path) === request) cache.requests.delete(path);
    });
  cache.requests.set(path, request);
  return request;
}
