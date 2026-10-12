import { expect, it, vi } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { exportPackage, importPackage } from '../src/export/package-core';
import { makeClip, newProject, type Asset } from '../src/domain/model';

// Scale only the audio budget to exercise its exact boundary without allocating 150 MiB.
vi.mock('../src/domain/model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/domain/model')>();
  return { ...actual, LIMITS: { ...actual.LIMITS, totalBytes: 100 } };
});
function input(count = 5) {
  const assets: Asset[] = Array.from({ length: count }, (_, i) => ({
    id: `source-${i}`,
    name: `Original ${i}`,
    kind: 'import',
    category: 'Imported',
    tags: [],
    duration: 1,
    size: 20,
    mime: 'audio/wav',
    originalFilename: `${i}.wav`,
    blob: new Blob([new Uint8Array(20).fill(i)]),
  }));
  const project = newProject();
  project.tracks[0].clips = assets.map((a) => makeClip(a));
  return { project, assets };
}
it('roundtrips audio at the exact budget while reserving manifest and directory space', async () => {
  const { project, assets } = input(),
    archive = await exportPackage(project, assets);
  expect(archive.size).toBeGreaterThan(100);
  const restored = await importPackage(archive);
  expect(restored.assets.map((a) => a.size)).toEqual([20, 20, 20, 20, 20]);
  expect(new Uint8Array(await restored.assets[4].blob!.arrayBuffer())).toEqual(
    new Uint8Array(20).fill(4),
  );
});
it('rejects excess audio on both export and import without spending the manifest reserve', async () => {
  const over = input(6);
  await expect(exportPackage(over.project, over.assets)).rejects.toThrow('limit');
  const valid = input(),
    files = unzipSync(
      new Uint8Array(await (await exportPackage(valid.project, valid.assets)).arrayBuffer()),
    );
  files['audio/5.bin'] = new Uint8Array(20);
  await expect(
    importPackage(new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>])),
  ).rejects.toThrow('limits');
});
it('rejects an oversized export manifest rather than creating an unrecoverable backup', async () => {
  const { project, assets } = input(1);
  assets[0].verification = 'x'.repeat(1024 * 1024);
  await expect(exportPackage(project, assets)).rejects.toThrow('manifest');
});
