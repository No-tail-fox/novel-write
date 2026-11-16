/** Release the save queue once the backend has durably recorded the running job.
 * The long cloud request remains observed by the caller, outside that queue. */
export async function startRecordedVideoRequest<T>({ start, isRecorded, delay = () => new Promise<void>(resolve => setTimeout(resolve, 250)) }: {
  start: () => Promise<T>;
  isRecorded: () => Promise<boolean>;
  delay?: () => Promise<void>;
}): Promise<{ completion: Promise<T> }> {
  const completion = start();
  let settled = false;
  const settlement = completion.then(() => { settled = true; }, () => { settled = true; });
  // A slow/unavailable state read must not monopolize editing indefinitely.
  // The in-flight shot guard and backend expectedUpdatedAt remain authoritative.
  for (let attempt = 0; attempt < 120 && !settled; attempt++) {
    const recorded = await Promise.race([isRecorded().catch(() => false), settlement.then(() => true), delay().then(() => false)]);
    if (recorded || settled) break;
    await Promise.race([delay(), settlement]);
  }
  return { completion };
}
