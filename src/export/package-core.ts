import { zipSync } from 'fflate';
import { LIMITS, validateProject, type Asset, type Project } from '../domain/model';

const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function checksum(data: Uint8Array<ArrayBuffer>): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function exportPackage(project: Project, assets: Asset[]): Promise<Blob> {
  project = validateProject(project);
  const files: Record<string, Uint8Array<ArrayBuffer>> = {};
  const entries: unknown[] = [];
  let size = 0;
  for (const id of [...new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))]) {
    const asset = assets.find((a) => a.id === id);
    if (!asset) throw new Error('A referenced audio source is missing.');
    let blob = asset.blob;
    if (!blob && asset.url) {
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('Could not retrieve a portable audio source.');
      blob = await response.blob();
    }
    if (!blob) throw new Error('A referenced audio source is unavailable.');
    const data = new Uint8Array(await blob.arrayBuffer());
    size += data.length;
    if (!data.length || data.length > LIMITS.fileBytes || size > LIMITS.totalBytes)
      throw new Error('Project audio exceeds the portable package limit.');
    const path = `audio/${entries.length}.bin`;
    files[path] = data;
    const { blob: _blob, url: _url, ...metadata } = asset;
    entries.push({ ...metadata, path, checksum: await checksum(data) });
  }
  files['manifest.json'] = encoder.encode(
    JSON.stringify({
      format: 'VAudioFX',
      version: 3,
      project,
      assets: entries,
    }),
  );
  if (files['manifest.json'].length > 1024 * 1024)
    throw new Error('Project manifest is too large for a portable backup.');
  // Stored ZIP entries let the importer bound memory without trusting compressed sizes.
  const archive = zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>;
  if (archive.length > LIMITS.totalBytes + 1024 * 1024)
    throw new Error('Portable project exceeds the archive size limit.');
  return new Blob([archive], {
    type: 'application/x-vaudiofx',
  });
}
function readStoredZip(bytes: Uint8Array<ArrayBuffer>): Map<string, Uint8Array<ArrayBuffer>> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>(),
    headers = new Map<string, { offset: number; flags: number; size: number; crc: number }>(),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0,
    total = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    if (offset + 30 > bytes.length) throw new Error('Truncated project archive.');
    const flags = view.getUint16(offset + 6, true),
      method = view.getUint16(offset + 8, true),
      packed = view.getUint32(offset + 18, true),
      size = view.getUint32(offset + 22, true),
      nameLength = view.getUint16(offset + 26, true),
      extraLength = view.getUint16(offset + 28, true);
    if (flags & ~0x800 || method !== 0 || size !== packed || view.getUint16(offset + 4, true) > 20)
      throw new Error(
        'Use a VAudioFX stored ZIP package. Encrypted or compressed project entries are not supported.',
      );
    const begin = offset + 30 + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    if (
      begin + size > bytes.length ||
      size > LIMITS.fileBytes ||
      (name !== 'manifest.json' && (total += size) > LIMITS.totalBytes) ||
      files.size >= LIMITS.assets + 1
    )
      throw new Error('Project archive is truncated or exceeds safe size limits.');
    if (!/^(manifest\.json|audio\/\d+\.bin)$/.test(name) || files.has(name))
      throw new Error('Unsafe or duplicate project archive path.');
    if (name === 'manifest.json' && size > 1024 * 1024)
      throw new Error('Project manifest is too large.');
    const data = bytes.subarray(begin, begin + size),
      crc = view.getUint32(offset + 14, true);
    if (crc32(data) !== crc) throw new Error('ZIP file integrity check failed.');
    files.set(name, data);
    headers.set(name, { offset, flags, size, crc });
    offset = begin + size;
  }
  if (!files.has('manifest.json')) throw new Error('Invalid project ZIP archive.');
  const directoryStart = offset,
    directoryNames = new Set<string>();
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x02014b50) {
    if (offset + 46 > bytes.length) throw new Error('Truncated project ZIP directory.');
    const nameLength = view.getUint16(offset + 28, true),
      extraLength = view.getUint16(offset + 30, true),
      commentLength = view.getUint16(offset + 32, true),
      end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error('Truncated project ZIP directory.');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      local = headers.get(name);
    if (
      !local ||
      directoryNames.has(name) ||
      view.getUint16(offset + 6, true) > 20 ||
      view.getUint16(offset + 8, true) !== local.flags ||
      view.getUint16(offset + 10, true) !== 0 ||
      view.getUint32(offset + 16, true) !== local.crc ||
      view.getUint32(offset + 20, true) !== local.size ||
      view.getUint32(offset + 24, true) !== local.size ||
      view.getUint16(offset + 34, true) !== 0 ||
      view.getUint32(offset + 42, true) !== local.offset
    )
      throw new Error('Inconsistent project ZIP directory.');
    directoryNames.add(name);
    offset = end;
  }
  if (
    offset + 22 > bytes.length ||
    view.getUint32(offset, true) !== 0x06054b50 ||
    view.getUint16(offset + 4, true) !== 0 ||
    view.getUint16(offset + 6, true) !== 0 ||
    directoryNames.size !== files.size ||
    view.getUint16(offset + 8, true) !== files.size ||
    view.getUint16(offset + 10, true) !== files.size ||
    view.getUint32(offset + 12, true) !== offset - directoryStart ||
    view.getUint32(offset + 16, true) !== directoryStart ||
    offset + 22 + view.getUint16(offset + 20, true) !== bytes.length
  )
    throw new Error('Invalid or truncated project ZIP directory.');
  return files;
}
export async function importPackage(blob: Blob): Promise<{ project: Project; assets: Asset[] }> {
  if (blob.size > LIMITS.totalBytes + 1024 * 1024 || !blob.size)
    throw new Error('Portable project must be smaller than 151 MB.');
  const files = readStoredZip(new Uint8Array(await blob.arrayBuffer()));
  const manifestData = files.get('manifest.json')!;
  if (manifestData.length > 1024 * 1024) throw new Error('Project manifest is too large.');
  const rawManifest: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(manifestData),
  );
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest))
    throw new Error('Invalid portable project manifest.');
  const manifest = rawManifest as Record<string, unknown>;
  if (
    manifest.format !== 'VAudioFX' ||
    (manifest.version !== 1 && manifest.version !== 2 && manifest.version !== 3) ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length > LIMITS.assets
  )
    throw new Error('Unsupported portable project format.');
  const project = validateProject(manifest.project),
    assets: Asset[] = [],
    ids = new Set<string>(),
    paths = new Set<string>();
  for (const raw of manifest.assets) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid audio metadata.');
    const a = raw as Record<string, unknown>;
    const text = (key: string) => {
      if (typeof a[key] !== 'string' || (a[key] as string).length > 200)
        throw new Error('Invalid audio metadata.');
      return a[key] as string;
    };
    const id = text('id'),
      path = text('path'),
      mime = text('mime');
    if (
      !id ||
      ids.has(id) ||
      paths.has(path) ||
      !/^audio\/(ogg|wav|x-wav|webm|mpeg|mp4|aac|flac|x-flac|opus)$/.test(mime)
    )
      throw new Error('Invalid or duplicate audio source.');
    ids.add(id);
    paths.add(path);
    const data = files.get(path);
    if (
      !data ||
      !data.length ||
      a.size !== data.length ||
      typeof a.duration !== 'number' ||
      !Number.isFinite(a.duration) ||
      a.duration <= 0 ||
      a.duration > LIMITS.duration ||
      (await checksum(data)) !== a.checksum
    )
      throw new Error('Audio integrity check failed.');
    if (!['builtin', 'import', 'recording'].includes(text('kind')))
      throw new Error('Invalid audio origin.');
    const provenance: Partial<Asset> = {};
    for (const [key, limit] of [
      ['pack', 200],
      ['author', 200],
      ['license', 200],
      ['sourceUrl', 2048],
      ['verification', 4096],
    ] as const) {
      if (a[key] === undefined) continue;
      if (typeof a[key] !== 'string' || a[key].length > limit)
        throw new Error('Invalid audio provenance.');
      if (key === 'sourceUrl' && !/^https?:\/\//i.test(a[key]))
        throw new Error('Invalid audio provenance URL.');
      provenance[key] = a[key];
    }
    const tags = a.tags === undefined ? [] : a.tags;
    if (
      !Array.isArray(tags) ||
      tags.length > 32 ||
      tags.some((tag) => typeof tag !== 'string' || tag.length > 80)
    )
      throw new Error('Invalid audio tags.');
    assets.push({
      ...provenance,
      id,
      name: text('name'),
      kind: a.kind as Asset['kind'],
      category: text('category'),
      tags: [...tags],
      checksum: a.checksum as string,
      duration: a.duration,
      size: data.length,
      mime,
      originalFilename: text('originalFilename'),
      blob: new Blob([data], { type: mime }),
    });
  }
  if (files.size !== assets.length + 1) throw new Error('Unexpected files in the project archive.');
  for (const clip of project.tracks.flatMap((t) => t.clips)) {
    const asset = assets.find((a) => a.id === clip.assetId);
    if (!asset || clip.trimEnd > asset.duration + 0.005)
      throw new Error('Clip references missing or invalid source audio.');
  }
  return { project, assets };
}
