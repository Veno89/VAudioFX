import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('src/features/sample-manifest.json', 'utf8'));
const ids = new Set();
for (const asset of manifest) {
  if (ids.has(asset.id)) throw new Error(`Duplicate sample: ${asset.id}`);
  ids.add(asset.id);
  const bytes = await readFile(`public${asset.url}`);
  if (
    bytes.length !== asset.size ||
    createHash('sha256').update(bytes).digest('hex') !== asset.checksum ||
    bytes.subarray(0, 4).toString() !== 'OggS' ||
    asset.duration <= 0
  )
    throw new Error(`Invalid sample: ${asset.id}`);
  const license = await readFile(`public${asset.verification}`, 'utf8');
  if (asset.license !== 'CC0-1.0' || !license.includes('CC0'))
    throw new Error(`Unverified license: ${asset.id}`);
}
console.log(
  `${manifest.length} audio files verified: size, SHA-256, OGG headers, duration, and CC0 license.`,
);
