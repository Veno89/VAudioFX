import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile, writeFile } from 'node:fs/promises';

test('portable originals recover after browser storage loss and imports stay local', async ({
  page,
  browserName,
}) => {
  const outgoing: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1')
      outgoing.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
  await page.getByLabel('Generated sound name').fill('Recoverable original');
  await page.getByLabel('Generator duration (s)').fill('0.3');
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.getByRole('slider', { name: /^Independent pitch/ }).fill('-7');
  await page.getByRole('button', { name: 'Save project locally (Ctrl+S)', exact: true }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  const originalHash = await page.evaluate(async () => {
    const path = '/src/storage/database.ts',
      { database } = await import(/* @vite-ignore */ path);
    const original = (await database.all('assets'))[0].blob;
    return Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', await original.arrayBuffer())),
    ).join(',');
  });
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Portable backup', exact: true }).click();
  const backup = await download,
    backupPath = `.qa/recovery-${browserName}.vafx`;
  await backup.saveAs(backupPath);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(async () => {
    const path = '/src/storage/database.ts',
      { database } = await import(/* @vite-ignore */ path);
    await database.close();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('vaudiofx');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Disposable test storage still open'));
    });
  });
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  await page.locator('input[type=file][accept=".vafx"]').setInputFiles(backupPath);
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.locator('.audio-clip').click();
  await expect(page.getByRole('slider', { name: /^Independent pitch/ })).toHaveValue('-7');
  const recovered = await page.evaluate(async () => {
    const path = '/src/storage/database.ts',
      { database } = await import(/* @vite-ignore */ path);
    const original = (await database.all('assets'))[0];
    return {
      hash: Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await original.blob.arrayBuffer())),
      ).join(','),
      license: original.license,
      verification: original.verification,
    };
  });
  expect(recovered.hash).toBe(originalHash);
  expect(recovered.license).toBe('CC0-1.0');
  expect(recovered.verification).toContain('Generated locally');
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback' }).click();
  expect(outgoing).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('maximum project renders and a large portable backup stays responsive and preserves originals', async ({
  page,
  browserName,
}) => {
  test.setTimeout(90000);
  if (process.env.VAFX_QA_MEMORY_PROFILE === '1')
    await expect
      .poll(() => readFile(`.qa/memory-ready-${process.ppid}.txt`, 'utf8').catch(() => ''), {
        timeout: 15000,
      })
      .toBe('ready');
  await page.goto('/');
  if (process.env.VAFX_QA_MEMORY_PROFILE === '1') {
    const path = `.qa/memory-baseline-${process.ppid}-${browserName}`;
    await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
    await writeFile(`${path}.request`, 'ready');
    await expect
      .poll(() => readFile(`${path}.ready`, 'utf8').catch(() => ''), { timeout: 15000 })
      .toBe('ready');
  }
  const result = await page.evaluate(async () => {
    const modelPath = '/src/domain/model.ts',
      renderPath = '/src/audio/render.ts',
      assetPath = '/src/audio/assets.ts',
      wavPath = '/src/export/wav.ts',
      packagePath = '/src/export/project-package.ts';
    const { newProject, makeClip, makeTrack, cleanEffects, uid } = await import(
        /* @vite-ignore */ modelPath
      ),
      { renderProject } = await import(/* @vite-ignore */ renderPath),
      { assetRepository } = await import(/* @vite-ignore */ assetPath),
      { encodeWav } = await import(/* @vite-ignore */ wavPath),
      { exportPackage, importPackage } = await import(/* @vite-ignore */ packagePath);
    const sampleRate = 48000,
      seconds = 120,
      factory = new OfflineAudioContext(2, seconds * sampleRate, sampleRate),
      source = factory.createBuffer(2, seconds * sampleRate, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const samples = source.getChannelData(channel);
      for (let i = 0; i < samples.length; i++)
        samples[i] = Math.sin((i * 2 * Math.PI * 440) / sampleRate) * (channel ? 0.04 : 0.08);
    }
    const original = encodeWav(source),
      asset = {
        id: 'maximum-source',
        name: 'Maximum original',
        duration: seconds,
        blob: original,
        size: original.size,
        mime: 'audio/wav',
        kind: 'import',
        category: 'Imported',
        tags: [],
        originalFilename: 'maximum.wav',
      },
      project = newProject();
    project.export = { ...project.export, tail: 0, limiter: true };
    project.tracks = Array.from({ length: 16 }, (_, track) => ({
      ...makeTrack(track),
      clips: Array.from({ length: 8 }, (_, clip) => ({
        ...makeClip(asset, clip * 15),
        id: uid(),
        trimEnd: 15,
        pitchSemitones: 7,
        gain: 0.1,
        effects: { ...cleanEffects(), enabled: false },
        automation: {
          gain: [
            { time: 0, value: 0.7 },
            { time: 1, value: 1 },
          ],
          pan: [],
          lowpass: [],
        },
      })),
    }));
    const decode = assetRepository.decode;
    assetRepository.decode = async () => source;
    let ticks = 0,
      longestGap = 0,
      previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      longestGap = Math.max(longestGap, now - previous);
      previous = now;
      ticks++;
    }, 20);
    const start = performance.now();
    try {
      const rendered: { buffer: AudioBuffer; memory: Record<string, number> } = await renderProject(
        project,
        [asset],
      );
      const renderMs = performance.now() - start,
        packageStart = performance.now(),
        backup = await exportPackage(project, [asset]);
      const restored = await importPackage(backup),
        restoredOriginal = restored.assets[0].blob;
      const hash = async (blob: Blob) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
        ).join(',');
      let peak = 0;
      for (const sample of rendered.buffer.getChannelData(0)) {
        if (!Number.isFinite(sample)) throw new Error('Nonfinite maximum render');
        peak = Math.max(peak, Math.abs(sample));
      }
      const controller = new AbortController(),
        canceled = exportPackage(project, [asset], controller.signal);
      controller.abort();
      let aborted = false;
      try {
        await canceled;
      } catch (error) {
        aborted = (error as Error).name === 'AbortError';
      }
      return {
        memory: rendered.memory,
        duration: rendered.buffer.duration,
        renderMs,
        packageMs: performance.now() - packageStart,
        backupBytes: backup.size,
        clips: restored.project.tracks.reduce(
          (n: number, t: { clips: unknown[] }) => n + t.clips.length,
          0,
        ),
        hashMatches: (await hash(original)) === (await hash(restoredOriginal)),
        ticks,
        longestGap,
        peak,
        aborted,
      };
    } finally {
      clearInterval(timer);
      assetRepository.decode = decode;
    }
  });
  expect(result.duration).toBe(120);
  expect(result.memory).toEqual({
    decodedBytes: 120 * 48000 * 2 * 4,
    preparedBytes: 15 * 48000 * 2 * 4,
    renderedBytes: 120 * 48000 * 2 * 4,
  });
  expect(result.clips).toBe(128);
  expect(result.backupBytes).toBeGreaterThan(23_000_000);
  expect(result.hashMatches).toBe(true);
  expect(result.aborted).toBe(true);
  expect(result.ticks).toBeGreaterThan(10);
  expect(result.longestGap).toBeLessThan(1000);
  expect(result.peak).toBeGreaterThan(0.1);
  expect(result.peak).toBeLessThanOrEqual(0.892);
  console.log('Maximum project measurements:', JSON.stringify(result));
});

