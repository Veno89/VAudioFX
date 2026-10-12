import { test, expect } from '@playwright/test';

test('compressed source metadata remains playable through region preparation and rejects unavailable trims', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const libraryPath = '/src/features/library.ts',
      modelPath = '/src/domain/model.ts',
      renderPath = '/src/audio/render.ts',
      assetPath = '/src/audio/assets.ts';
    const { builtinSamples } = await import(/* @vite-ignore */ libraryPath),
      { newProject, makeClip } = await import(/* @vite-ignore */ modelPath),
      { renderProject } = await import(/* @vite-ignore */ renderPath),
      { assetRepository } = await import(/* @vite-ignore */ assetPath);
    const asset = builtinSamples.find(
        (a: { id: string }) => a.id === 'kenney-impact-footstep_carpet_000',
      ),
      decoded: AudioBuffer = await assetRepository.decode(asset),
      project = newProject(),
      original = decoded.getChannelData(0).slice();
    project.export = { ...project.export, tail: 0, normalize: false };
    const renders = [];
    for (const patch of [{}, { reverse: true }, { pitchSemitones: 7 }]) {
      project.tracks[0].clips = [{ ...makeClip(asset), fadeIn: 0, fadeOut: 0, ...patch }];
      const { buffer }: { buffer: AudioBuffer } = await renderProject(project, [asset]);
      renders.push({
        length: buffer.length,
        energy: buffer.getChannelData(0).reduce((sum, sample) => sum + sample ** 2, 0),
      });
    }
    const errors = [];
    for (const patch of [
      { trimEnd: Math.max(asset.duration, decoded.duration) + 0.1 },
      { trimStart: decoded.duration + 0.01, trimEnd: decoded.duration + 0.02 },
    ]) {
      project.tracks[0].clips = [{ ...makeClip(asset), ...patch }];
      try {
        await renderProject(project, [asset]);
        errors.push('unexpected success');
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    return {
      declared: asset.duration,
      decoded: decoded.duration,
      expectedFrames: Math.ceil(asset.duration * project.export.sampleRate),
      renders,
      errors,
      unchanged: decoded.getChannelData(0).every((sample, i) => sample === original[i]),
    };
  });
  console.log('Compressed source duration', browserName, result.declared, result.decoded);
  for (const rendered of result.renders) {
    expect(rendered.length).toBe(result.expectedFrames);
    expect(rendered.energy).toBeGreaterThan(0.001);
  }
  for (const error of result.errors) expect(error).toContain('Source trim exceeds available audio');
  expect(result.unchanged).toBe(true);
});

