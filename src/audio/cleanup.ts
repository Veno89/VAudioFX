import { dbToGain, type Cleanup } from '../domain/model';

export const PEAK_CEILING = 10 ** (-1 / 20);

/** Operates on owned region copies only. A linked stereo envelope preserves balance. */
export function processCleanup(
  channels: Float32Array[],
  sampleRate: number,
  settings: Cleanup,
): void {
  if (settings.dcRemove)
    for (const channel of channels) {
      let sum = 0;
      for (const value of channel) sum += value;
      const mean = sum / channel.length;
      for (let i = 0; i < channel.length; i++) channel[i] -= mean;
    }
  // RBJ notch biquads, Q=25. Process in source time so pitch/rate changes do not
  // move electrical hum away from the cleanup frequencies.
  if (settings.humHz)
    for (let harmonic = 1; harmonic <= 3; harmonic++) {
      const w = (2 * Math.PI * settings.humHz * harmonic) / sampleRate;
      const alpha = Math.sin(w) / 50,
        divisor = 1 + alpha;
      const b0 = 1 / divisor,
        b1 = (-2 * Math.cos(w)) / divisor,
        b2 = b0,
        a1 = b1,
        a2 = (1 - alpha) / divisor;
      for (const channel of channels) {
        let z1 = 0,
          z2 = 0;
        for (let i = 0; i < channel.length; i++) {
          const input = channel[i],
            output = b0 * input + z1;
          z1 = b1 * input - a1 * output + z2;
          z2 = b2 * input - a2 * output;
          channel[i] = output;
        }
      }
    }
  if (settings.gateEnabled) {
    const threshold = dbToGain(settings.thresholdDb);
    const detector = Math.exp(-1 / (0.002 * sampleRate));
    const attack = Math.exp(-1 / ((settings.attackMs * sampleRate) / 1000));
    const release = Math.exp(-1 / ((settings.releaseMs * sampleRate) / 1000));
    let energy = 0,
      gain = 0,
      open = false;
    for (let i = 0; i < channels[0].length; i++) {
      let frameEnergy = 0;
      for (const channel of channels) frameEnergy = Math.max(frameEnergy, channel[i] ** 2);
      energy = detector * energy + (1 - detector) * frameEnergy;
      const level = Math.sqrt(energy);
      if (level >= threshold) open = true;
      else if (level < threshold * 0.7) open = false;
      const target = open ? 1 : 0,
        coefficient = open ? attack : release;
      gain = target + coefficient * (gain - target);
      for (const channel of channels) channel[i] *= gain;
    }
  }
  if (settings.normalize) {
    let peak = 0;
    for (const channel of channels)
      for (const value of channel) peak = Math.max(peak, Math.abs(value));
    if (peak > 0) {
      const gain = Math.min(10, PEAK_CEILING / peak);
      for (const channel of channels) for (let i = 0; i < channel.length; i++) channel[i] *= gain;
    }
  }
}

export function findSignalRegion(
  channels: Float32Array[],
  sampleRate: number,
  start: number,
  end: number,
  thresholdDb: number,
): { trimStart: number; trimEnd: number } {
  const threshold = dbToGain(thresholdDb),
    first = Math.max(0, Math.floor(start * sampleRate)),
    last = Math.min(channels[0].length, Math.ceil(end * sampleRate));
  let a = -1,
    b = -1;
  for (let i = first; i < last; i++) {
    if (channels.some((channel) => Math.abs(channel[i]) >= threshold)) {
      if (a < 0) a = i;
      b = i;
    }
  }
  if (a < 0)
    throw new Error(
      'No sound exceeds the cleanup threshold in this region. Lower the threshold and try again.',
    );
  const padding = Math.ceil(sampleRate * 0.01);
  return {
    trimStart: Math.max(first, a - padding) / sampleRate,
    trimEnd: Math.min(last, b + padding + 1) / sampleRate,
  };
}

/** Explicit hard peak limiting; never modifies source audio. */
export function limitPeaks(channels: Float32Array[], ceiling = PEAK_CEILING): number {
  let count = 0;
  for (const channel of channels)
    for (let i = 0; i < channel.length; i++) {
      if (Math.abs(channel[i]) > ceiling) {
        channel[i] = Math.sign(channel[i]) * ceiling;
        count++;
      }
    }
  return count;
}
