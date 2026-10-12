import type { AudioWork, AudioWorkResult } from './work-contract';

/** A single task owns a worker, a finite deadline and all transferred copies. */
export function audioWork<T extends AudioWork['kind']>(
  job: Extract<AudioWork, { kind: T }>,
  signal?: AbortSignal,
): Promise<Extract<AudioWorkResult, { kind: T }>> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: unknown, result?: Extract<AudioWorkResult, { kind: T }>) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(signal?.reason ?? new DOMException('Canceled', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Audio processing exceeded its two-minute limit.')),
      120000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error(event.message || 'Audio worker failed.'));
    };
    worker.onmessage = (event: MessageEvent<AudioWorkResult | { error: string }>) => {
      if ('error' in event.data) finish(new Error(event.data.error));
      else if (event.data.kind !== job.kind) finish(new Error('Unexpected audio worker response.'));
      else finish(undefined, event.data as Extract<AudioWorkResult, { kind: T }>);
    };
    try {
      worker.postMessage(
        job,
        job.channels.map((c) => c.buffer),
      );
    } catch (error) {
      finish(error);
    }
  });
}