test('independent pitch, automation and hum/DC cleanup change real samples while preserving originals', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/domain/model.ts',
      renderPath = '/src/audio/render.ts',
      assetPath = '/src/audio/assets.ts';
    const { newProject, makeClip, cleanEffects, cleanCleanup } = await import(
      /* @vite-ignore */ modelPath
    );
    const { renderProject } = await import(/* @vite-ignore */ renderPath);
    const { assetRepository } = await import(/* @vite-ignore */ assetPath);
    const sr = 48000,
      ctx = new OfflineAudioContext(2, sr, sr),
      tone = ctx.createBuffer(1, sr, sr);
    for (let i = 0; i < sr; i++)
      tone.getChannelData(0)[i] = Math.sin((i * 2 * Math.PI * 440) / sr) * 0.4;
    const original = tone.getChannelData(0).slice(),
      originalDecode = assetRepository.decode;
    const asset = { id: 'test', name: 'Test', duration: 1 };
    const p = newProject();
    p.export = { ...p.export, tail: 0, normalize: false };
    const c = {
      ...makeClip(asset),
      gain: 1,
      fadeIn: 0,
      fadeOut: 0,
      effects: { ...cleanEffects(), enabled: false },
    };
    const run = async (patch = {}, source = tone): Promise<AudioBuffer> => {
      assetRepository.decode = async () => source;
      p.tracks[0].clips = [{ ...c, ...patch }];
      return (await renderProject(p, [asset])).buffer;
    };
    const rms = (b: AudioBuffer, a: number, z: number, channel = 0) => {
      let sum = 0;
      const d = b.getChannelData(channel);
      for (let i = Math.round(a * sr); i < Math.round(z * sr); i++) sum += d[i] ** 2;
      return Math.sqrt(sum / Math.round((z - a) * sr));
    };
    const amplitude = (b: AudioBuffer, hz: number) => {
      let re = 0,
        im = 0;
      const d = b.getChannelData(0);
      for (let i = sr * 0.3; i < sr * 0.8; i++) {
        re += d[i] * Math.cos((i * 2 * Math.PI * hz) / sr);
        im += d[i] * Math.sin((i * 2 * Math.PI * hz) / sr);
      }
      return (Math.hypot(re, im) * 2) / (sr * 0.5);
    };
    try {
      const pitched = [];
      for (const pitchSemitones of [-12, 7, 12]) {
        const b = await run({ pitchSemitones }),
          d = b.getChannelData(0);
        let crossings = 0;
        for (let i = sr * 0.2; i < sr * 0.8; i++) if (d[i] >= 0 && d[i - 1] < 0) crossings++;
        pitched.push({ semitones: pitchSemitones, frequency: crossings / 0.6, length: b.length });
      }
      const gain = await run({
        automation: {
          ...c.automation,
          gain: [
            { time: 0, value: 0 },
            { time: 1, value: 1 },
          ],
        },
      });
      const pan = await run({
        automation: {
          ...c.automation,
          pan: [
            { time: 0, value: -1 },
            { time: 1, value: 1 },
          ],
        },
      });
      const bright = ctx.createBuffer(1, sr, sr),
        hum = ctx.createBuffer(1, sr, sr);
      for (let i = 0; i < sr; i++) {
        bright.getChannelData(0)[i] = Math.sin((i * 2 * Math.PI * 4000) / sr) * 0.4;
        hum.getChannelData(0)[i] =
          0.15 +
          [50, 100, 150, 800].reduce(
            (sum, hz) => sum + Math.sin((i * 2 * Math.PI * hz) / sr) * 0.1,
            0,
          );
      }
      const filter = await run(
        {
          effects: cleanEffects(),
          automation: {
            ...c.automation,
            lowpass: [
              { time: 0, value: 10000 },
              { time: 1, value: 300 },
            ],
          },
        },
        bright,
      );
      const dirty = await run({}, hum),
        clean = await run({ cleanup: { ...cleanCleanup(), dcRemove: true, humHz: 50 } }, hum);
      return {
        pitched,
        gainRatio: rms(gain, 0.75, 0.85) / rms(gain, 0.15, 0.25),
        panLeft: rms(pan, 0.01, 0.06, 0) / rms(pan, 0.01, 0.06, 1),
        panRight: rms(pan, 0.94, 0.99, 1) / rms(pan, 0.94, 0.99, 0),
        filterRatio: rms(filter, 0.9, 0.95) / rms(filter, 0.05, 0.1),
        humRatios: [50, 100, 150].map((hz) => amplitude(clean, hz) / amplitude(dirty, hz)),
        retained: amplitude(clean, 800) / amplitude(dirty, 800),
        dc:
          clean
            .getChannelData(0)
            .slice(sr * 0.3, sr * 0.8)
            .reduce((sum, v) => sum + v, 0) /
          (sr * 0.5),
        unchanged: tone.getChannelData(0).every((v, i) => v === original[i]),
      };
    } finally {
      assetRepository.decode = originalDecode;
    }
  });
  for (const p of result.pitched) {
    expect(p.length).toBe(48000);
    expect(p.frequency).toBeCloseTo(440 * 2 ** (p.semitones / 12), -1);
  }
  expect(result.gainRatio).toBeGreaterThan(3.5);
  expect(result.panLeft).toBeGreaterThan(10);
  expect(result.panRight).toBeGreaterThan(10);
  expect(result.filterRatio).toBeLessThan(0.15);
  for (const ratio of result.humRatios) expect(ratio).toBeLessThan(0.05);
  expect(result.retained).toBeGreaterThan(0.95);
  expect(Math.abs(result.dc)).toBeLessThan(0.001);
  expect(result.unchanged).toBe(true);
});

