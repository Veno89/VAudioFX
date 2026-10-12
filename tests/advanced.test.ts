import { expect, it } from 'vitest';
import { shiftPitch } from '../src/audio/pitch';
import { automationAt, emptyAutomation } from '../src/domain/automation';
import {
  cleanCleanup,
  makeClip,
  newProject,
  splitClip,
  validateProject,
  type Asset,
} from '../src/domain/model';
import { processCleanup } from '../src/audio/cleanup';

it.each([-12, -7, 7, 12])(
  'shifts a stereo tone by %s semitones without changing length or balance',
  (semitones) => {
    const sr = 48000,
      frequency = 440;
    const left = Float32Array.from(
      { length: sr },
      (_, i) => Math.sin((i * 2 * Math.PI * frequency) / sr) * 0.4,
    );
    const right = Float32Array.from(left, (v) => v * 0.5),
      saved = left.slice();
    const result = shiftPitch([left, right], sr, semitones);
    expect(result[0]).toHaveLength(sr);
    expect(left).toEqual(saved);
    let crossings = 0,
      energy = 0,
      balanceError = 0;
    for (let i = sr * 0.2; i < sr * 0.8; i++) {
      if (result[0][i] >= 0 && result[0][i - 1] < 0) crossings++;
      energy += result[0][i] ** 2;
      balanceError = Math.max(balanceError, Math.abs(result[1][i] - result[0][i] * 0.5));
    }
    expect(crossings / 0.6).toBeCloseTo(frequency * 2 ** (semitones / 12), -1);
    expect(energy).toBeGreaterThan(1000);
    expect(balanceError).toBeLessThan(1e-6);
  },
);
it.each([0.01, 0.05, 0.12, 2])(
  'finishes short/long and silent pitch regions of %s seconds',
  (seconds) => {
    const input = new Float32Array(Math.round(44100 * seconds));
    expect(shiftPitch([input], 44100, -12)[0]).toEqual(input);
  },
);
it('removes DC offset from owned copies without attenuating an AC tone', () => {
  const data = Float32Array.from(
    { length: 48000 },
    (_, i) => 0.2 + 0.3 * Math.sin((i * 2 * Math.PI * 400) / 48000),
  );
  processCleanup([data], 48000, { ...cleanCleanup(), dcRemove: true });
  expect(data.reduce((sum, v) => sum + v, 0) / data.length).toBeCloseTo(0, 6);
  expect(Math.max(...data)).toBeCloseTo(0.3, 5);
});
it.each([false, true])('preserves automation through a split with reverse=%s', (reverse) => {
  const p = newProject(),
    c = makeClip({ id: 'a', name: 'A', duration: 2 } as Asset);
  c.reverse = reverse;
  c.rate = 0.5;
  c.automation.gain = [
    { time: 0, value: 0.1 },
    { time: 0.4, value: 1.5 },
    { time: 1, value: 0.7 },
  ];
  p.tracks[0].clips = [c];
  const [a, b] = splitClip(p, c.id, 1.2).tracks[0].clips;
  for (const t of [0, 0.1, 0.2, 0.3, 0.6, 0.9, 1]) {
    const actual =
      t <= 0.3
        ? automationAt(a.automation.gain, t / 0.3, 1)
        : automationAt(b.automation.gain, (t - 0.3) / 0.7, 1);
    expect(actual).toBeCloseTo(automationAt(c.automation.gain, t, 1), 10);
  }
});
it('migrates version 2 to neutral advanced settings and rejects corrupt automation/pitch/codecs', () => {
  const p = newProject(),
    c = makeClip({ id: 'a', name: 'A', duration: 1 } as Asset);
  p.tracks[0].clips = [c];
  const migrated = validateProject({ ...p, version: 2 });
  expect(migrated.version).toBe(3);
  expect(migrated.tracks[0].clips[0].automation).toEqual(emptyAutomation());
  expect(migrated.tracks[0].clips[0].pitchSemitones).toBe(0);
  for (const points of [
    [
      { time: 0, value: 1 },
      { time: 0, value: 2 },
    ],
    [{ time: NaN, value: 1 }],
    [{ time: 1, value: 3 }],
    Array.from({ length: 33 }, (_, i) => ({ time: i / 33, value: 1 })),
  ]) {
    expect(() =>
      validateProject({
        ...p,
        tracks: [
          { ...p.tracks[0], clips: [{ ...c, automation: { ...c.automation, gain: points } }] },
        ],
      }),
    ).toThrow();
  }
  expect(() => validateProject({ ...p, export: { ...p.export, format: 'aac' } })).toThrow('format');
  expect(() => shiftPitch([new Float32Array(48)], 48000, 13)).toThrow('octave');
});
it('suppresses 50/60 Hz hum and harmonics in source time while retaining higher tones', () => {
  for (const hz of [50, 60] as const) {
    const sr = 48000;
    const signal = Float32Array.from({ length: sr }, (_, i) =>
      [hz, hz * 2, hz * 3, 800].reduce(
        (sum, f) => sum + Math.sin((i * 2 * Math.PI * f) / sr) * 0.1,
        0,
      ),
    );
    const clean = signal.slice();
    processCleanup([clean], sr, { ...cleanCleanup(), humHz: hz });
    const amplitude = (data: Float32Array, f: number) => {
      let re = 0,
        im = 0;
      for (let i = sr * 0.5; i < sr; i++) {
        re += data[i] * Math.cos((i * 2 * Math.PI * f) / sr);
        im += data[i] * Math.sin((i * 2 * Math.PI * f) / sr);
      }
      return Math.hypot(re, im);
    };
    for (const f of [hz, hz * 2, hz * 3])
      expect(amplitude(clean, f) / amplitude(signal, f)).toBeLessThan(0.02);
    expect(amplitude(clean, 800) / amplitude(signal, 800)).toBeGreaterThan(0.99);
  }
});
it('splits a full automation lane without exceeding the point limit', () => {
  const p = newProject(),
    c = makeClip({ id: 'full', name: 'Full', duration: 1 } as Asset);
  c.automation.gain = Array.from({ length: 32 }, (_, i) => ({
    time: 0.1 + (i * 0.8) / 31,
    value: (i % 3) * 0.5,
  }));
  p.tracks[0].clips = [c];
  for (const split of [0.02, 0.12, 0.51, 0.88, 0.98]) {
    const next = splitClip(p, c.id, split);
    expect(() => validateProject(next)).not.toThrow();
    for (const region of next.tracks[0].clips)
      expect(region.automation.gain.length).toBeLessThanOrEqual(32);
  }
});
