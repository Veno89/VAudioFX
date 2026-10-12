import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function collectFiles(root) {
  const files = new Map();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile())
        files.set(relative(root, path).replaceAll('\\', '/'), await readFile(path));
      else throw new Error(`Release input must be an ordinary file or directory: ${path}`);
    }
  }
  await visit(root);
  return new Map([...files].sort(([a], [b]) => a.localeCompare(b)));
}
export async function inspectRelease(root = resolve('dist')) {
  const files = await collectFiles(root);
  const requireFile = (path) => {
    const bytes = files.get(path);
    if (!bytes?.length) throw new Error(`Missing release file: ${path}`);
    return bytes;
  };
  const samples = JSON.parse(await readFile('src/features/sample-manifest.json', 'utf8'));
  for (const asset of samples) {
    const bytes = requireFile(asset.url.slice(1));
    if (bytes.length !== asset.size || sha256(bytes) !== asset.checksum)
      throw new Error(`Distributed sample mismatch: ${asset.id}`);
    if (!requireFile(asset.verification.slice(1)).toString().includes('CC0'))
      throw new Error(`Missing distributed sample license: ${asset.id}`);
  }
  const thirdParty = JSON.parse(requireFile('third-party/manifest.json'));
  for (const entry of thirdParty.files) {
    const bytes = entry.path.startsWith('node_modules/')
      ? [...files].find(
          ([path, data]) => path.endsWith('.wasm') && sha256(data) === entry.sha256,
        )?.[1]
      : requireFile(`third-party/${entry.path}`);
    if (!bytes || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
      throw new Error(`Distributed audio dependency mismatch: ${entry.path}`);
  }
  if (
    !requireFile('licenses/runtime-software.txt').equals(
      await readFile('public/licenses/runtime-software.txt'),
    )
  )
    throw new Error('Runtime software notices differ from reviewed input.');
  const headers = JSON.parse(await readFile('security-headers.json', 'utf8'));
  const hosting = await readFile('netlify.toml', 'utf8');
  for (const [name, value] of Object.entries(headers)) {
    if (
      !hosting.split(/\r?\n/).some((line) => line.trim() === `${name} = ${JSON.stringify(value)}`)
    )
      throw new Error(`Hosting header mismatch: ${name}`);
  }
  const shell = requireFile('index.html').toString(),
    sw = requireFile('sw.js').toString();
  const precache = JSON.parse(sw.match(/const FILES = (\[[^\n]+\]);/)?.[1] ?? 'null');
  if (!Array.isArray(precache) || !precache.includes('/index.html'))
    throw new Error('Offline shell precache is missing.');
  for (const path of precache) if (path !== '/') requireFile(path.slice(1));
  for (const path of files.keys())
    if (path.startsWith('assets/') && !precache.includes(`/${path}`))
      throw new Error(`Built asset not available offline: ${path}`);
  for (const kind of ['package.worker-', 'audio.worker-', 'mp3-', 'ogg-'])
    if (![...files.keys()].some((path) => path.startsWith(`assets/${kind}`)))
      throw new Error(`Missing built worker or codec: ${kind}`);
  for (const [, path] of shell.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g))
    requireFile(path.slice(1));
  const bytes = [...files.values()].reduce((sum, file) => sum + file.length, 0);
  console.log(
    `Production artifact verified: ${files.size} files, ${bytes} bytes, ${samples.length} samples, ${thirdParty.files.length} pinned audio dependencies, runtime notices, offline assets and hosting headers.`,
  );
  return { files, bytes, headers };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await inspectRelease();
