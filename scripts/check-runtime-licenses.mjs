import { readFile, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
let notices =
  'VAudioFX runtime software notices\n\nAudio DSP and codec licenses and corresponding source: /third-party/index.html\nFull MPL 2.0 license: /third-party/SoundTouch-MPL-2.0.txt\n\n';
let count = 0;
for (const [path, info] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path.startsWith('node_modules/') || info.dev || info.devOptional) continue;
  const pkg = JSON.parse(await readFile(`${path}/package.json`, 'utf8'));
  let license;
  for (const name of ['LICENSE', 'LICENSE.txt', 'LICENSE.md']) {
    try {
      license = await readFile(`${path}/${name}`, 'utf8');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  if (!license) throw new Error(`Missing runtime license: ${path}`);
  notices += `${pkg.name}@${pkg.version} (${pkg.license ?? 'See license below'})\n${'='.repeat(64)}\n${license.trim()}\n\n`;
  count++;
}
const target = 'public/licenses/runtime-software.txt';
if (process.argv.includes('--write')) await writeFile(target, notices, 'utf8');
else if ((await readFile(target, 'utf8')) !== notices)
  throw new Error(
    'Runtime software notices differ from the locked installed dependencies. Run node scripts/check-runtime-licenses.mjs --write.',
  );
console.log(`Verified complete notices for ${count} locked runtime packages.`);
