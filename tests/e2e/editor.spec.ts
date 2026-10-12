import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const consoleErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await page.exposeFunction('captureConsoleError', (value: string) => errors.push(value));
  await page.addInitScript(() => {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      const origin = new Error('Console error origin').stack;
      void (
        window as unknown as { captureConsoleError: (value: string) => Promise<void> }
      ).captureConsoleError(`${args.map(String).join(' ')}\n${origin}`);
      original(...args, origin);
    };
  });
});
test.afterEach(async ({ page }) => {
  if (!page.isClosed()) await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
  expect(consoleErrors.get(page)).toEqual([]);
});

async function open(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
}
function voiceWav() {
  const buffer = Buffer.alloc(44 + 48000 * 2);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24);
  buffer.writeUInt32LE(96000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(96000, 40);
  for (let i = 0; i < 48000; i++)
    buffer.writeInt16LE(Math.round(Math.sin((i * Math.PI * 2 * 180) / 48000) * 10000), 44 + i * 2);
  return buffer;
}
async function inputAudio(page: Page) {
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: voiceWav() });
  await expect(page.getByRole('button', { name: 'Add voice', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add voice', exact: true }).click();
}

test('page lifecycle cancels active loops and pending preview work, then restores a usable editor', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /Fireball.*Open template/ }).click();
  await page.getByRole('button', { name: 'Loop selected clip', exact: true }).click();
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const path = '/src/audio/playback.ts',
      { playback } = await import(/* @vite-ignore */ path);
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    const stopped = !playback.playing,
      position = playback.position;
    await new Promise((resolve) => setTimeout(resolve, 100));
    const frozen = playback.position === position;
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    return { stopped, frozen };
  });
  expect(result.stopped).toBe(true);
  expect(result.frozen).toBe(true);
  await expect(page.getByRole('button', { name: 'Play composition', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await page.getByRole('slider', { name: 'Clean / dirty', exact: true }).fill('0.21');
  await page.evaluate(async () => {
    const assetsPath = '/src/audio/assets.ts',
      { assetRepository } = await import(/* @vite-ignore */ assetsPath);
    const original = assetRepository.decode.bind(assetRepository);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalRender = OfflineAudioContext.prototype.startRendering;
    const state = { release, finished: false, renderStarted: false };
    assetRepository.decode = async (asset: unknown) => {
      await held;
      try {
        return await original(asset);
      } finally {
        state.finished = true;
        assetRepository.decode = original;
      }
    };
    Object.assign(window, { previewLifecycleProbe: state });
    OfflineAudioContext.prototype.startRendering = function () {
      state.renderStarted = true;
      const rendered = originalRender.call(this);
      void rendered.then(() => {
        state.finished = true;
        OfflineAudioContext.prototype.startRendering = originalRender;
        assetRepository.decode = original;
      });
      return rendered;
    };
  });
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play composition', exact: true })).toBeDisabled();
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    (
      window as unknown as { previewLifecycleProbe: { release: () => void } }
    ).previewLifecycleProbe.release();
  });
  await page.waitForFunction(
    () =>
      (window as unknown as { previewLifecycleProbe: { finished: boolean } }).previewLifecycleProbe
        .finished,
  );
  expect(
    await page.evaluate(async () => {
      const path = '/src/audio/playback.ts',
        { playback } = await import(/* @vite-ignore */ path);
      return playback.playing;
    }),
  ).toBe(false);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { previewLifecycleProbe: { renderStarted: boolean } })
          .previewLifecycleProbe.renderStarted,
    ),
  ).toBe(false);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })),
  );
  await expect(page.getByRole('button', { name: 'Play composition', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
});

test('custom ordered chains can be saved, edited, duplicated, reset, and recovered', async ({
  page,
}) => {
  await open(page);
  await inputAudio(page);
  await page.locator('summary').filter({ hasText: 'Tone balance' }).click();
  await page.getByRole('slider', { name: 'Weight (180 Hz)', exact: true }).fill('6');
  await page.getByRole('checkbox', { name: 'Enable Even out loudness', exact: true }).check();
  await page.locator('summary').filter({ hasText: 'Even out loudness' }).click();
  await page.getByRole('slider', { name: 'Compression threshold', exact: true }).fill('-80');
  await page.getByRole('button', { name: 'Move Echo earlier', exact: true }).click();
  await expect(page.locator('.chain-list li').nth(5)).toContainText('Echo');
  await page.locator('summary').filter({ hasText: 'Your effect-chain presets' }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Heavy creature');
  await page.getByRole('button', { name: 'Save new chain', exact: true }).click();
  await expect(page.getByText('Presets saved in this browser.', { exact: true })).toBeVisible();
  await page.getByRole('slider', { name: 'Weight (180 Hz)', exact: true }).fill('8');
  await page.getByRole('button', { name: 'Update chain', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Update chain', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Duplicate chain', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Saved effect chain', exact: true }).locator('option'),
  ).toHaveCount(3);
  await page.getByRole('button', { name: 'Delete chain', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Saved effect chain', exact: true }).locator('option'),
  ).toHaveCount(2);
  await page
    .getByRole('combobox', { name: 'Saved effect chain', exact: true })
    .selectOption({ label: 'Heavy creature' });
  await page.getByRole('button', { name: 'Reset effects', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Weight (180 Hz)', exact: true })).toHaveValue('0');
  await page.getByRole('button', { name: 'Load chain', exact: true }).click();
  await expect(
    page.getByRole('slider', { name: 'Compression threshold', exact: true }),
  ).toHaveValue('-80');
  await expect(page.getByRole('slider', { name: 'Weight (180 Hz)', exact: true })).toHaveValue('8');
  await expect(
    page.getByRole('checkbox', { name: 'Enable Even out loudness', exact: true }),
  ).toBeChecked();
  await page.locator('.effect-chain').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.qa/chains-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: /Save project locally/ }).click();
  await expect(page.getByText('Project saved locally.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Select clip voice', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Your effect-chain presets' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Saved effect chain', exact: true }).locator('option'),
  ).toHaveCount(2);
  await expect(page.locator('.chain-list li').nth(5)).toContainText('Echo');
});

test('cleanup, audition loops, repetitions, keyboard editing, cross-layer drag, and full WAV output', async ({
  page,
}) => {
  await open(page);
  const wav = voiceWav();
  for (let i = 0; i < 48000; i++) if (i < 9600 || i >= 36000) wav.writeInt16LE(0, 44 + i * 2);
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'voice.wav', mimeType: 'audio/wav', buffer: wav });
  await page.getByRole('button', { name: 'Add voice', exact: true }).click();
  await page.getByRole('button', { name: 'Trim quiet edges', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Source in (s)', exact: true })).toHaveValue(
    '0.19',
  );
  await expect(page.getByRole('spinbutton', { name: 'Source out (s)', exact: true })).toHaveValue(
    '0.76',
  );
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Source in (s)', exact: true })).toHaveValue(
    '0',
  );
  await page.getByRole('checkbox', { name: 'Noise gate', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Normalize source region to −1 dB', exact: true })
    .check();
  await page.getByRole('button', { name: 'Loop selected clip', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Loop playback', exact: true })).toBeChecked();
  await page.getByRole('spinbutton', { name: 'Loop start (s)', exact: true }).fill('0.2');
  await page.getByRole('spinbutton', { name: 'Loop end (s)', exact: true }).fill('0.5');
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Total repetitions', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Repeat clip', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.locator('.audio-clip').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Position (s)', exact: true })).toHaveValue(
    '0.01',
  );
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByRole('spinbutton', { name: 'Position (s)', exact: true })).toHaveValue(
    '0.06',
  );
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('dialog', { name: 'Clip actions' })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate clip', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  const clip = (await page.locator('.audio-clip').boundingBox())!,
    target = (await page.locator('.track-canvas').nth(1).boundingBox())!;
  await page.mouse.move(clip.x + clip.width / 2, clip.y + clip.height / 2);
  await page.mouse.down();
  await page.mouse.move(clip.x + clip.width / 2, target.y + target.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('.track-canvas').nth(0).locator('.audio-clip')).toHaveCount(0);
  await expect(page.locator('.track-canvas').nth(1).locator('.audio-clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fit timeline to view', exact: true }).click();
  await page.screenshot({ path: `.qa/milestone2-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  await page.getByRole('checkbox', { name: /Peak normalization/ }).uncheck();
  await page.getByRole('checkbox', { name: /Hard peak limiter/ }).check();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download WAV', exact: true }).click();
  const bytes = await readFile((await (await pending).path())!);
  const duration = (bytes.length - 44) / (bytes.readUInt32LE(24) * bytes.readUInt16LE(22) * 2);
  expect(duration).toBeGreaterThan(2);
  expect(duration).toBeLessThan(3);
});
test('import, trim, creature effects, second layer, recovery, and genuine WAV export', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  await inputAudio(page);
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Zombie gurgle');
  await page.getByRole('spinbutton', { name: 'Source in (s)', exact: true }).fill('0.15');
  await page.getByRole('button', { name: 'Creature voice Apply' }).click();
  await expect(page.getByRole('slider', { name: 'Darker / brighter' })).toHaveValue('2600');
  await page.getByRole('textbox', { name: 'Name of layer 2' }).click();
  await page.getByRole('button', { name: 'Add Footstep carpet 000', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Play composition' }).click();
  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback' }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(
    'Zombie gurgle',
  );
  await page.getByRole('button', { name: 'Select clip voice', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Darker / brighter' })).toHaveValue('2600');
  await expect(page.getByRole('spinbutton', { name: 'Source in (s)', exact: true })).toHaveValue(
    '0.15',
  );
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download WAV', exact: true }).click();
  const downloaded = await pending;
  const bytes = await readFile((await downloaded.path())!);
  expect(downloaded.suggestedFilename()).toBe('zombie_gurgle.wav');
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.length).toBeGreaterThan(48000);
  expect(bytes.subarray(44).some((value) => value !== 0)).toBe(true);
  expect(errors).toEqual([]);
});
test('fireball template, timed layers, source waveforms, and portable project recovery', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /Fireball.*Open template/ }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await expect(page.locator('.audio-clip .waveform')).toHaveCount(3);
  await page.getByRole('spinbutton', { name: 'Position (s)' }).fill('0.1');
  await page.getByRole('slider', { name: 'Clean / dirty' }).fill('0.25');
  await page.getByRole('slider', { name: 'Darker / brighter' }).fill('3000');
  await page.getByRole('checkbox', { name: 'Noise gate', exact: true }).check();
  await page
    .getByRole('checkbox', { name: 'Normalize source region to −1 dB', exact: true })
    .check();
  await page.getByRole('button', { name: 'Move Echo earlier', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Loop start (s)', exact: true }).fill('0.2');
  await page.getByRole('spinbutton', { name: 'Loop end (s)', exact: true }).fill('0.6');
  await page.getByRole('checkbox', { name: 'Loop playback', exact: true }).check();
  await page.screenshot({ path: `.qa/editor-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Portable backup', exact: true }).click();
  const download = await pending,
    file = (await download.path())!;
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  // Isolate every original and saved project before importing the portable package.
  await page.evaluate(async () => {
    const modulePath = '/src/storage/database.ts';
    const { database } = await import(/* @vite-ignore */ modulePath);
    for (const p of await database.all('projects')) await database.deleteProject(p.id);
    for (const a of await database.all('assets')) await database.deleteAsset(a.id);
  });
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  await page.locator('input[type=file][accept=".vafx"]').setInputFiles(file);
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select clip Ignition rush', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Position (s)' })).toHaveValue('0.1');
  await expect(page.getByRole('slider', { name: 'Clean / dirty' })).toHaveValue('0.25');
  await expect(page.getByRole('checkbox', { name: 'Noise gate', exact: true })).toBeChecked();
  await expect(
    page.getByRole('checkbox', { name: 'Normalize source region to −1 dB', exact: true }),
  ).toBeChecked();
  await expect(page.locator('.chain-list li').nth(5)).toContainText('Echo');
  await expect(page.getByRole('checkbox', { name: 'Loop playback', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Play composition' }).click();
  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
});
test('fake microphone takes persist and microphone tracks stop', async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const tracks: MediaStreamTrack[] = [];
    Object.assign(window, { capturedTracks: tracks });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      tracks.push(...stream.getTracks());
      return stream;
    };
  });
  await open(page);
  await page.getByRole('button', { name: 'Record', exact: true }).first().click();
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop & keep take', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Stop & keep take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record take', exact: true })).toBeEnabled();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop & keep take', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Stop & keep take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record take', exact: true })).toBeEnabled();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { capturedTracks: MediaStreamTrack[] }).capturedTracks.every(
        (track) => track.readyState === 'ended',
      ),
    ),
  ).toBe(true);
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await expect(page.locator('.audio-clip .waveform')).toHaveCount(2);
});
test('denied recording, unsupported audio, malformed project, and storage failure preserve usability', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException('Denied', 'NotAllowedError'));
  });
  await open(page);
  await inputAudio(page);
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page
    .locator('input[type=file][multiple]')
    .setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') });
  await expect(page.getByRole('alert')).toContainText('Choose a WAV');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).first().click();
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('permission was denied');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('input[type=file][accept=".vafx"]').setInputFiles({
    name: 'bad.vafx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('bad project'),
  });
  await expect(page.getByRole('alert')).toContainText('Invalid project');
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('Full', 'QuotaExceededError');
    };
  });
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Unsaved edit');
  await expect(page.getByRole('alert')).toContainText('Full');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue(
    'Untitled sound',
  );
  await expect(page.locator('.audio-clip')).toHaveCount(1);
});
test('layout remains contained on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /Fireball.*Open template/ }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('closing a live recording saves its take at the chosen playhead', async ({ page }) => {
  await open(page);
  await page.locator('.ruler-canvas').click({ position: { x: 165, y: 15 } });
  await page.getByRole('button', { name: 'Record', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('1.50s');
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop & keep take', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.getByRole('spinbutton', { name: 'Position (s)' })).toHaveValue('1.5');
});

test('reverse clip edge trims match the audible reversed region', async ({ page }) => {
  await open(page);
  await inputAudio(page);
  await page.getByRole('spinbutton', { name: 'Source in (s)', exact: true }).fill('0.2');
  await page.getByRole('spinbutton', { name: 'Source out (s)', exact: true }).fill('0.9');
  await page.getByRole('checkbox', { name: 'Play in reverse' }).check();
  const trim = async (selector: string, dx: number) => {
    const rect = (await page.locator(selector).boundingBox())!;
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2 + dx, rect.y + rect.height / 2, { steps: 4 });
    await page.mouse.up();
  };
  await trim('.trim-left', 11);
  await expect(page.getByRole('spinbutton', { name: 'Source out (s)', exact: true })).toHaveValue(
    '0.8',
  );
  await expect(page.getByRole('spinbutton', { name: 'Position (s)', exact: true })).toHaveValue(
    '0.1',
  );
  await trim('.trim-right', -11);
  await expect(page.getByRole('spinbutton', { name: 'Source in (s)', exact: true })).toHaveValue(
    '0.3',
  );
});
