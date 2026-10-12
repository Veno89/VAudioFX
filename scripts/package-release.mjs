import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { collectFiles, inspectRelease, sha256 } from './check-release.mjs';
import { qualificationInputs } from './qualification-inputs.mjs';

const { files, bytes } = await inspectRelease();
const qualificationBytes = await readFile('.qa/qualification.json');
const qualification = JSON.parse(qualificationBytes);
if (
  JSON.stringify(qualification.inputs) !== JSON.stringify(await qualificationInputs()) ||
  JSON.stringify(qualification.builtFiles) !==
    JSON.stringify(Object.fromEntries([...files].map(([path, data]) => [path, sha256(data)])))
)
  throw new Error(
    'Source or build differs from the passing gate. Run quality:gate before packaging.',
  );
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const source = new Map();
for (const directory of ['src', 'public', 'scripts', 'tests', 'docs'])
  for (const [path, data] of await collectFiles(directory))
    source.set(`${directory}/${path}`, sha256(data));
for (const path of [
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'playwright.config.ts',
  'tsconfig.json',
  'netlify.toml',
  'security-headers.json',
  'README.md',
  'AGENTS.md',
])
  source.set(path, sha256(await readFile(path)));
const sourceFiles = Object.fromEntries([...source].sort(([a], [b]) => a.localeCompare(b)));
let revision = null;
try {
  revision = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  /* An unborn branch has no Git revision. */
}
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const provenance = {
  name: 'VAudioFX',
  version,
  kind: 'local-preview',
  createdUtc: new Date().toISOString(),
  branch,
  revision,
  uncommittedSource: true,
  sourceFingerprint: sha256(JSON.stringify(sourceFiles)),
  sourceFiles,
  builtFiles: Object.fromEntries(
    [...files].map(([path, data]) => [path, { bytes: data.length, sha256: sha256(data) }]),
  ),
  builtBytes: bytes,
  qualification:
    'See validation.md for checks and release.md for pending manual signoff. No publication or deployment is implied.',
};
const entries = Object.fromEntries([...files].map(([path, data]) => [`app/${path}`, data]));
for (const [target, path] of [
  ['release.md', 'docs/release.md'],
  ['validation.md', 'docs/validation.md'],
  ['preview.mjs', 'scripts/preview-release.mjs'],
  ['security-headers.json', 'security-headers.json'],
])
  entries[target] = await readFile(path);
entries['provenance.json'] = strToU8(JSON.stringify(provenance, null, 2) + '\n');
entries['qualification.json'] = qualificationBytes;
entries['README.txt'] = strToU8(
  'VAudioFX local preview\n\nRequires Node.js 24 or newer. Extract this entire ZIP, open a terminal in its folder, run:\n\n  node preview.mjs\n\nOpen http://127.0.0.1:5184. Stop the preview with Ctrl+C. Do not open index.html directly; microphone and workers require localhost or HTTPS. See release.md, validation.md and provenance.json for exact scope and pending manual checks. The app/ folder contains static hosting files; apply security-headers.json on the host.\n',
);
const archive = zipSync(entries, { level: 6 }),
  restored = unzipSync(archive);
if (Object.keys(restored).length !== Object.keys(entries).length)
  throw new Error('Release ZIP file count differs.');
for (const [path, data] of Object.entries(entries))
  if (sha256(restored[path]) !== sha256(data))
    throw new Error(`Release ZIP verification failed: ${path}`);
await mkdir('artifacts', { recursive: true });
const path = `artifacts/vaudiofx-${version}-local-preview.zip`;
await writeFile(path, archive);
await writeFile(`${path}.sha256`, `${sha256(archive)}  ${path.split('/').at(-1)}\n`);
await writeFile(`${path}.provenance.json`, entries['provenance.json']);
console.log(
  `Verified local preview: ${path}, ${archive.length} bytes, SHA-256 ${sha256(archive)}. Source fingerprint ${provenance.sourceFingerprint}; Git revision ${revision ?? 'none (unborn branch)'}.`,
);
