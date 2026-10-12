import { mkdir, writeFile } from 'node:fs/promises';
import { collectFiles, sha256 } from './check-release.mjs';
import { qualificationInputs } from './qualification-inputs.mjs';

// The quality:gate chain reaches this step only after all preceding checks exit zero.
const record = {
  completedUtc: new Date().toISOString(),
  command: 'npm run quality:gate',
  node: process.version,
  inputs: await qualificationInputs(),
  builtFiles: Object.fromEntries(
    [...(await collectFiles('dist'))].map(([path, bytes]) => [path, sha256(bytes)]),
  ),
};
await mkdir('.qa', { recursive: true });
await writeFile('.qa/qualification.json', JSON.stringify(record, null, 2) + '\n');
console.log('Passing gate input/build hashes recorded in .qa/qualification.json.');
