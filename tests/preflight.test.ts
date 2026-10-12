import { expect, it, vi } from 'vitest';
import { preflightAudio } from '../src/audio/preflight';
import { encodeWav } from '../src/export/wav';
import { AssetRepository } from '../src/audio/assets';
import type { Asset } from '../src/domain/model';

const wav = async () =>
  new Uint8Array(
    await encodeWav({
      sampleRate: 48000,
      numberOfChannels: 1,
      length: 100,
      getChannelData: () => new Float32Array(100),
    }).arrayBuffer(),
  );
it('accepts actual PCM and rejects inconsistent sample layout and truncated chunks', async () => {
  const bytes = await wav();
  expect(() => preflightAudio(bytes)).not.toThrow();
  const view = new DataView(bytes.buffer);
  view.setUint16(22, 8, true);
  expect(() => preflightAudio(bytes)).toThrow('mono');
  view.setUint16(22, 1, true);
  view.setUint32(28, 1, true);
  expect(() => preflightAudio(bytes)).toThrow('layout');
  expect(() => preflightAudio(bytes.slice(0, -1))).toThrow('length');
});
it('rejects excessive PCM declarations before constructing a native decoder', async () => {
  const bytes = new Uint8Array(44 + 8000 * 2 * 121),
    header = await wav();
  bytes.set(header.subarray(0, 44));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint32(40, bytes.length - 44, true);
  const native = vi.fn();
  vi.stubGlobal('AudioContext', native);
  try {
    await expect(
      new AssetRepository().decode({ id: 'long', blob: new Blob([bytes]) } as Asset),
    ).rejects.toThrow('2 minutes');
    expect(native).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it('bounds Vorbis granule/channel declarations before decoding and tolerates unknown packet positions', () => {
  const bytes = new Uint8Array(58),
    view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('OggS'));
  bytes[26] = 1;
  bytes[27] = 30;
  bytes.set(new Uint8Array([1, ...new TextEncoder().encode('vorbis')]), 28);
  bytes[39] = 1;
  view.setUint32(40, 48000, true);
  view.setBigUint64(6, 48000n, true);
  expect(() => preflightAudio(bytes)).not.toThrow();
  view.setBigUint64(6, 0xffffffffffffffffn, true);
  expect(() => preflightAudio(bytes)).not.toThrow();
  view.setBigUint64(6, 48000n * 121n, true);
  expect(() => preflightAudio(bytes)).toThrow('2 minutes');
  bytes[39] = 2;
  view.setUint32(40, 384000, true);
  view.setBigUint64(6, 384000n * 60n, true);
  expect(() => preflightAudio(bytes)).toThrow('memory limit');
});