test('worker codecs encode actual WAV/OGG/MP3 at both rates/channel counts and support cancellation', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const audioPath = '/src/export/audio.ts',
      wavPath = '/src/export/wav.ts';
    const { encodeAudio } = await import(/* @vite-ignore */ audioPath);
    const { encodeWav } = await import(/* @vite-ignore */ wavPath);
    const context = new AudioContext(),
      results = [];
    try {
      for (const sr of [44100, 48000])
        for (const channels of [1, 2]) {
          const b = context.createBuffer(channels, sr / 2, sr);
          for (let c = 0; c < channels; c++)
            for (let i = 0; i < b.length; i++)
              b.getChannelData(c)[i] = Math.sin((i * 2 * Math.PI * 440) / sr) * (c ? 0.2 : 0.4);
          for (const format of ['wav', 'ogg', 'mp3'] as const) {
            const blob = await encodeAudio(b, format),
              bytes = new Uint8Array(await blob.arrayBuffer());
            const decoded = await context.decodeAudioData(bytes.buffer.slice(0));
            const energy = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
              decoded.getChannelData(c).reduce((sum, v) => sum + v ** 2, 0),
            );
            const data = new DataView(bytes.buffer);
            let oggFrames = 0;
            if (format === 'ogg')
              for (let offset = 0; offset + 27 < bytes.length;) {
                const count = bytes[offset + 26];
                oggFrames = Number(data.getBigUint64(offset + 6, true));
                let size = 0;
                for (let j = 0; j < count; j++) size += bytes[offset + 27 + j];
                offset += 27 + count + size;
              }
            const expected =
              format === 'wav' ? new Uint8Array(await encodeWav(b).arrayBuffer()) : undefined;
            results.push({
              format,
              sr,
              channels,
              oggFrames,
              mime: blob.type,
              header: new TextDecoder().decode(bytes.slice(0, 4)),
              mp3Sync: bytes[0] === 255 && (bytes[1] & 224) === 224,
              size: blob.size,
              duration: decoded.duration,
              decodedChannels: decoded.numberOfChannels,
              energy: energy[0],
              balance: energy.length > 1 ? energy[1] / energy[0] : 1,
              wavRate: format === 'wav' ? data.getUint32(24, true) : 0,
              identical: expected ? bytes.every((v, i) => v === expected[i]) : true,
            });
          }
        }
      const b = context.createBuffer(2, 48000 * 120, 48000),
        controller = new AbortController();
      const canceled = encodeAudio(b, 'ogg', controller.signal);
      controller.abort();
      let aborted = false;
      try {
        await canceled;
      } catch (e) {
        aborted = e instanceof DOMException && e.name === 'AbortError';
      }
      const recovered = await encodeAudio(context.createBuffer(1, 4800, 48000), 'ogg');
      return { results, aborted, recovered: recovered.size > 0 };
    } finally {
      await context.close();
    }
  });
  for (const r of results.results) {
    expect(r.mime).toBe(
      r.format === 'wav' ? 'audio/wav' : r.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg',
    );
    if (r.format === 'wav') {
      expect(r.header).toBe('RIFF');
      expect(r.wavRate).toBe(r.sr);
    }
    if (r.format === 'ogg') {
      expect(r.header).toBe('OggS');
      expect(r.oggFrames).toBe(r.sr / 2);
    }
    if (r.format === 'mp3') expect(r.mp3Sync || r.header.startsWith('ID3')).toBe(true);
    // Vorbis granule positions above verify exact encoded frame counts. Chromium's
    // decoder includes a small priming block; the lossy playback buffer can be longer.
    expect(Math.abs(r.duration - 0.5), JSON.stringify(r)).toBeLessThan(
      r.format === 'mp3' ? 0.08 : r.format === 'ogg' ? 0.004 : 0.002,
    );
    expect(r.decodedChannels).toBe(r.channels);
    expect(r.energy).toBeGreaterThan(100);
    expect(r.identical).toBe(true);
    if (r.channels === 2) expect(r.balance).toBeCloseTo(0.25, 1);
  }
  expect(results.aborted).toBe(true);
  expect(results.recovered).toBe(true);
});

