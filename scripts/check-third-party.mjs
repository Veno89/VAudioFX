import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('public/third-party/manifest.json', 'utf8'));
for (const entry of manifest.files) {
  const path = entry.path.startsWith('node_modules/')
    ? entry.path
    : `public/third-party/${entry.path}`;
  const bytes = await readFile(path);
  if (
    bytes.length !== entry.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== entry.sha256
  )
    throw new Error(`Third-party integrity mismatch: ${entry.path}`);
}
console.log(
  `Verified ${manifest.files.length} pinned audio dependency sources, licenses and codec binaries.`,
);
