import { describe, expect, it } from 'vitest';
import { noiseSamples, shapeSource, sourceDefaults, validateSource } from '../src/audio/synthesis';
import {
  creativePresets,
  insertSource,
  macroPatch,
  presetPatch,
  type Macro,
} from '../src/features/creative';
import {
  editClip,
  makeClip,
  makeTrack,
  newProject,
  validateProject,
  type Asset,
} from '../src/domain/model';

const asset: Asset = {
  id: 'voice',
  name: 'Original voice',
  kind: 'recording',
  category: 'Recordings',
  tags: [],
  duration: 1,
  size: 3,
  mime: 'audio/wav',
  originalFilename: 'voice.wav',
  blob: new Blob(['raw']),
};
function power(data: Float32Array, frequencies: number[]) {
  return (
    frequencies.reduce((total, hz) => {
      let real = 0,
        imaginary = 0;
      for (let i = 0; i < data.length; i++) {
        const phase = (2 * Math.PI * hz * i) / 48000;
        real += data[i] * Math.cos(phase);
        imaginary += data[i] * Math.sin(phase);
      }
      return total + real * real + imaginary * imaginary;
    }, 0) / frequencies.length
  );
}
describe('procedural source contracts and audio', () => {
  it('rejects nonfinite, oversized, unknown, or fractional variation requests before allocating', () => {
    for (const change of [
      { duration: 11 },
      { duration: 0 },
      { from: NaN },
      { to: 20000 },
      { seed: 1.5 },
      { pulse: 2 },
      { pulseHz: 0 },
    ])
      expect(() => validateSource({ ...sourceDefaults(), ...change })).toThrow();
    expect(() => validateSource({ ...sourceDefaults(), kind: 'unknown' as 'sine' })).toThrow();
    const spec = sourceDefaults();
    expect(validateSource(spec)).not.toBe(spec);
    expect(() => noiseSamples(480001, 1)).toThrow();
  });
  it('generates bounded, deterministic noise while variation changes the original signal', () => {
    const a = noiseSamples(4096, 42),
      b = noiseSamples(4096, 42),
      c = noiseSamples(4096, 43);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.every((n) => Number.isFinite(n) && Math.abs(n) <= 1)).toBe(true);
    expect(Math.abs(a.reduce((sum, n) => sum + n, 0) / a.length)).toBeLessThan(0.04);
  });
  it('pink noise has substantially more low-band power than high-band power while white remains broad', () => {
    const lo = Array.from({ length: 24 }, (_, i) => 250 + i * 30),
      hi = Array.from({ length: 24 }, (_, i) => 4000 + i * 150);
    const pink = noiseSamples(16384, 42, true),
      white = noiseSamples(16384, 42);
    expect(power(pink, lo) / power(pink, hi)).toBeGreaterThan(4);
    const whiteRatio = power(white, lo) / power(white, hi);
    expect(whiteRatio).toBeGreaterThan(0.3);
    expect(whiteRatio).toBeLessThan(3);
  });
  it('applies genuine decay, pulsing, soft edges, and finite peak bounds without changing the source', () => {
    const data = noiseSamples(48000, 42),
      copy = data.slice(),
      spec = { ...sourceDefaults(), kind: 'white' as const, duration: 1 };
    const hit = shapeSource(data, spec),
      steady = shapeSource(data, { ...spec, shape: 'steady' }),
      pulse = shapeSource(data, { ...spec, shape: 'steady', pulse: 1, pulseHz: 10 });
    expect(Math.abs(hit[0])).toBe(0);
    expect(Math.abs(hit.at(-1)!)).toBe(0);
    expect(hit.every((n) => Number.isFinite(n) && Math.abs(n) <= 0.450001)).toBe(true);
    const energy = (x: Float32Array, start: number, end: number) =>
      x.subarray(start, end).reduce((sum, n) => sum + n * n, 0);
    expect(energy(hit, 5000, 15000)).toBeGreaterThan(energy(hit, 33000, 43000) * 20);
    expect(energy(pulse, 0, 48000)).toBeLessThan(energy(steady, 0, 48000) * 0.5);
    expect(data).toEqual(copy);
    expect(() => shapeSource(new Float32Array(3), spec)).toThrow('silence');
    expect(() => shapeSource(new Float32Array([0, NaN]), spec)).toThrow('invalid');
  });
});
describe('creative editing preserves sources and bounded projects', () => {
  it.each(creativePresets)(
    '$name yields a valid detached chain and preserves source edits',
    ({ id }) => {
      const project = newProject();
      const clip = {
        ...makeClip(asset),
        trimStart: 0.2,
        cleanup: { ...makeClip(asset).cleanup, gateEnabled: true },
      };
      project.tracks[0].clips = [clip];
      const next = validateProject(editClip(project, clip.id, presetPatch(id))),
        edited = next.tracks[0].clips[0];
      expect(edited.assetId).toBe(clip.assetId);
      expect(edited.trimStart).toBe(0.2);
      expect(edited.cleanup).toEqual(clip.cleanup);
      expect(edited.name).toBe(clip.name);
      expect(edited.effects).not.toBe(clip.effects);
      expect(clip.rate).toBe(1);
      expect(asset.blob?.size).toBe(3);
    },
  );
  it('macros activate their real processors while preserving order and unrelated settings', () => {
    const clip = makeClip(asset);
    clip.effects.enabled = false;
    clip.effects.order.reverse();
    clip.effects.bypassed = [...clip.effects.order];
    for (const macro of ['size', 'aggression', 'brightness', 'space'] as Macro[]) {
      const patch = macroPatch(clip, macro, 0.8),
        effects = patch.effects!;
      expect(effects.enabled).toBe(true);
      expect(effects.order).toEqual(clip.effects.order);
      expect(effects.bypassed).toContain('highpass');
      expect(effects).not.toBe(clip.effects);
      const project = newProject();
      project.tracks[0].clips = [{ ...clip, ...patch }];
      expect(() => validateProject(project)).not.toThrow();
    }
    expect(macroPatch(clip, 'size', 0.8).rate).toBeLessThan(1);
    expect(macroPatch(clip, 'aggression', 0.8).effects?.bypassed).not.toContain('compressor');
    expect(() => macroPatch(clip, 'space', NaN)).toThrow();
    expect(clip.effects.enabled).toBe(false);
    expect(clip.effects.reverb).toBe(0);
  });
  it('inserts on a selected or new layer with strict track, clip, and duration limits', () => {
    const p = newProject(),
      originalCount = p.tracks.length;
    const selected = insertSource(p, asset, 2, p.tracks[0].id),
      separate = insertSource(p, asset, 2);
    expect(selected.project.tracks).toHaveLength(originalCount);
    expect(separate.project.tracks).toHaveLength(originalCount + 1);
    expect(p.tracks[0].clips).toHaveLength(0);
    expect(selected.clip.start).toBe(2);
    expect(() => insertSource(p, asset, 119.5)).toThrow('120-second');
    const fullTracks = { ...p, tracks: Array.from({ length: 16 }, (_, i) => makeTrack(i)) };
    expect(() => insertSource(fullTracks, asset, 0)).toThrow('16 layers');
    expect(insertSource(fullTracks, asset, 0, fullTracks.tracks[0].id).project.tracks).toHaveLength(
      16,
    );
    p.tracks[0].clips = Array.from({ length: 128 }, () => makeClip(asset));
    expect(() => insertSource(p, asset, 0)).toThrow('128 clips');
  });
});
