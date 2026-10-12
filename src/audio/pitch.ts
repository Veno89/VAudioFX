import { SoundTouch } from '@soundtouchjs/core';

/** Bounded offline WSOLA/Lanczos pipeline. Stereo is processed as one linked stream. */
export function shiftPitch(
  channels: Float32Array[],
  sampleRate: number,
  semitones: number,
): Float32Array[] {
  if (!Number.isFinite(semitones) || Math.abs(semitones) > 12)
    throw new Error('Pitch must be within one octave.');
  if (semitones === 0) return channels;
  const length = channels[0].length;
  const processor = new SoundTouch({
    sampleRate,
    sampleBufferType: 'circular',
    interpolationStrategy: 'lanczos',
  });
  processor.pitchSemitones = semitones;
  processor.setStretchParameters({
    sequenceMs: 40,
    seekWindowMs: 10,
    overlapMs: 8,
    quickSeek: false,
  });
  const output = channels.map(() => new Float32Array(length));
  const chunk = 4096,
    input = new Float32Array(chunk * 2),
    extracted = new Float32Array(chunk * 2);
  // The algorithm needs a lookahead window. Flush with bounded silence, then retain exactly the region length.
  let written = 0;
  for (let offset = 0; offset < length + sampleRate && written < length; offset += chunk) {
    input.fill(0);
    for (let i = 0; i < chunk && offset + i < length; i++) {
      input[i * 2] = channels[0][offset + i];
      input[i * 2 + 1] = (channels[1] ?? channels[0])[offset + i];
    }
    processor.inputBuffer.putSamples(input, 0, chunk);
    processor.process();
    while (processor.outputBuffer.frameCount && written < length) {
      const count = Math.min(chunk, processor.outputBuffer.frameCount, length - written);
      processor.outputBuffer.extract(extracted, 0, count);
      processor.outputBuffer.receive(count);
      for (let c = 0; c < output.length; c++)
        for (let i = 0; i < count; i++) {
          const value = extracted[i * 2 + c];
          if (!Number.isFinite(value))
            throw new Error('Pitch processing produced invalid samples.');
          output[c][written + i] = value;
        }
      written += count;
    }
  }
  processor.clear();
  if (written !== length) throw new Error('Pitch processing could not finish this region.');
  return output;
}