test('editor and primary dialogs have no automated accessibility violations; keyboard focus stays in the dialog', async ({
  page,
  browserName,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  const scan = async (state: string) => {
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
      .analyze();
    if (violations.length)
      await test
        .info()
        .attach(`accessibility-${state}.json`, {
          body: JSON.stringify(violations, null, 2),
          contentType: 'application/json',
        });
    expect(
      violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
      state,
    ).toEqual([]);
  };
  await scan('Empty editor');
  const generate = page.getByRole('button', { name: 'Generate sound', exact: true });
  await generate.click();
  await scan('Generator dialog');
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(generate).toBeFocused();
  await generate.click();
  await page.getByLabel('Generator duration (s)').fill('0.4');
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  const clip = page.locator('.audio-clip').first();
  await clip.focus();
  await page.keyboard.press('Space');
  await expect(clip).toHaveClass(/clip-selected/);
  await expect(page.getByRole('button', { name: 'Play composition', exact: true })).toBeVisible();
  await scan('Selected clip inspector');
  await page.locator('.inspector details > summary').evaluateAll((summaries) =>
    summaries.forEach((summary) => {
      (summary.parentElement as HTMLDetailsElement).open = true;
    }),
  );
  await scan('Expanded inspector and effect presets');
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  await scan('Export dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  await scan('Project dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Record', exact: true }).first().click();
  await scan('Idle recording dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Help and keyboard shortcuts', exact: true }).click();
  await scan('Help dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Licenses ↗', exact: true }).click();
  await scan('License dialog');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await scan('Template library');
  await page.screenshot({ path: `.qa/hardening-${browserName}.png` });
});
