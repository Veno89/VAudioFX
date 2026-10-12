import {
  clamp,
  cleanEffects,
  clipDuration,
  makeClip,
  makeTrack,
  LIMITS,
  type Asset,
  type Clip,
  type Effects,
  type Project,
} from '../domain/model';

export const creativePresets = [
  { id: 'creature', name: 'Creature voice', help: 'Deeper, longer, darker, and slightly rough.' },
  {
    id: 'ghost',
    name: 'Ghostly whisper',
    help: 'Thin, airy, and spacious. Works best on a whispered recording.',
  },
  { id: 'impact', name: 'Heavy impact', help: 'Adds low weight, grit, and controlled dynamics.' },
  { id: 'magic', name: 'Magical spark', help: 'Brightens the sound with a short repeating trail.' },
] as const;
export type CreativePreset = (typeof creativePresets)[number]['id'];
export type Macro = 'size' | 'aggression' | 'brightness' | 'space';
export function presetPatch(id: CreativePreset): Partial<Clip> {
  const effects = cleanEffects();
  switch (id) {
    case 'creature':
      return {
        rate: 0.68,
        gain: 0.65,
        effects: { ...effects, highpass: 65, lowpass: 2600, distortion: 0.14, reverb: 0.12 },
      };
    case 'ghost':
      return {
        rate: 0.9,
        gain: 0.55,
        effects: {
          ...effects,
          highpass: 650,
          lowpass: 7500,
          eq: { low: -5, mid: 1, high: 3 },
          reverb: 0.4,
          echo: 0.18,
        },
      };
    case 'impact':
      return {
        rate: 0.85,
        gain: 0.75,
        effects: {
          ...effects,
          highpass: 35,
          lowpass: 7000,
          eq: { low: 5, mid: 0, high: -2 },
          distortion: 0.12,
          bypassed: [],
          compressor: { threshold: -22, ratio: 4, knee: 12, attackMs: 12, releaseMs: 110 },
        },
      };
    case 'magic':
      return {
        rate: 1.15,
        gain: 0.65,
        effects: {
          ...effects,
          highpass: 200,
          lowpass: 12000,
          eq: { low: -3, mid: 0, high: 4 },
          reverb: 0.2,
          echo: 0.32,
        },
      };
    default:
      throw new Error('Unknown creative preset.');
  }
}
function enable(effects: Effects, nodes: Effects['order']): Effects {
  return {
    ...effects,
    enabled: true,
    bypassed: effects.bypassed.filter((id) => !nodes.includes(id)),
  };
}
export function macroValue(clip: Clip, macro: Macro): number {
  switch (macro) {
    case 'size':
      return clamp(0.5 - Math.log2(clip.rate) / 1.5, 0, 1);
    case 'aggression':
      return clamp(clip.effects.distortion / 0.4, 0, 1);
    case 'brightness':
      return clamp(Math.log(clip.effects.lowpass / 800) / Math.log(25), 0, 1);
    case 'space':
      return clamp(clip.effects.reverb / 0.65, 0, 1);
  }
}
export function macroPatch(clip: Clip, macro: Macro, value: number): Partial<Clip> {
  if (!Number.isFinite(value) || value < 0 || value > 1)
    throw new Error('Macro amount must be between zero and one.');
  const effects = { ...clip.effects, eq: { ...clip.effects.eq } };
  switch (macro) {
    case 'size':
      return {
        rate: 2 ** ((0.5 - value) * 1.5),
        effects: { ...enable(effects, ['eq']), eq: { ...effects.eq, low: (value - 0.5) * 8 } },
      };
    case 'aggression': {
      const active = enable(effects, ['distortion', 'compressor']);
      if (value === 0) active.bypassed = [...active.bypassed, 'compressor'];
      return {
        effects: {
          ...active,
          distortion: value * 0.4,
          compressor: {
            ...effects.compressor,
            threshold: -12 - 18 * value,
            ratio: 1 + 7 * value,
            knee: 12,
          },
        },
      };
    }
    case 'brightness':
      return {
        effects: {
          ...enable(effects, ['lowpass', 'eq']),
          lowpass: 800 * 25 ** value,
          eq: { ...effects.eq, high: -6 + 12 * value },
        },
      };
    case 'space':
      return {
        effects: {
          ...enable(effects, ['reverb', 'echo']),
          reverb: value * 0.65,
          echo: value * 0.2,
        },
      };
  }
}
export function insertSource(
  project: Project,
  asset: Asset,
  at: number,
  trackId?: string,
  patch: Partial<Clip> = {},
): { project: Project; clip: Clip; trackId: string } {
  if (project.tracks.reduce((n, t) => n + t.clips.length, 0) >= LIMITS.clips)
    throw new Error('This project already contains 128 clips.');
  const clip = { ...makeClip(asset, at), ...patch };
  if (at < 0 || !Number.isFinite(at) || at + clipDuration(clip) > LIMITS.duration)
    throw new Error(
      'The generated sound would extend past the 120-second timeline. Move the playhead earlier.',
    );
  const existing = project.tracks.find((t) => t.id === trackId);
  if (existing)
    return {
      project: {
        ...project,
        tracks: project.tracks.map((t) =>
          t.id === existing.id ? { ...t, clips: [...t.clips, clip] } : t,
        ),
      },
      clip,
      trackId: existing.id,
    };
  if (project.tracks.length >= LIMITS.tracks)
    throw new Error(
      'This project already contains 16 layers. Choose an existing layer or remove one.',
    );
  const track = makeTrack(project.tracks.length);
  track.name = asset.name;
  track.clips = [clip];
  return { project: { ...project, tracks: [...project.tracks, track] }, clip, trackId: track.id };
}
