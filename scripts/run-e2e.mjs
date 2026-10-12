import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { unzipSync } from 'fflate';

const children = new Set();
const production = process.argv.includes('--production');
const profileMemory = process.argv.includes('--profile-memory');
const releasePreview = process.argv.includes('--release-preview');
if (releasePreview && !production) throw new Error('Use --production with --release-preview.');
let extractedPreview;
const port = Number(process.env.VAFX_QA_PORT ?? 5183);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('VAFX_QA_PORT must be an integer from 1024 to 65535.');
const baseURL = `http://127.0.0.1:${port}`;
let finished = false;
function launch(path, args, stdio = 'inherit', cwd) {
  const child = spawn(process.execPath, [path, ...args], {
    stdio,
    windowsHide: true,
    cwd,
    env: {
      ...process.env,
      VAFX_PREVIEW_PORT: String(port),
      VAFX_QA_PRODUCTION: production ? '1' : '0',
      VAFX_QA_MEMORY_PROFILE: profileMemory ? '1' : '0',
    },
  });
  children.add(child);
  console.log(`Task-owned process ${child.pid}: ${path}`);
  child.once('exit', () => children.delete(child));
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const terminate = (force) =>
      new Promise((resolve) => {
        const killer = spawn(
          'taskkill',
          ['/PID', String(child.pid), '/T', ...(force ? ['/F'] : [])],
          {
            windowsHide: true,
            stdio: 'ignore',
          },
        );
        killer.on('exit', resolve);
        killer.on('error', resolve);
      });
    await terminate(false);
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) await terminate(true);
  } else {
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
  await Promise.race([
    new Promise((resolve) =>
      child.exitCode !== null || child.signalCode !== null
        ? resolve()
        : child.once('exit', resolve),
    ),
    delay(2000),
  ]);
  if (child.exitCode === null && child.signalCode === null)
    throw new Error(`Task-owned process ${child.pid} did not exit after cleanup.`);
}
async function cleanup() {
  if (finished) return;
  finished = true;
  await Promise.all([...children].map(stop));
  if (extractedPreview) {
    const qaRoot = resolve('.qa') + sep;
    if (!resolve(extractedPreview).startsWith(qaRoot))
      throw new Error('Refusing cleanup outside the QA directory.');
    await rm(extractedPreview, { recursive: true });
  }
}
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));
process.on('SIGTERM', () => void cleanup().then(() => process.exit(143)));
let result = 1;
let browserConsoleError = false;
try {
  // Refuse to test against another person's server.
  let occupied = false;
  try {
    await fetch(baseURL, { signal: AbortSignal.timeout(1000) });
    occupied = true;
  } catch {
    /* Port is available. */
  }
  if (occupied) throw new Error(`QA port ${port} is occupied. Choose another VAFX_QA_PORT.`);
  if (releasePreview) {
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    const entries = unzipSync(await readFile(`artifacts/vaudiofx-${version}-local-preview.zip`));
    await mkdir('.qa', { recursive: true });
    extractedPreview = await mkdtemp(resolve('.qa/release-preview-'));
    for (const [path, bytes] of Object.entries(entries)) {
      const target = resolve(extractedPreview, path);
      if (!target.startsWith(extractedPreview + sep)) throw new Error('Unsafe release ZIP path.');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  }
  const server = launch(
    releasePreview ? resolve(extractedPreview, 'preview.mjs') : 'node_modules/vite/bin/vite.js',
    releasePreview
      ? []
      : [
          ...(production ? ['preview'] : []),
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ],
    ['ignore', 'pipe', 'pipe'],
    extractedPreview,
  );
  server.stdout.on('data', () => {});
  let serverErrorTail = '';
  server.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    const output = serverErrorTail + chunk.toString();
    if (output.includes('[console.error]')) browserConsoleError = true;
    serverErrorTail = output.slice(-8192);
  });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null) throw new Error('QA server exited before readiness.');
    try {
      const response = await fetch(baseURL, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Startup is bounded below. */
    }
    await delay(250);
  }
  if (!ready) throw new Error('QA server did not become ready.');
  const runner = launch('node_modules/@playwright/test/cli.js', [
    'test',
    ...process.argv
      .slice(2)
      .filter((arg) => !['--production', '--profile-memory', '--release-preview'].includes(arg)),
  ]);
  const profiler = profileMemory
    ? launch('scripts/profile-memory.mjs', [String(runner.pid)])
    : undefined;
  const profileExit = profiler
    ? new Promise((resolve) => profiler.once('exit', resolve))
    : undefined;
  const timeout = setTimeout(() => {
    console.error('Browser suite exceeded its 10-minute limit.');
    void stop(runner);
  }, 600000);
  result = await new Promise((resolve) => {
    runner.once('exit', (code) => resolve(code ?? 1));
    runner.once('error', () => resolve(1));
  });
  clearTimeout(timeout);
  if (profiler && (await Promise.race([profileExit, delay(8000).then(() => 'timeout')])) !== 0)
    throw new Error('The task-owned memory profiler did not complete successfully.');
} catch (error) {
  result = 1;
  console.error(error.message);
} finally {
  await cleanup();
}
if (browserConsoleError) {
  console.error('The QA server received a browser console error. Review the error above.');
  result = 1;
}
console.log('Task-owned QA processes stopped.');
process.exitCode = result;
