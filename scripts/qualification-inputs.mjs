import { readFile } from 'node:fs/promises';
import { collectFiles, sha256 } from './check-release.mjs';

export async function qualificationInputs() {
  const inputs = new Map();
  for (const directory of ['src', 'public', 'scripts', 'tests'])
    for (const [path, data] of await collectFiles(directory))
      inputs.set(`${directory}/${path}`, sha256(data));
  for (const path of [
    'package.json',
    'package-lock.json',
    'vite.config.ts',
    'playwright.config.ts',
    'tsconfig.json',
    'netlify.toml',
    'security-headers.json',
    'AGENTS.md',
  ])
    inputs.set(path, sha256(await readFile(path)));
  return Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b)));
}
