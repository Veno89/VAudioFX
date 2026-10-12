import { describe, expect, it } from 'vitest';
import {
  cleanEffects,
  clipDuration,
  editClip,
  makeClip,
  newProject,
  snapTime,
  splitClip,
  audibleTracks,
  validateProject,
  type Asset,
} from '../src/domain/model';
import { ProjectHistory } from '../src/domain/history';
import { envelopeAt, distortionCurve } from '../src/audio/graph';
import { encodeWav, safeFilename } from '../src/export/wav';
import { importPackage, exportPackage } from '../src/export/package-core';
import { unzipSync, zipSync } from 'fflate';

const asset: Asset = {
  id: 'source',
  name: 'Voice',
  kind: 'recording',
  category: 'Recordings',
  tags: [],
  duration: 2,
  size: 4,
  mime: 'audio/wav',
  originalFilename: 'voice.wav',
  blob: new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' }),
};
function fixture() {
  const p = newProject();
  p.tracks[0].clips = [makeClip(asset, 0.5)];
  return p;
}
describe('project edits and validation', () => {
  it('computes rate-adjusted durations and bounded snapping', () => {
    const c = makeClip(asset);
    c.rate = 0.5;
    c.trimStart = 0.5;
    expect(clipDuration(c)).toBe(3);
    expect(snapTime(-1, true)).toBe(0);
    expect(snapTime(1.123, true)).toBe(1.1);
  });
  it('moves and trims without modifying original source', () => {
    const p = fixture(),
      c = p.tracks[0].clips[0];
    const result = editClip(p, c.id, { start: 1, trimStart: 0.2 });
    expect(result.tracks[0].clips[0].start).toBe(1);
    expect(c.trimStart).toBe(0);
    expect(asset.duration).toBe(2);
  });
  it.each([false, true])('splits correctly with reverse=%s', (reverse) => {
    const p = fixture(),
      c = p.tracks[0].clips[0];
    c.reverse = reverse;
    c.rate = 0.5;
    const result = splitClip(p, c.id, 1.5);
    const [a, b] = result.tracks[0].clips;
    expect(a.start + clipDuration(a)).toBe(b.start);
    expect(clipDuration(a) + clipDuration(b)).toBe(clipDuration(c));
    expect(a.assetId).toBe(b.assetId);
    if (reverse) expect(a.trimStart).toBe(b.trimEnd);
    else expect(a.trimEnd).toBe(b.trimStart);
  });
  it('does not split outside the selected clip', () => {
    const p = fixture();
    expect(splitClip(p, p.tracks[0].clips[0].id, 0).tracks[0].clips).toHaveLength(1);
  });
  it('undoes and redoes track ordering and effects without touching audio assets', () => {
    const p = fixture(),
      history = new ProjectHistory(p);
    history.change({ ...p, tracks: [...p.tracks].reverse() });
    expect(history.current.tracks[2].clips).toHaveLength(1);
    expect(history.undo()).toBe(p);
    expect(history.redo().tracks[2].clips[0].assetId).toBe(asset.id);
    expect(asset.blob?.size).toBe(4);
  });
  it('protects source references retained by undo and redo history', () => {
    const p = fixture(),
      history = new ProjectHistory(p);
    history.change({ ...p, tracks: [] });
    expect(history.referencesAsset(asset.id)).toBe(true);
    history.undo();
    expect(history.referencesAsset(asset.id)).toBe(true);
    history.redo();
    expect(history.referencesAsset(asset.id)).toBe(true);
  });
  it('solo and mute select the audible tracks', () => {
    const p = fixture();
    p.tracks[1].solo = true;
    expect(audibleTracks(p).map((t) => t.id)).toEqual([p.tracks[1].id]);
    p.tracks[1].mute = true;
    expect(audibleTracks(p)).toEqual([]);
  });
  it('roundtrips a project and rejects unsupported versions, NaN, duplicate IDs, and invalid trims', () => {
    const p = fixture();
    expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(() => validateProject({ ...p, version: 4 })).toThrow('version');
    const c = p.tracks[0].clips[0];
    expect(() => validateProject(editClip(p, c.id, { gain: NaN }))).toThrow();
    expect(() => validateProject(editClip(p, c.id, { trimEnd: 0 }))).toThrow();
    p.tracks[1].id = p.tracks[0].id;
    expect(() => validateProject(p)).toThrow('Duplicate');
  });
  it('rejects unsafe export and effect parameters', () => {
    const p = fixture();
    expect(() => validateProject({ ...p, export: { ...p.export, channels: 4 } })).toThrow();
    expect(() =>
      validateProject(
        editClip(p, p.tracks[0].clips[0].id, { effects: { ...cleanEffects(), reverb: 4 } }),
      ),
    ).toThrow();
  });
});
describe('deterministic audio helpers', () => {
  it('uses a stable finite distortion curve', () => {
    const a = distortionCurve(0.2);
    expect(a).toEqual(distortionCurve(0.2));
    expect(a[0]).toBe(-1);
    expect(a[a.length - 1]).toBe(1);
    expect([...a].every(Number.isFinite)).toBe(true);
  });
  it('handles overlapping fades without an overshoot', () => {
    expect(envelopeAt(0, 1, 0.8, 0.8)).toBe(0);
    expect(envelopeAt(0.5, 1, 0.8, 0.8)).toBe(0.625);
    expect(envelopeAt(1, 1, 0.8, 0.8)).toBe(0);
    expect(envelopeAt(0.5, 1, 0, 0)).toBe(1);
  });
  it('encodes genuine little-endian PCM WAV with interleaved stereo', async () => {
    const blob = encodeWav({
      sampleRate: 48000,
      numberOfChannels: 2,
      length: 2,
      getChannelData: (c) => Float32Array.from(c ? [0.5, -0.5] : [1, -1]),
    });
    const bytes = new Uint8Array(await blob.arrayBuffer()),
      view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(blob.size).toBe(52);
    expect(safeFilename('Zombie Gurgle!')).toBe('zombie_gurgle');
  });
});
describe('portable package integrity', () => {
  it('contains original source bytes and restores all clip settings', async () => {
    const p = fixture();
    p.loop = { enabled: true, start: 0.75, end: 1.25 };
    p.export.limiter = true;
    p.export.format = 'ogg';
    p.tracks[0].clips[0].pitchSemitones = -7;
    p.tracks[0].clips[0].automation.pan = [
      { time: 0, value: -1 },
      { time: 1, value: 1 },
    ];
    p.tracks[0].clips[0].cleanup = {
      ...p.tracks[0].clips[0].cleanup,
      gateEnabled: true,
      normalize: true,
      dcRemove: true,
      humHz: 50,
      thresholdDb: -35,
    };
    p.tracks[0].clips[0].effects = {
      ...cleanEffects(),
      order: [...cleanEffects().order].reverse(),
      eq: { low: 3, mid: -2, high: 6 },
      bypassed: ['echo'],
    };
    const restored = await importPackage(await exportPackage(p, [asset]));
    expect(restored.project).toEqual(p);
    expect(new Uint8Array(await restored.assets[0].blob!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
  it('imports stored version 1 packages and migrates their instructions while preserving originals', async () => {
    const p = fixture(),
      files = unzipSync(new Uint8Array(await (await exportPackage(p, [asset])).arrayBuffer()));
    const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
    manifest.version = manifest.project.version = 1;
    delete manifest.project.loop;
    delete manifest.project.export.limiter;
    for (const track of manifest.project.tracks)
      for (const clip of track.clips) {
        delete clip.cleanup;
        for (const key of ['order', 'bypassed', 'eq', 'compressor']) delete clip.effects[key];
      }
    files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
    const restored = await importPackage(
      new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>]),
    );
    expect(restored.project).toEqual(p);
    expect(new Uint8Array(await restored.assets[0].blob!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
  it('rejects corruption and malformed or oversized archives', async () => {
    const bytes = new Uint8Array(await (await exportPackage(fixture(), [asset])).arrayBuffer());
    const payload = bytes.findIndex(
      (_, i) => bytes[i] === 1 && bytes[i + 1] === 2 && bytes[i + 2] === 3 && bytes[i + 3] === 4,
    );
    expect(payload).toBeGreaterThan(0);
    bytes[payload] ^= 255;
    await expect(importPackage(new Blob([bytes]))).rejects.toThrow('integrity');
    await expect(importPackage(new Blob(['not a project']))).rejects.toThrow();
    await expect(importPackage({ size: 200 * 1024 * 1024 } as Blob)).rejects.toThrow('151 MB');
  });
  it('rejects path traversal and compressed archives before decoding their contents', async () => {
    const unsafe = zipSync(
      { '../audio/0.bin': new Uint8Array([1]), 'manifest.json': new TextEncoder().encode('{}') },
      { level: 0 },
    );
    await expect(importPackage(new Blob([unsafe as Uint8Array<ArrayBuffer>]))).rejects.toThrow(
      'path',
    );
    const compressed = zipSync({ 'manifest.json': new TextEncoder().encode('{}') }, { level: 6 });
    await expect(importPackage(new Blob([compressed as Uint8Array<ArrayBuffer>]))).rejects.toThrow(
      'compressed',
    );
  });
});
