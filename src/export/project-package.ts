import type { Asset, Project } from '../domain/model';

export type PackageJob =
  { kind: 'export'; project: Project; assets: Asset[] } | { kind: 'import'; blob: Blob };
export type PackageResult =
  { kind: 'export'; blob: Blob } | { kind: 'import'; project: Project; assets: Asset[] };

function packageWork<K extends PackageJob['kind']>(
  job: Extract<PackageJob, { kind: K }>,
  signal?: AbortSignal,
): Promise<Extract<PackageResult, { kind: K }>> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./package.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (error?: unknown, result?: Extract<PackageResult, { kind: K }>) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(signal?.reason ?? new DOMException('Canceled', 'AbortError'));
    const timer = setTimeout(
      () => finish(new Error('Project packaging exceeded its two-minute limit.')),
      120000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error(event.message || 'Project package worker failed.'));
    };
    worker.onmessage = (event: MessageEvent<PackageResult | { error: string }>) => {
      if ('error' in event.data) finish(new Error(event.data.error));
      else if (event.data.kind !== job.kind)
        finish(new Error('Unexpected package worker response.'));
      else finish(undefined, event.data as Extract<PackageResult, { kind: K }>);
    };
    try {
      worker.postMessage(job);
    } catch (error) {
      finish(error);
    }
  });
}

export async function exportPackage(
  project: Project,
  assets: Asset[],
  signal?: AbortSignal,
): Promise<Blob> {
  return (await packageWork({ kind: 'export', project, assets }, signal)).blob;
}
export async function importPackage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<{ project: Project; assets: Asset[] }> {
  const { project, assets } = await packageWork({ kind: 'import', blob }, signal);
  return { project, assets };
}
