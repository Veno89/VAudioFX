import { processCleanup, limitPeaks, PEAK_CEILING } from './cleanup';
import { shiftPitch } from './pitch';
import { encodeWav } from '../export/wav';
import type { AudioWork, AudioWorkResult } from './work-contract';
import { LIMITS } from '../domain/model';
import { createEncoder } from 'wasm-media-encoders';
import oggWasm from 'wasm-media-encoders/wasm/ogg?url';
import mp3Wasm from 'wasm-media-encoders/wasm/mp3?url';

self.onmessage = async (event: MessageEvent<AudioWork>) => {
  try {
    const job = event.data,
      channels = job.channels,
      length = channels[0]?.length;
    if (
      !length ||
      channels.length < 1 ||
      channels.length > 2 ||
      channels.some((c) => c.length !== length) ||
      length * channels.length * 4 > LIMITS.totalBytes
    )
      throw new Error('Audio processing exceeds its bounded buffer limit.');
    for (const channel of channels)
      for (const value of channel)
        if (!Number.isFinite(value)) throw new Error('Invalid audio samples.');
    let result: AudioWorkResult;
    if (job.kind === 'prepare') {
      processCleanup(channels, job.sampleRate, job.cleanup);
      if (job.reverse) for (const channel of channels) channel.reverse();
      const shifted = shiftPitch(
        channels,
        job.sampleRate,
        job.pitch,
      ) as Float32Array<ArrayBuffer>[];
      result = { kind: 'prepare', channels: shifted };
    } else if (job.kind === 'master') {
      let peak = 0;
      for (const channel of channels)
        for (const value of channel) peak = Math.max(peak, Math.abs(value));
      if (job.normalize && peak > 0) {
        const scale = Math.min(10, PEAK_CEILING / peak);
        for (const channel of channels) for (let i = 0; i < length; i++) channel[i] *= scale;
      }
      result = {
        kind: 'master',
        channels,
        peak,
        limitedSamples: job.limiter ? limitPeaks(channels) : 0,
      };
    } else {
      if (job.sampleRate !== 44100 && job.sampleRate !== 48000)
        throw new Error('Unsupported export sample rate.');
      if (job.format === 'wav') {
        result = {
          kind: 'encode',
          blob: encodeWav({
            sampleRate: job.sampleRate,
            numberOfChannels: channels.length,
            length,
            getChannelData: (c) => channels[c],
          }),
        };
      } else {
        const wasm = job.format === 'ogg' ? oggWasm : mp3Wasm;
        const mime = job.format === 'ogg' ? 'audio/ogg' : 'audio/mpeg';
        const encoder = await createEncoder(mime, wasm);
        encoder.configure({
          sampleRate: job.sampleRate,
          channels: channels.length,
          ...(job.format === 'ogg'
            ? { vbrQuality: 5 }
            : { bitrate: 192, outputSampleRate: job.sampleRate }),
        });
        const parts: Uint8Array<ArrayBuffer>[] = [];
        for (let offset = 0; offset < length; offset += 16384) {
          const block = channels.map((c) => c.subarray(offset, Math.min(length, offset + 16384)));
          for (const c of block)
            for (let i = 0; i < c.length; i++) c[i] = Math.max(-1, Math.min(1, c[i]));
          parts.push(encoder.encode(block).slice());
        }
        parts.push(encoder.finalize().slice());
        result = { kind: 'encode', blob: new Blob(parts, { type: mime }) };
      }
    }
    const transfer = 'channels' in result ? result.channels.map((c) => c.buffer) : [];
    self.postMessage(result, { transfer });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : 'Audio processing failed.',
    });
  }
};