test('advanced controls persist, undo, navigate precisely, and export compressed portable settings', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Generate sound', exact: true }).click();
  await page.getByLabel('Generator duration (s)').fill('1');
  await page.getByRole('button', { name: 'Create and add sound', exact: true }).click();
  await expect(page.locator('.audio-clip')).toHaveCount(1);
  await page.getByRole('slider', { name: /^Independent pitch/ }).fill('7');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await expect(page.getByRole('slider', { name: /^Independent pitch/ })).toHaveValue('0');
  await page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)', exact: true }).click();
  await expect(page.getByRole('slider', { name: /^Independent pitch/ })).toHaveValue('7');
  await page.getByText('Waveform navigation', { exact: true }).click();
  await page.getByRole('button', { name: 'Zoom source waveform in' }).click();
  await page.getByLabel('Seek within clip (s)').fill('0.5');
  await page.getByText('Parameter automation', { exact: true }).click();
  await page.getByRole('button', { name: 'Add point at playhead' }).click();
  await page.getByLabel('Point 1 value', { exact: true }).fill('0.4');
  await page.getByLabel('Remove DC offset').check();
  await page.getByLabel('Hum removal').selectOption('60');
  await page.getByRole('button', { name: 'Save project locally (Ctrl+S)', exact: true }).click();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('.audio-clip').first().click();
  await expect(page.getByRole('slider', { name: /^Independent pitch/ })).toHaveValue('7');
  await expect(page.getByLabel('Hum removal')).toHaveValue('60');
  await page.getByText('Parameter automation', { exact: true }).click();
  await expect(page.getByLabel('Point 1 position (%)', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Point 1 value', { exact: true })).toHaveValue('0.4');
  const portable = await page.evaluate(async () => {
    const storePath = '/src/domain/store.ts',
      dbPath = '/src/storage/database.ts',
      packagePath = '/src/export/project-package.ts';
    const { projectStore } = await import(/* @vite-ignore */ storePath),
      { database } = await import(/* @vite-ignore */ dbPath),
      { exportPackage, importPackage } = await import(/* @vite-ignore */ packagePath);
    const saved = projectStore.getSnapshot(),
      sources = await database.all('assets');
    const restored = await importPackage(await exportPackage(saved, sources));
    const clip = restored.project.tracks.flatMap((t: { clips: unknown[] }) => t.clips)[0];
    return { version: restored.project.version, clip, originals: restored.assets.length };
  });
  expect(portable.version).toBe(3);
  expect(portable.clip).toMatchObject({
    pitchSemitones: 7,
    cleanup: { dcRemove: true, humHz: 60 },
    automation: { gain: [{ time: 0.5, value: 0.4 }] },
  });
  expect(portable.originals).toBe(1);
  await page.getByText('Waveform navigation', { exact: true }).click();
  await page.getByLabel('Seek within clip (s)').fill('0.75');
  await page.getByRole('button', { name: 'Seek within source waveform' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Seek within clip (s)')).toHaveValue('0.74');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.locator('.inspector').screenshot({ path: `.qa/advanced-${browserName}.png` });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: 'Export WAV', exact: true }).click();
  await page.getByLabel('Export format').selectOption('ogg');
  await expect(page.locator('.export-summary')).toContainText('Ogg Vorbis');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download OGG', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.ogg$/);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('longer stereo renders share prepared regions, report allocations, and keep the UI event loop responsive', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const modelPath = '/src/domain/model.ts',
      assetPath = '/src/audio/assets.ts',
      renderPath = '/src/audio/render.ts';
    const { newProject, makeClip, uid } = await import(/* @vite-ignore */ modelPath),
      { assetRepository } = await import(/* @vite-ignore */ assetPath),
      { renderProject } = await import(/* @vite-ignore */ renderPath);
    const sr = 48000,
      length = sr * 30,
      factory = new OfflineAudioContext(2, length, sr),
      source = factory.createBuffer(2, length, sr);
    for (let c = 0; c < 2; c++)
      for (let i = 0; i < length; i++)
        source.getChannelData(c)[i] = Math.sin((i * 2 * Math.PI * 440) / sr) * (c ? 0.1 : 0.2);
    const asset = { id: 'long', name: 'Long', duration: 30 },
      p = newProject();
    p.export = { ...p.export, tail: 0 };
    const clip = {
      ...makeClip(asset),
      pitchSemitones: -7,
      cleanup: { ...makeClip(asset).cleanup, dcRemove: true },
    };
    p.tracks[0].clips = [clip, { ...clip, id: uid(), start: 30 }];
    const originalDecode = assetRepository.decode;
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
    const started = performance.now();
    try {
      const rendered = await renderProject(p, [asset]);
      return {
        memory: rendered.memory,
        duration: rendered.buffer.duration,
        elapsedMs: performance.now() - started,
        ticks,
        longestGap,
        unchanged:
          source.getChannelData(0)[1000] ===
          Math.fround(Math.sin((1000 * 2 * Math.PI * 440) / sr) * 0.2),
      };
    } finally {
      clearInterval(timer);
      assetRepository.decode = originalDecode;
    }
  });
  expect(result.memory).toEqual({
    decodedBytes: 30 * 48000 * 2 * 4,
    preparedBytes: 30 * 48000 * 2 * 4,
    renderedBytes: 60 * 48000 * 2 * 4,
  });
  expect(result.duration).toBe(60);
  expect(result.unchanged).toBe(true);
  expect(result.ticks).toBeGreaterThan(5);
  expect(result.longestGap).toBeLessThan(1000);
  console.log(
    `60s stereo render: ${Math.round(result.elapsedMs)}ms; largest UI timer gap ${Math.round(result.longestGap)}ms; buffers ${Object.values(result.memory).reduce((sum: number, bytes) => sum + Number(bytes), 0)} bytes.`,
  );
});
