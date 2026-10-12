import { uid, type Asset } from '../domain/model';
import { encodeWav } from '../export/wav';

export const sourceKinds = [
  { id: 'white', name: 'White noise', description: 'Bright air, rushes, and impact texture.' },
  { id: 'pink', name: 'Pink noise', description: 'Warmer noise for wind and low textures.' },
  { id: 'sine', name: 'Sine tone', description: 'A smooth tone for body and simple UI sounds.' },
  { id: 'square', name: 'Square tone', description: 'A hollow, buzzy tone for retro effects.' },
  {
    id: 'sawtooth',
    name: 'Sawtooth tone',
    description: 'A bright, brassy tone for magic and machines.',
  },
  {
    id: 'sweep',
    name: 'Frequency sweep',
    description: 'A rising or falling sine tone for spells and lasers.',
  },
  {
    id: 'burst',
    name: 'Noise burst',
    description: 'A quick decaying noise hit for clicks and impacts.',
  },
] as const;
export type SourceKind = (typeof sourceKinds)[number]['id'];
export interface SourceSpec {
  kind: SourceKind;
  duration: number;
  from: number;
  to: number;
  shape: 'hit' | 'swell' | 'steady';
  pulse: number;
  pulseHz: number;
  seed: number;
}
export const sourceDefaults = (): SourceSpec => ({
  kind: 'sweep',
  duration: 0.6,
  from: 1200,
  to: 180,
  shape: 'hit',
  pulse: 0,
  pulseHz: 8,
  seed: 9182,
});
export function validateSource(spec: SourceSpec): SourceSpec {
  if (
    !sourceKinds.some((k) => k.id === spec.kind) ||
    !['hit', 'swell', 'steady'].includes(spec.shape)
  )
    throw new Error('Choose a supported sound source and envelope.');
  const bounds: [number, number, number][] = [
    [spec.duration, 0.05, 10],
    [spec.from, 20, 10000],
    [spec.to, 20, 10000],
    [spec.pulse, 0, 1],
    [spec.pulseHz, 1, 30],
    [spec.seed, 0, 4294967295],
  ];
  if (
    bounds.some(([n, lo, hi]) => !Number.isFinite(n) || n < lo || n > hi) ||
    !Number.isInteger(spec.seed)
  )
    throw new Error('Generator values exceed their supported range.');
  return { ...spec };
}
// Original octave-rate sample-and-hold implementation (Voss-McCartney),
// including a white component every sample. No copied third-party DSP code.
export function noiseSamples(length: number, seed: number, pink = false): Float32Array {
  if (
    !Number.isInteger(length) ||
    length < 1 ||
    length > 480000 ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 4294967295
  )
    throw new Error('Invalid noise buffer bounds.');
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const rows = Float64Array.from({ length: 12 }, random),
    output = new Float32Array(length);
  let total = rows.reduce((a, b) => a + b, 0);
  for (let i = 0; i < length; i++) {
    if (pink) {
      const counter = i + 1,
        row = 31 - Math.clz32(counter & -counter);
      if (row < rows.length) {
        const next = random();
        total += next - rows[row];
        rows[row] = next;
      }
      output[i] = (total + random()) / 13;
    } else output[i] = random();
  }
  return output;
}
export function shapeSource(
  data: Float32Array,
  spec: SourceSpec,
  sampleRate = 48000,
): Float32Array<ArrayBuffer> {
  const config = validateSource(spec),
    output = new Float32Array(data.length);
  if (!data.length) throw new Error('Generator produced an empty buffer.');
  let peak = 0,
    mean = 0;
  for (const n of data) {
    if (!Number.isFinite(n)) throw new Error('Generator produced invalid audio.');
    mean += n;
  }
  mean /= data.length;
  for (const n of data) peak = Math.max(peak, Math.abs(n - mean));
  if (!peak) throw new Error('Generator produced silence.');
  for (let i = 0; i < data.length; i++) {
    const t = i / Math.max(1, data.length - 1),
      seconds = i / sampleRate;
    const edges = Math.min(1, seconds / 0.005, (data.length - 1 - i) / sampleRate / 0.015);
    const envelope =
      config.kind === 'burst' || config.shape === 'hit'
        ? (1 - t) ** 3
        : config.shape === 'swell'
          ? Math.sin(Math.PI * t) ** 2
          : 1;
    const pulse = 1 - config.pulse * (0.5 + 0.5 * Math.cos(2 * Math.PI * config.pulseHz * seconds));
    output[i] = ((data[i] - mean) / peak) * 0.45 * edges * envelope * pulse;
  }
  return output;
}
export async function generateSource(input: SourceSpec, name: string): Promise<Asset> {
  const spec = validateSource(input),
    sampleRate = 48000,
    length = Math.ceil(spec.duration * sampleRate);
  const title = name.trim();
  if (!title || title.length > 80)
    throw new Error('Give the generated sound a name of 1–80 characters.');
  let data: Float32Array;
  if (['white', 'pink', 'burst'].includes(spec.kind))
    data = noiseSamples(length, spec.seed, spec.kind === 'pink');
  else {
    const context = new OfflineAudioContext(1, length, sampleRate),
      oscillator = context.createOscillator();
    oscillator.type = spec.kind === 'square' || spec.kind === 'sawtooth' ? spec.kind : 'sine';
    oscillator.frequency.setValueAtTime(spec.from, 0);
    oscillator.frequency.exponentialRampToValueAtTime(spec.to, length / sampleRate);
    oscillator.connect(context.destination);
    oscillator.start();
    oscillator.stop(length / sampleRate);
    const rendered = await context.startRendering();
    data = rendered.getChannelData(0);
  }
  const shaped = shapeSource(data, spec),
    blob = encodeWav({ sampleRate, numberOfChannels: 1, length, getChannelData: () => shaped });
  return {
    id: uid(),
    name: title,
    kind: 'builtin',
    category: 'Synthesis',
    tags: ['procedural', spec.kind],
    duration: length / sampleRate,
    size: blob.size,
    mime: 'audio/wav',
    originalFilename: `${title}.wav`,
    blob,
    author: 'VAudioFX',
    license: 'CC0-1.0',
    sourceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    verification: `Generated locally with VAudioFX. Source settings: ${JSON.stringify(spec)}`,
  };
}
