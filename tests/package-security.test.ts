import { expect, it, vi } from 'vitest';
import { zipSync, unzipSync } from 'fflate';
import { exportPackage, importPackage } from '../src/export/package-core';
import { makeClip, newProject, type Asset } from '../src/domain/model';

const asset: Asset = {
  id: 'original',
  name: 'Original',
  kind: 'import',
  category: 'Imported',
  tags: ['voice'],
  duration: 1,
  size: 4,
  mime: 'audio/wav',
  originalFilename: 'original.wav',
  blob: new Blob([new Uint8Array([1, 2, 3, 4])]),
  author: 'Source author',
  license: 'Owner license',
  sourceUrl: 'https://example.com/source',
  verification: 'Original provenance',
};
async function archive() {
  const p = newProject();
  p.tracks[0].clips = [makeClip(asset)];
  return new Uint8Array(await (await exportPackage(p, [asset])).arrayBuffer());
}
const blob = (bytes: Uint8Array<ArrayBuffer>) => new Blob([bytes]);
it('rejects an empty original before producing a backup', async () => {
  const project = newProject();
  project.tracks[0].clips = [makeClip(asset)];
  await expect(exportPackage(project, [{ ...asset, blob: new Blob([]), size: 0 }])).rejects.toThrow(
    'limit',
  );
});
function signature(bytes: Uint8Array, sig: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 4 <= bytes.length; i++) if (view.getUint32(i, true) === sig) return i;
  throw new Error('Test archive signature missing');
}
async function changedManifest(change: (m: { assets: Record<string, unknown>[] }) => unknown) {
  const files = unzipSync(await archive());
  const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
  const replaced = change(manifest);
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(replaced ?? manifest));
  return blob(zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>);
}

it('rejects every truncated prefix and trailing archive bytes', async () => {
  const bytes = await archive();
  for (let end = 0; end < bytes.length; end++)
    await expect(importPackage(blob(bytes.slice(0, end))), `prefix ${end}`).rejects.toThrow();
  await expect(importPackage(blob(new Uint8Array([...bytes, 0])))).rejects.toThrow('directory');
});
it.each([6, 8, 10, 16, 20, 24, 34, 42, 46])(
  'rejects inconsistent central directory field at offset %i',
  async (field) => {
    const bytes = await archive(),
      offset = signature(bytes, 0x02014b50);
    bytes[offset + field] ^= 0xff;
    await expect(importPackage(blob(bytes))).rejects.toThrow();
  },
);
it.each([4, 6, 8, 10, 12, 16, 20])(
  'rejects inconsistent end directory field at offset %i',
  async (field) => {
    const bytes = await archive(),
      offset = signature(bytes, 0x06054b50);
    bytes[offset + field] ^= 0xff;
    await expect(importPackage(blob(bytes))).rejects.toThrow('directory');
  },
);
it.each([1, 8, 0x40, 0x2000])(
  'rejects unsupported ZIP flag %i before processing payloads',
  async (flag) => {
    const bytes = await archive();
    new DataView(bytes.buffer).setUint16(6, flag, true);
    await expect(importPackage(blob(bytes))).rejects.toThrow('compressed');
  },
);
it('rejects oversized manifests and invalid UTF-8 without accepting a partial project', async () => {
  await expect(
    importPackage(
      blob(
        zipSync(
          { 'manifest.json': new Uint8Array(1024 * 1024 + 1) },
          { level: 0 },
        ) as Uint8Array<ArrayBuffer>,
      ),
    ),
  ).rejects.toThrow('manifest');
  await expect(
    importPackage(
      blob(
        zipSync(
          { 'manifest.json': new Uint8Array([0xff]) },
          { level: 0 },
        ) as Uint8Array<ArrayBuffer>,
      ),
    ),
  ).rejects.toThrow();
  await expect(importPackage(await changedManifest(() => []))).rejects.toThrow('manifest');
});
it('rejects valid-CRC packages with mismatched SHA, duplicate source IDs and unsafe provenance', async () => {
  await expect(
    importPackage(
      await changedManifest((m) => {
        m.assets[0].checksum = '0'.repeat(64);
      }),
    ),
  ).rejects.toThrow('integrity');
  await expect(
    importPackage(
      await changedManifest((m) => {
        m.assets.push(m.assets[0]);
      }),
    ),
  ).rejects.toThrow('duplicate');
  await expect(
    importPackage(
      await changedManifest((m) => {
        m.assets[0].sourceUrl = 'javascript:alert(1)';
      }),
    ),
  ).rejects.toThrow('provenance');
});
it('preserves bounded provenance and tags across repeated backups without fetching imported URLs', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    const restored = await importPackage(
      await changedManifest((m) => {
        m.assets[0].url = 'https://example.com/do-not-fetch';
      }),
    );
    expect(restored.assets[0]).toMatchObject({
      author: asset.author,
      license: asset.license,
      sourceUrl: asset.sourceUrl,
      verification: asset.verification,
      tags: asset.tags,
    });
    expect(restored.assets[0].url).toBeUndefined();
    const again = await importPackage(await exportPackage(restored.project, restored.assets));
    expect(again.assets[0]).toMatchObject({
      license: asset.license,
      verification: asset.verification,
      tags: asset.tags,
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
