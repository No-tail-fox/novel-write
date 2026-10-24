let authorize: () => Promise<void> = async () => undefined;

// Installed by the desktop main process; providers check again when dispatching queued work.
export function setGenerationAuthorization(check: () => Promise<void>): void { authorize = check; }
export function requireGenerationAuthorization(): Promise<void> { return authorize(); }
