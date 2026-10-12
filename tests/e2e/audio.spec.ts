import { test, expect } from '@playwright/test';

test('ordered effects, EQ, compression, cleanup, and explicit master limiting render real samples', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const graphPath = '/src/audio/graph.ts',
      modelPath = '/src/domain/model.ts',
      renderPath = '/src/audio/render.ts',
      assetsPath = '/src/audio/assets.ts';
    const { scheduleGraph } = await import(/* @vite-ignore */ graphPath),
      { newProject, makeClip, cleanEffects } = await import(/* @vite-ignore */ modelPath),
      { renderProject } = await import(/* @vite-ignore */ renderPath),
      { assetRepository } = await import(/* @vite-ignore */ assetsPath);
    const sr = 48000,
      factory = new OfflineAudioContext(2, sr, sr),
      signal = factory.createBuffer(1, sr, sr),
      noise = factory.createBuffer(2, sr, sr);
    for (let i = 0; i < sr; i++) {
      signal.getChannelData(0)[i] = Math.sin((i * 2 * Math.PI * 100) / sr) * 0.8;
      noise.getChannelData(0)[i] =
        Math.sin((i * 2 * Math.PI * 180) / sr) * (i >= sr * 0.2 && i < sr * 0.6 ? 0.4 : 0.001);
      noise.getChannelData(1)[i] = noise.getChannelData(0)[i] * 0.5;
    }
    const clip = {
      ...makeClip({ id: 'signal', name: 'Signal', duration: 1 }),
      gain: 1,
      pan: -1,
      fadeIn: 0,
      fadeOut: 0,
      effects: { ...cleanEffects(), enabled: false },
    };
    const render = async (patch: Record<string, unknown> = {}, source = signal) => {
      const ctx = new OfflineAudioContext(2, sr * 2, sr),
        p = newProject();
      p.tracks[0].clips = [{ ...clip, ...patch }];
      const graph = scheduleGraph(ctx, p, new Map([['signal', source]]), ctx.destination);
      try {
        return await ctx.startRendering();
      } finally {
        graph.stop();
      }
    };
    const rms = (buffer: AudioBuffer, start = 0.3, end = 0.5, channel = 0) => {
      let sum = 0;
      const data = buffer.getChannelData(channel),
        a = Math.round(start * sr),
        b = Math.round(end * sr);
      for (let i = a; i < b; i++) sum += data[i] ** 2;
      return Math.sqrt(sum / (b - a));
    };
    const dry = await render(),
      eqEffects = {
        ...cleanEffects(),
        highpass: 20,
        eq: { low: 9, mid: 0, high: 0 },
        bypassed: ['compressor', 'highpass', 'lowpass'],
      };
    const eq = await render({ effects: eqEffects }),
      eqBypass = await render({
        effects: { ...eqEffects, bypassed: [...eqEffects.bypassed, 'eq'] },
      });
    const compressor = await render({
      effects: {
        ...cleanEffects(),
        bypassed: ['highpass', 'lowpass'],
        compressor: { threshold: -30, ratio: 12, knee: 0, attackMs: 0, releaseMs: 50 },
      },
    });
    const noisy = await render({}, noise),
      gated = await render(
        {
          cleanup: {
            ...clip.cleanup,
            gateEnabled: true,
            thresholdDb: -35,
            attackMs: 2,
            releaseMs: 15,
          },
        },
        noise,
      ),
      normalized = await render({ cleanup: { ...clip.cleanup, normalize: true } }, signal);
    const bright = factory.createBuffer(1, sr, sr);
    for (let i = 0; i < sr; i++)
      bright.getChannelData(0)[i] =
        (Math.sin((i * 2 * Math.PI * 300) / sr) + Math.sin((i * 2 * Math.PI * 4000) / sr)) * 0.15;
    const shaped = { ...cleanEffects(), lowpass: 700, distortion: 0.7 },
      order = [...shaped.order];
    [order[1], order[3]] = [order[3], order[1]];
    const before = await render({ effects: shaped }, bright),
      after = await render({ effects: { ...shaped, order } }, bright);
    let difference = 0;
    for (let i = sr * 0.3; i < sr * 0.5; i++)
      difference += Math.abs(before.getChannelData(0)[i] - after.getChannelData(0)[i]);
    const p = newProject();
    p.export = { ...p.export, normalize: false, limiter: true, tail: 0 };
    p.tracks[0].gain = 2;
    p.tracks[0].clips = [{ ...clip, gain: 2 }];
    const originalDecode = assetRepository.decode;
    assetRepository.decode = async () => signal;
    let limited;
    try {
      limited = await renderProject(p, [{ id: 'signal' }]);
    } finally {
      assetRepository.decode = originalDecode;
    }
    const peak = (buffer: AudioBuffer) =>
      buffer.getChannelData(0).reduce((a, value) => Math.max(a, Math.abs(value)), 0);
    return {
      eqRatio: rms(eq) / rms(dry),
      bypassDifference: Math.abs(rms(eqBypass) - rms(dry)),
      compressorRatio: rms(compressor) / rms(dry),
      gateNoiseRatio: rms(gated, 0.8, 0.95) / rms(noisy, 0.8, 0.95),
      gateSignalRatio: rms(gated) / rms(noisy),
      normalizedPeak: peak(normalized),
      orderDifference: difference / (sr * 0.2),
      limitedPeak: peak(limited.buffer),
      rawPeak: limited.peak,
      limitedSamples: limited.limitedSamples,
      originalPeak: peak(signal),
      finite: [eq, compressor, gated, normalized, limited.buffer].every((b) =>
        b.getChannelData(0).every(Number.isFinite),
      ),
    };
  });
  expect(results.eqRatio).toBeGreaterThan(2);
  expect(results.bypassDifference).toBeLessThan(0.00001);
  expect(results.compressorRatio).toBeLessThan(0.75);
  expect(results.gateNoiseRatio).toBeLessThan(0.001);
  expect(results.gateSignalRatio).toBeGreaterThan(0.99);
  expect(results.normalizedPeak).toBeCloseTo(10 ** (-1 / 20), 4);
  expect(results.orderDifference).toBeGreaterThan(0.005);
  expect(results.limitedPeak).toBeCloseTo(10 ** (-1 / 20), 4);
  expect(results.rawPeak).toBeGreaterThan(1);
  expect(results.limitedSamples).toBeGreaterThan(1000);
  expect(results.originalPeak).toBeCloseTo(0.8, 4);
  expect(results.finite).toBe(true);
});

