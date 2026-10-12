import { test, expect, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const captured: string[] = [];
  errors.set(page, captured);
  page.on('console', (message) => {
    if (message.type() === 'error') captured.push(message.text());
  });
  page.on('pageerror', (error) => captured.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('all twelve templates contain decodable original sources and render distinct non-silent WAV mixes', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await expect(page.locator('.template-card')).toHaveCount(12);
  const results = await page.evaluate(async () => {
    const templatesPath = '/src/features/templates.ts',
      assetsPath = '/src/audio/assets.ts',
      renderPath = '/src/audio/render.ts',
      wavPath = '/src/export/wav.ts';
    const { templates, createTemplate } = await import(/* @vite-ignore */ templatesPath),
      { assetRepository } = await import(/* @vite-ignore */ assetsPath),
      { renderProject } = await import(/* @vite-ignore */ renderPath),
      { encodeWav } = await import(/* @vite-ignore */ wavPath);
    const output = [];
    for (const definition of templates) {
      const { project, assets } = await createTemplate(definition.id);
      let originalsValid = true;
      for (const asset of assets) {
        const buffer: AudioBuffer = await assetRepository.decode(asset),
          data = buffer.getChannelData(0);
        originalsValid &&=
          !!asset.blob &&
          asset.size === asset.blob.size &&
          Math.abs(buffer.duration - asset.duration) < 0.0001 &&
          Math.abs(data[0]) < 0.0001 &&
          Math.abs(data[data.length - 1]) < 0.0001 &&
          data.every(Number.isFinite) &&
          data.some((n) => Math.abs(n) > 0.01);
      }
      const { buffer } = await renderProject(project, assets);
      let peak = 0;
      for (let c = 0; c < buffer.numberOfChannels; c++)
        for (const value of buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(value));
      const wav: Blob = encodeWav(buffer),
        bytes = await wav.arrayBuffer(),
        decoder = new AudioContext(),
        decoded = await decoder.decodeAudioData(bytes.slice(0));
      await decoder.close();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      output.push({
        id: definition.id,
        originalsValid,
        peak,
        duration: buffer.duration,
        decodedDuration: decoded.duration,
        hash: digest,
        clips: project.tracks.flatMap((t: { clips: unknown[] }) => t.clips).length,
        sources: assets.length,
      });
    }
    return output;
  });
  expect(results).toHaveLength(12);
  expect(new Set(results.map((r) => r.hash)).size).toBe(12);
  for (const result of results) {
    expect(result.originalsValid, result.id).toBe(true);
    expect(result.peak, result.id).toBeGreaterThan(0.1);
    expect(result.peak).toBeLessThan(0.892);
    expect(result.duration).toBeCloseTo(result.decodedDuration, 3);
  }
  expect(results.find((r) => r.id === 'footsteps')).toMatchObject({ clips: 8, sources: 2 });
});

test('seven generator controls produce persistent original WAVs that survive portable backup in an empty library', async ({
  page,
}) => {
  for (const kind of ['white', 'pink', 'sine', 'square', 'sawtooth', 'sweep', 'burst']) {
    await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
    await page.getByRole('combobox', { name: 'Generator source', exact: true }).selectOption(kind);
    await page
      .getByRole('textbox', { name: 'Generated sound name', exact: true })
      .fill(kind + ' created');
    await page
      .getByRole('spinbutton', { name: 'Generator duration (s)', exact: true })
      .fill('0.15');
    if (kind === 'pink')
      await page.getByRole('spinbutton', { name: 'Noise variation', exact: true }).fill('42');
    if (kind === 'sweep') {
      await page
        .getByRole('spinbutton', { name: 'Start frequency (Hz)', exact: true })
        .fill('1800');
      await page.getByRole('spinbutton', { name: 'End frequency (Hz)', exact: true }).fill('120');
    }
    await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Select clip ' + kind + ' created', exact: true }),
    ).toBeVisible();
  }
  await expect(page.locator('.audio-clip .waveform')).toHaveCount(7);
  await page.getByRole('button', { name: 'Select clip pink created', exact: true }).click();
  await expect(page.getByText(/seconds · Generated audio/)).toBeVisible();
  await page.getByLabel('Manage pink created', { exact: true }).click();
  page.once('dialog', (dialog) => void dialog.accept('Pink texture'));
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Pink texture', exact: true })).toBeVisible();
  await page.getByLabel('Manage Pink texture', { exact: true }).click();
  await page.getByLabel('Manage white created', { exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('used by a saved project or undo history');
  await page.getByRole('button', { name: 'Dismiss error', exact: true }).click();
  await page.getByRole('button', { name: /Save project locally/ }).click();
  await expect(page.getByText('Project saved locally.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(7);
  await page.getByRole('button', { name: 'Open project', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Portable backup', exact: true }).click();
  const file = (await (await pending).path())!;
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'New project', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  await page.evaluate(async () => {
    const path = '/src/storage/database.ts',
      { database } = await import(/* @vite-ignore */ path);
    for (const p of await database.all('projects')) await database.deleteProject(p.id);
    for (const a of await database.all('assets')) await database.deleteAsset(a.id);
  });
  await page.reload();
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  await page.locator('input[type=file][accept=".vafx"]').setInputFiles(file);
  await expect(page.locator('.audio-clip .waveform')).toHaveCount(7);
  await page.getByRole('button', { name: 'Play composition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
});

test('native tones have distinct harmonics, sweeps change frequency, and macros change rendered samples', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const path = '/src/audio/synthesis.ts',
      assetsPath = '/src/audio/assets.ts',
      creativePath = '/src/features/creative.ts',
      modelPath = '/src/domain/model.ts',
      renderPath = '/src/audio/render.ts';
    const { sourceDefaults, generateSource } = await import(/* @vite-ignore */ path),
      { assetRepository } = await import(/* @vite-ignore */ assetsPath),
      { macroPatch } = await import(/* @vite-ignore */ creativePath),
      { makeClip, newProject, editClip } = await import(/* @vite-ignore */ modelPath),
      { renderProject } = await import(/* @vite-ignore */ renderPath);
    const measure = (data: Float32Array, frequency: number) => {
      let real = 0,
        imaginary = 0;
      for (let i = 4800; i < 19200; i++) {
        const phase = (2 * Math.PI * frequency * i) / 48000;
        real += data[i] * Math.cos(phase);
        imaginary += data[i] * Math.sin(phase);
      }
      return Math.hypot(real, imaginary);
    };
    const harmonics = [];
    for (const kind of ['sine', 'square', 'sawtooth']) {
      const asset = await generateSource(
          { ...sourceDefaults(), kind, duration: 0.6, from: 440, to: 440, shape: 'steady' },
          kind,
        ),
        buffer = await assetRepository.decode(asset),
        data = buffer.getChannelData(0);
      harmonics.push({
        kind,
        second: measure(data, 880) / measure(data, 440),
        third: measure(data, 1320) / measure(data, 440),
      });
    }
    const sweep = await generateSource(sourceDefaults(), 'Sweep'),
      sweepBuffer = await assetRepository.decode(sweep),
      signal = sweepBuffer.getChannelData(0);
    const crosses = (from: number, to: number) => {
      let count = 0;
      for (let i = from * 48000 + 1; i < to * 48000; i++)
        if (signal[i - 1] <= 0 && signal[i] > 0) count++;
      return count;
    };
    const asset = await generateSource(
        {
          ...sourceDefaults(),
          kind: 'sawtooth',
          duration: 0.4,
          from: 220,
          to: 220,
          shape: 'steady',
        },
        'Macro source',
      ),
      project = newProject();
    project.export.normalize = false;
    project.export.tail = 0;
    const clip = makeClip(asset);
    project.tracks[0].clips = [clip];
    const original = new Uint8Array(await asset.blob.arrayBuffer()),
      base = (await renderProject(project, [asset])).buffer,
      changes = [];
    for (const macro of ['size', 'aggression', 'brightness', 'space']) {
      const modified = editClip(
        project,
        clip.id,
        macroPatch(clip, macro, macro === 'brightness' ? 0.2 : 0.8),
      );
      if (macro === 'space') modified.export.tail = 2.2;
      const rendered = (await renderProject(modified, [asset])).buffer;
      let difference = 0;
      for (let i = 0; i < Math.min(base.length, rendered.length); i++)
        difference += Math.abs(base.getChannelData(0)[i] - rendered.getChannelData(0)[i]);
      changes.push({ macro, difference, duration: rendered.duration });
    }
    const after = new Uint8Array(await asset.blob.arrayBuffer());
    return {
      harmonics,
      early: crosses(0.05, 0.15),
      late: crosses(0.45, 0.55),
      changes,
      originalUnchanged:
        original.length === after.length && original.every((n, i) => n === after[i]),
    };
  });
  expect(result.harmonics[0].second).toBeLessThan(0.01);
  expect(result.harmonics[0].third).toBeLessThan(0.01);
  expect(result.harmonics[1].second).toBeLessThan(0.02);
  expect(result.harmonics[1].third).toBeGreaterThan(0.25);
  expect(result.harmonics[2].second).toBeGreaterThan(0.4);
  expect(result.early).toBeGreaterThan(result.late * 2);
  for (const change of result.changes) expect(change.difference, change.macro).toBeGreaterThan(1);
  expect(result.changes.find((c) => c.macro === 'size')!.duration).toBeGreaterThan(0.4);
  expect(result.changes.find((c) => c.macro === 'space')!.duration).toBeGreaterThan(2.5);
  expect(result.originalUnchanged).toBe(true);
});

test('generator storage failure and closing a pending generation preserve the current project', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const path = '/src/storage/database.ts',
      { database } = await import(/* @vite-ignore */ path),
      original = database.saveAsset.bind(database);
    Object.assign(window, {
      restoreGeneratedSave: () => {
        database.saveAsset = original;
      },
    });
    database.saveAsset = async () => {
      throw new Error('Synthetic storage full');
    };
  });
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Synthetic storage full');
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Create and add sound', exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    (window as unknown as { restoreGeneratedSave: () => void }).restoreGeneratedSave(),
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => {
    const original = OfflineAudioContext.prototype.startRendering;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
      }),
      probe = { release, finished: false };
    Object.assign(window, { generationProbe: probe });
    OfflineAudioContext.prototype.startRendering = async function () {
      await held;
      const result = await original.call(this);
      probe.finished = true;
      OfflineAudioContext.prototype.startRendering = original;
      return result;
    };
  });
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Generating sound…', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { generationProbe: { release: () => void } }).generationProbe.release(),
  );
  await page.waitForFunction(
    () =>
      (window as unknown as { generationProbe: { finished: boolean } }).generationProbe.finished,
  );
  await expect(page.locator('.audio-clip')).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const path = '/src/storage/database.ts',
        { database } = await import(/* @vite-ignore */ path);
      return (await database.all('assets')).length;
    }),
  ).toBe(0);
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('undead recipe uses a real captured take, keeps its original, layers a texture, previews, and exports', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Recipes', exact: true }).click();
  await page.getByRole('button', { name: 'Start Create an Undead Gurgle', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Use selected voice clip', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Record a voice take', exact: true }).click();
  await page.getByRole('button', { name: 'Record take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop & keep take', exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Stop & keep take', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record take', exact: true })).toBeEnabled();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  const before = await page.evaluate(async () => {
    const dbPath = '/src/storage/database.ts',
      storePath = '/src/domain/store.ts',
      { database } = await import(/* @vite-ignore */ dbPath),
      { projectStore } = await import(/* @vite-ignore */ storePath),
      clip = projectStore
        .getSnapshot()
        .tracks.flatMap((t: { clips: { assetId: string }[] }) => t.clips)[0],
      asset = await database.get('assets', clip.assetId);
    return {
      id: asset.id,
      hash: [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', await asset.blob.arrayBuffer())),
      ].join(','),
    };
  });
  await page.getByRole('button', { name: 'Use selected voice clip', exact: true }).click();
  await page
    .getByRole('button', { name: 'Apply Creature voice to recipe clip', exact: true })
    .click();
  await expect(page.getByRole('slider', { name: 'Depth / speed', exact: true })).not.toHaveValue(
    '0',
  );
  await page.getByRole('button', { name: 'Add bubbling texture', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add a little space', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Listen, adjust, and export', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Preview recipe sound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pause playback', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Stop playback', exact: true }).click();
  await page.screenshot({ path: `.qa/recipe-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Export recipe WAV', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download WAV', exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.wav$/);
  const after = await page.evaluate(async (id) => {
    const path = '/src/storage/database.ts',
      { database } = await import(/* @vite-ignore */ path),
      asset = await database.get('assets', id);
    return [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', await asset.blob.arrayBuffer())),
    ].join(',');
  }, before.id);
  expect(after).toBe(before.hash);
});

test('fireball and UI recipes perform real undoable edits; macros and creative presets persist', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Recipes', exact: true }).click();
  await page.getByRole('button', { name: 'Start Build a Fireball', exact: true }).click();
  await page.getByRole('button', { name: 'Open Fireball for this recipe', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Select clip Impact crack', exact: true }).click();
  await page.getByRole('textbox', { name: 'Clip name', exact: true }).fill('Custom impact');
  await page.getByRole('button', { name: 'Shape the impact', exact: true }).click();
  await page.getByRole('button', { name: 'Add a little space', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Audition and export', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Finish recipe', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Creative presets & macros' }).click();
  await page.getByRole('combobox', { name: 'Creative preset', exact: true }).selectOption('magic');
  await page.getByRole('button', { name: 'Apply creative preset', exact: true }).click();
  await page.getByRole('button', { name: 'Reset character', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Depth / speed', exact: true })).toHaveValue('0');
  await expect(page.getByRole('slider', { name: 'Clean / dirty', exact: true })).toHaveValue('0');
  await page.getByRole('slider', { name: 'Aggression', exact: true }).fill('0.7');
  await expect(
    page.getByRole('checkbox', { name: 'Enable Even out loudness', exact: true }),
  ).toBeChecked();
  await page.getByRole('slider', { name: 'Character size', exact: true }).fill('0.8');
  await page.getByRole('slider', { name: 'Character brightness', exact: true }).fill('0.6');
  await page.getByRole('slider', { name: 'Room size', exact: true }).fill('0.4');
  await page.screenshot({ path: `.qa/macros-${test.info().project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: /Save project locally/ }).click();
  await expect(page.getByText('Project saved locally.', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Select clip Custom impact', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Creative presets & macros' }).click();
  await expect(page.getByRole('slider', { name: 'Aggression', exact: true })).toHaveValue('0.7');
  await page.getByRole('button', { name: 'Recipes', exact: true }).click();
  await page.getByRole('button', { name: 'Start Make UI Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Open UI Click for this recipe', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Brighten the tone', exact: true }).click();
  await page.getByRole('button', { name: 'Repeat the tone', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await expect(page.getByRole('button', { name: 'Export recipe WAV', exact: true })).toBeVisible();
});
