import { describe, expect, it } from 'vitest';
import { startRecordedVideoRequest } from '../src/features/motion-comic/motion-comic-video-background';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
describe('recorded background video requests', () => {
  it('releases the project save queue after durable submission while the cloud request remains pending', async () => {
    const cloud = deferred<string>();
    const persisted = deferred<boolean>();
    let secondShotSaved = false;
    const preparation = startRecordedVideoRequest({ start: () => cloud.promise, isRecorded: () => persisted.promise, delay: () => new Promise(() => {}) });
    const saveQueue = preparation.then(() => { secondShotSaved = true; });
    expect(secondShotSaved).toBe(false);
    persisted.resolve(true);
    await saveQueue;
    expect(secondShotSaved).toBe(true);
    const { completion } = await preparation;
    cloud.resolve('candidate');
    expect(await completion).toBe('candidate');
  });
  it('observes a failed submission and releases the queue with the original failure', async () => {
    const request = await startRecordedVideoRequest({ start: async () => { throw new Error('provider unavailable'); }, isRecorded: () => new Promise(() => {}), delay: () => new Promise(() => {}) });
    await expect(request.completion).rejects.toThrow('provider unavailable');
  });
  it('bounds state polling failures without dropping the cloud result', async () => {
    const cloud = deferred<string>(); let reads = 0;
    const request = await startRecordedVideoRequest({ start: () => cloud.promise, isRecorded: async () => { reads++; throw new Error('read unavailable'); }, delay: async () => {} });
    expect(reads).toBe(120);
    cloud.resolve('saved');
    expect(await request.completion).toBe('saved');
  });
});