test('native audition loops wrap on the audio clock, preserve the buffer, pause, and reject invalid regions', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/audio/playback.ts',
      { PlaybackEngine } = await import(/* @vite-ignore */ path),
      engine = new PlaybackEngine();
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: 48000, sampleRate: 48000 });
    let ended = false;
    await engine.play(
      buffer,
      0,
      () => {
        ended = true;
      },
      { enabled: true, start: 0.2, end: 0.3 },
    );
    const source = engine.source,
      context = engine.context,
      began = context.currentTime;
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (context.currentTime - began > 0.23) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    const current = context.currentTime,
      actual = engine.position,
      expected = 0.2 + ((engine.offset + current - engine.began - 0.2) % 0.1);
    const paused = engine.pause(),
      stopped = !engine.playing;
    let rejected = false;
    try {
      await engine.play(buffer, 0, undefined, { enabled: true, start: 0.9, end: 1.2 });
    } catch {
      rejected = true;
    }
    await engine.dispose();
    return {
      actual,
      expected,
      paused,
      stopped,
      rejected,
      ended,
      loop: source.loop,
      start: source.loopStart,
      end: source.loopEnd,
      sameBuffer: source.buffer === buffer,
    };
  });
  expect(result.loop).toBe(true);
  expect(result.start).toBe(0.2);
  expect(result.end).toBe(0.3);
  expect(result.actual).toBeGreaterThanOrEqual(0.2);
  expect(result.actual).toBeLessThan(0.3);
  expect(result.actual).toBeCloseTo(result.expected, 3);
  expect(result.paused).toBeGreaterThanOrEqual(0.2);
  expect(result.paused).toBeLessThan(0.3);
  expect(result.stopped).toBe(true);
  expect(result.rejected).toBe(true);
  expect(result.ended).toBe(false);
  expect(result.sameBuffer).toBe(true);
});

