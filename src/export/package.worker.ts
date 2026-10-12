import { exportPackage, importPackage } from './package-core';
import type { PackageJob, PackageResult } from './project-package';

self.onmessage = async (event: MessageEvent<PackageJob>) => {
  try {
    const job = event.data;
    const result: PackageResult =
      job.kind === 'export'
        ? { kind: 'export', blob: await exportPackage(job.project, job.assets) }
        : { kind: 'import', ...(await importPackage(job.blob)) };
    self.postMessage(result);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Project package failed.' });
  }
};
