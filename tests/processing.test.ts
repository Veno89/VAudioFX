import { describe, expect, it } from 'vitest';
import {
  cleanCleanup,
  cleanEffects,
  makeClip,
  newProject,
  repeatClip,
  snapClipTime,
  validateProject,
  type Asset,
} from '../src/domain/model';
import { findSignalRegion, limitPeaks, PEAK_CEILING, processCleanup } from '../src/audio/cleanup';
import { validatePresets } from '../src/storage/presets';

const asset = { id: 'source', name: 'Sound', duration: 1 } as Asset;
function fixture() {
  const p = newProject();
  p.tracks[0].clips = [makeClip(asset)];
  return p;
}

describe('version 2 editing contracts', () => {
  it('migrates actual version 1 settings without adding audible processing', () => {
    const p = fixture(),
      c = p.tracks[0].clips[0];
    const {
      order: _order,
      bypassed: _bypassed,
      eq: _eq,
      compressor: _compressor,
      ...oldEffects
    } = c.effects;
    const { cleanup: _cleanup, ...oldClip } = c;
    const { limiter: _limiter, ...oldExport } = p.export;
    const { loop: _loop, ...oldProject } = p;
    const migrated = validateProject({
      ...oldProject,
      version: 1,
      export: oldExport,
      tracks: [
        { ...p.tracks[0], clips: [{ ...oldClip, effects: { ...oldEffects, distortion: 0.3 } }] },
      ],
    });
    expect(migrated.version).toBe(3);
    expect(migrated.loop.enabled).toBe(false);
    expect(migrated.export.limiter).toBe(false);
    expect(migrated.tracks[0].clips[0].effects).toEqual({ ...cleanEffects(), distortion: 0.3 });
    expect(migrated.tracks[0].clips[0].cleanup).toEqual(cleanCleanup());
  });
  it('rejects incomplete, duplicate or unknown chain entries and unsafe cleanup/loop values', () => {
    const p = fixture(),
      c = p.tracks[0].clips[0];
    for (const order of [
      [],
      [...c.effects.order, 'echo'],
      [...c.effects.order.slice(1), 'unknown'],
    ]) {
      expect(() =>
        validateProject({
          ...p,
          tracks: [{ ...p.tracks[0], clips: [{ ...c, effects: { ...c.effects, order } }] }],
        }),
      ).toThrow();
    }
    for (const patch of [{ thresholdDb: NaN }, { attackMs: 0 }, { releaseMs: 2000 }]) {
      expect(() =>
        validateProject({
          ...p,
          tracks: [{ ...p.tracks[0], clips: [{ ...c, cleanup: { ...c.cleanup, ...patch } }] }],
        }),
      ).toThrow();
    }
    expect(() => validateProject({ ...p, loop: { enabled: true, start: 2, end: 1 } })).toThrow(
      'Loop',
    );
    expect(() => validateProject({ ...p, export: { ...p.export, limiter: 'yes' } })).toThrow();
  });
  it('repeats independent clips as one bounded edit and keeps the original unchanged', () => {
    const p = fixture(),
      c = p.tracks[0].clips[0],
      repeated = repeatClip(p, c.id, 4);
    expect(repeated.tracks[0].clips.map((c) => c.start)).toEqual([0, 1, 2, 3]);
    expect(new Set(repeated.tracks[0].clips.map((c) => c.id)).size).toBe(4);
    expect(p.tracks[0].clips).toHaveLength(1);
    c.start = 118;
    expect(() => repeatClip(p, c.id, 4)).toThrow('120');
    expect(() => repeatClip(p, c.id, 2.5)).toThrow('2–16');
  });
  it('snaps either moving edge to boundaries and playhead, with grid fallback and bypass', () => {
    const p = fixture();
    p.zoom = 200;
    p.tracks[1].clips = [{ ...makeClip(asset), start: 2.133 }];
    expect(snapClipTime(p, p.tracks[0].clips[0].id, 2.12, 4)).toBe(2.133);
    expect(snapClipTime(p, p.tracks[0].clips[0].id, 2.133, 4)).toBe(2.133);
    expect(snapClipTime(p, p.tracks[0].clips[0].id, 1.12, 4, 1)).toBeCloseTo(1.133);
    expect(snapClipTime(p, p.tracks[0].clips[0].id, 4.02, 4)).toBe(4);
    expect(snapClipTime(p, p.tracks[0].clips[0].id, 5.124, 4)).toBe(5.1);
    p.snap = false;
    expect(snapClipTime(p, p.tracks[0].clips[0].id, 2.12, 4)).toBe(2.12);
  });
});
describe('non-destructive cleanup', () => {
  it('gates linked stereo noise between phrases while preserving balance and signal', () => {
    const sr = 1000,
      left = Float32Array.from({ length: sr }, (_, i) => (i >= 200 && i < 600 ? 0.5 : 0.001)),
      right = Float32Array.from(left, (n) => n * 0.5);
    processCleanup([left, right], sr, { ...cleanCleanup(), gateEnabled: true, releaseMs: 10 });
    expect(left[100]).toBeLessThan(0.00001);
    expect(left[400]).toBeGreaterThan(0.49);
    expect(right[400] / left[400]).toBeCloseTo(0.5);
    expect(left[950]).toBeLessThan(0.00001);
    expect([...left].every(Number.isFinite)).toBe(true);
  });
  it('normalizes shared channel peaks with bounded amplification and handles silence', () => {
    const channels = [Float32Array.from([0.1, -0.2]), Float32Array.from([0.4, -0.1])];
    processCleanup(channels, 48000, { ...cleanCleanup(), normalize: true });
    expect(channels[1][0]).toBeCloseTo(PEAK_CEILING);
    expect(channels[0][0] / channels[1][0]).toBeCloseTo(0.25);
    const quiet = Float32Array.from([0.0001, 0]);
    processCleanup([quiet], 48000, { ...cleanCleanup(), normalize: true });
    expect(quiet[0]).toBeCloseTo(0.001);
    expect(quiet[1]).toBe(0);
  });
  it('finds quiet edges across either channel with padding inside the current trim', () => {
    const silent = new Float32Array(1000),
      right = silent.slice();
    right.fill(0.3, 300, 600);
    expect(findSignalRegion([silent, right], 1000, 0.2, 0.8, -40)).toEqual({
      trimStart: 0.29,
      trimEnd: 0.61,
    });
    expect(findSignalRegion([silent, right], 1000, 0.35, 0.5, -40)).toEqual({
      trimStart: 0.35,
      trimEnd: 0.5,
    });
    expect(() => findSignalRegion([silent], 1000, 0, 1, -40)).toThrow('No sound');
    expect(right[300]).toBeCloseTo(0.3);
  });
  it('reports actual limited samples and preserves samples below the ceiling', () => {
    const data = Float32Array.from([-2, -0.5, 0, 0.5, 2]);
    expect(limitPeaks([data])).toBe(2);
    expect(data[0]).toBeCloseTo(-PEAK_CEILING);
    expect(data[4]).toBeCloseTo(PEAK_CEILING);
    expect([...data.slice(1, 4)]).toEqual([-0.5, 0, 0.5]);
  });
});
it('validates local presets and detaches loaded settings from mutable input', () => {
  const original = { id: 'preset', name: ' My sound ', effects: cleanEffects() },
    saved = validatePresets([original]);
  expect(saved[0].name).toBe('My sound');
  saved[0].effects.order.reverse();
  saved[0].effects.eq.low = 10;
  expect(original.effects.eq.low).toBe(0);
  expect(original.effects.order[0]).toBe('highpass');
  expect(() => validatePresets([original, original])).toThrow();
  expect(() =>
    validatePresets([
      { ...original, effects: { ...original.effects, eq: { low: 13, mid: 0, high: 0 } } },
    ]),
  ).toThrow();
});