test('real browser DSP: gain, panning, filters, fades, bypass, reverse, timing, silence, and tails', async ({
  page,
}) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const graphPath = '/src/audio/graph.ts',
      modelPath = '/src/domain/model.ts';
    const { scheduleGraph } = await import(/* @vite-ignore */ graphPath),
      { newProject, makeClip } = await import(/* @vite-ignore */ modelPath);
    const sr = 48000,
      generator = new OfflineAudioContext(1, sr, sr),
      signal = generator.createBuffer(1, sr, sr);
    for (let i = 0; i < sr; i++)
      signal.getChannelData(0)[i] = Math.sin((i * Math.PI * 2 * 8000) / sr) * 0.2;
    const asset = { id: 'signal', name: 'Signal', duration: 1 },
      clip = {
        ...makeClip(asset),
        gain: 1,
        fadeIn: 0,
        fadeOut: 0,
        effects: {
          ...makeClip(asset).effects,
          enabled: false,
          highpass: 20,
          lowpass: 20000,
          distortion: 0,
          reverb: 0,
          echo: 0,
        },
      };
    const render = async (patch: Record<string, unknown> = {}, source = signal) => {
      const context = new OfflineAudioContext(2, 3 * sr, sr),
        project = newProject();
      project.tracks[0].clips = [{ ...clip, ...patch }];
      const session = scheduleGraph(
        context,
        project,
        new Map([['signal', source]]),
        context.destination,
      );
      const buffer = await context.startRendering();
      session.stop();
      return buffer;
    };
    const rms = (buffer: AudioBuffer, channel = 0, start = 0.1, end = 0.8) => {
      const data = buffer.getChannelData(channel);
      let sum = 0;
      for (let i = Math.floor(start * sr); i < end * sr; i++) sum += data[i] ** 2;
      return Math.sqrt(sum / ((end - start) * sr));
    };
    const dry = await render(),
      quieter = await render({ gain: 0.5 }),
      left = await render({ pan: -1 }),
      faded = await render({ fadeIn: 0.3, fadeOut: 0.3 }),
      delayed = await render({ start: 0.4 }),
      slow = await render({ rate: 0.5 });
    const effects = { ...clip.effects, enabled: true, lowpass: 600 },
      filtered = await render({ effects }),
      bypass = await render({ effects: { ...effects, enabled: false } });
    const silent = generator.createBuffer(1, sr, sr),
      silence = await render(
        { effects: { ...effects, distortion: 0.8, reverb: 0.8, echo: 0.8 } },
        silent,
      );
    const tail = await render({
      effects: { ...clip.effects, enabled: true, reverb: 0.8, echo: 0.5 },
    });
    const ramp = generator.createBuffer(1, sr, sr);
    for (let i = 0; i < sr; i++) ramp.getChannelData(0)[i] = (i / sr) * 0.3;
    const reversed = await render({ reverse: true, trimStart: 0.2, trimEnd: 0.8 }, ramp);
    const sharedContext = new OfflineAudioContext(2, sr * 2, sr),
      sharedProject = newProject();
    sharedProject.tracks[0].clips = [
      { ...clip, id: 'reverse-a', reverse: true },
      { ...clip, id: 'reverse-b', reverse: true, start: 0.2 },
    ];
    const sharedSession = scheduleGraph(
      sharedContext,
      sharedProject,
      new Map([['signal', ramp]]),
      sharedContext.destination,
    );
    const sharesReverseBuffer = sharedSession.sources[0].buffer === sharedSession.sources[1].buffer;
    await sharedContext.startRendering();
    sharedSession.stop();
    return {
      gainRatio: rms(quieter) / rms(dry),
      leftRight: rms(left, 1),
      leftLevel: rms(left, 0),
      attenuation: rms(filtered) / rms(dry),
      bypassDifference: Math.abs(rms(dry) - rms(bypass)),
      fadeRatio: rms(faded, 0, 0, 0.1) / rms(dry, 0, 0.4, 0.5),
      silence: rms(silence),
      leading: rms(delayed, 0, 0, 0.35),
      delayedLevel: rms(delayed, 0, 0.5, 0.8),
      slowLevel: rms(slow, 0, 1.2, 1.8),
      tail: rms(tail, 0, 1.05, 1.4),
      reverseFirst: reversed.getChannelData(0)[0],
      reverseLast: reversed.getChannelData(0)[Math.floor(0.599 * sr)],
      sharesReverseBuffer,
      finite: [dry, tail, silence].every((b) => [...b.getChannelData(0)].every(Number.isFinite)),
    };
  });
  expect(results.gainRatio).toBeCloseTo(0.5, 2);
  expect(results.leftRight).toBeLessThan(0.0001);
  expect(results.leftLevel).toBeGreaterThan(0.1);
  expect(results.attenuation).toBeLessThan(0.02);
  expect(results.bypassDifference).toBeLessThan(0.00001);
  expect(results.fadeRatio).toBeLessThan(0.3);
  expect(results.silence).toBeLessThan(0.001);
  expect(results.leading).toBe(0);
  expect(results.delayedLevel).toBeGreaterThan(0.09);
  expect(results.slowLevel).toBeGreaterThan(0.09);
  expect(results.tail).toBeGreaterThan(0.001);
  expect(results.reverseFirst).toBeGreaterThan(results.reverseLast * 2);
  expect(results.sharesReverseBuffer).toBe(true);
  expect(results.finite).toBe(true);
});
test('preview plays the exact rendered export buffer and rapid actions keep only one source', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('h1').click();
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/playback.ts',
      wavPath = '/src/export/wav.ts';
    const { PlaybackEngine } = await import(/* @vite-ignore */ enginePath),
      { encodeWav } = await import(/* @vite-ignore */ wavPath);
    const context = new OfflineAudioContext(2, 48000, 48000),
      buffer = context.createBuffer(2, 48000, 48000);
    buffer.getChannelData(0).fill(0.1);
    buffer.getChannelData(1).fill(-0.1);
    const original = AudioContext.prototype.createBufferSource;
    let active = 0,
      max = 0,
      parity = true;
    AudioContext.prototype.createBufferSource = function () {
      const source = original.call(this),
        start = source.start.bind(source),
        stop = source.stop.bind(source);
      source.start = (...args: Parameters<typeof start>) => {
        parity &&= source.buffer === buffer;
        active++;
        max = Math.max(max, active);
        start(...args);
      };
      source.stop = (...args: Parameters<typeof stop>) => {
        active--;
        stop(...args);
      };
      return source;
    };
    const engine = new PlaybackEngine();
    await engine.play(buffer);
    await engine.play(buffer, 0.2);
    engine.pause();
    await Promise.all([engine.play(buffer), engine.play(buffer)]);
    engine.stop();
    await engine.dispose();
    AudioContext.prototype.createBufferSource = original;
    const decoded = await new AudioContext().decodeAudioData(await encodeWav(buffer).arrayBuffer());
    return {
      parity,
      max,
      active,
      channels: decoded.numberOfChannels,
      duration: decoded.duration,
      difference: Math.abs(decoded.getChannelData(0)[100] - buffer.getChannelData(0)[100]),
    };
  });
  expect(result.parity).toBe(true);
  expect(result.max).toBe(1);
  expect(result.active).toBe(0);
  expect(result.channels).toBe(2);
  expect(result.duration).toBeCloseTo(1, 2);
  expect(result.difference).toBeLessThan(0.0001);
});
test('every licensed library sample decodes to its declared audio duration', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const path = '/src/features/library.ts';
    const { builtinSamples } = await import(/* @vite-ignore */ path);
    const context = new AudioContext();
    const failures: string[] = [];
    for (const asset of builtinSamples) {
      try {
        const response = await fetch(asset.url);
        const audio = await context.decodeAudioData(await response.arrayBuffer());
        if (
          Math.abs(audio.duration - asset.duration) > 0.025 ||
          audio.numberOfChannels > 2 ||
          !audio.length
        )
          failures.push(asset.id);
      } catch {
        failures.push(asset.id);
      }
    }
    await context.close();
    return { count: builtinSamples.length, failures };
  });
  expect(results.count).toBeGreaterThanOrEqual(100);
  expect(results.failures).toEqual([]);
});
