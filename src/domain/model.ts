import { AUTOMATION_BOUNDS, cropAutomation, emptyAutomation, type Automation } from './automation';

export const LIMITS = {
  fileBytes: 30 * 1024 * 1024,
  totalBytes: 150 * 1024 * 1024,
  duration: 120,
  tracks: 16,
  clips: 128,
  assets: 512,
} as const;
export const uid = () => crypto.randomUUID();

export const EFFECT_IDS = [
  'highpass',
  'lowpass',
  'eq',
  'distortion',
  'compressor',
  'reverb',
  'echo',
] as const;
export type EffectId = (typeof EFFECT_IDS)[number];
export interface Effects {
  enabled: boolean;
  highpass: number;
  lowpass: number;
  distortion: number;
  reverb: number;
  echo: number;
  order: EffectId[];
  bypassed: EffectId[];
  eq: { low: number; mid: number; high: number };
  compressor: {
    threshold: number;
    ratio: number;
    knee: number;
    attackMs: number;
    releaseMs: number;
  };
}
export const cleanEffects = (): Effects => ({
  enabled: true,
  highpass: 20,
  lowpass: 20000,
  distortion: 0,
  reverb: 0,
  echo: 0,
  order: [...EFFECT_IDS],
  bypassed: ['compressor'],
  eq: { low: 0, mid: 0, high: 0 },
  compressor: { threshold: -24, ratio: 4, knee: 12, attackMs: 10, releaseMs: 150 },
});
export interface Cleanup {
  dcRemove: boolean;
  humHz: 0 | 50 | 60;
  gateEnabled: boolean;
  thresholdDb: number;
  attackMs: number;
  releaseMs: number;
  normalize: boolean;
}
export const cleanCleanup = (): Cleanup => ({
  dcRemove: false,
  humHz: 0,
  gateEnabled: false,
  thresholdDb: -40,
  attackMs: 5,
  releaseMs: 80,
  normalize: false,
});
export interface LoopRegion {
  enabled: boolean;
  start: number;
  end: number;
}
export interface Clip {
  id: string;
  assetId: string;
  name: string;
  start: number;
  trimStart: number;
  trimEnd: number;
  gain: number;
  pan: number;
  rate: number;
  pitchSemitones: number;
  automation: Automation;
  reverse: boolean;
  fadeIn: number;
  fadeOut: number;
  effects: Effects;
  cleanup: Cleanup;
}
export interface Track {
  id: string;
  name: string;
  color: string;
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  clips: Clip[];
}
export interface ExportSettings {
  format: 'wav' | 'ogg' | 'mp3';
  sampleRate: 44100 | 48000;
  channels: 1 | 2;
  normalize: boolean;
  limiter: boolean;
  tail: number;
}
export interface Project {
  version: 3;
  id: string;
  name: string;
  updatedAt: number;
  tracks: Track[];
  export: ExportSettings;
  snap: boolean;
  zoom: number;
  loop: LoopRegion;
}
export interface Asset {
  id: string;
  name: string;
  kind: 'builtin' | 'import' | 'recording';
  category: string;
  tags: string[];
  duration: number;
  size: number;
  mime: string;
  originalFilename: string;
  blob?: Blob;
  url?: string;
  pack?: string;
  author?: string;
  license?: string;
  sourceUrl?: string;
  verification?: string;
  checksum?: string;
}
export const COLORS = ['#a8ddb5', '#d2b7f1', '#f0c58d', '#89cddd', '#eca9b0', '#abbcee'];
export const makeTrack = (index: number): Track => ({
  id: uid(),
  name: `Layer ${index + 1}`,
  color: COLORS[index % COLORS.length],
  gain: 1,
  pan: 0,
  mute: false,
  solo: false,
  clips: [],
});
export const newProject = (name = 'Untitled sound'): Project => ({
  version: 3,
  id: uid(),
  name,
  updatedAt: Date.now(),
  tracks: [makeTrack(0), makeTrack(1), makeTrack(2)],
  export: {
    format: 'wav',
    sampleRate: 48000,
    channels: 2,
    normalize: true,
    limiter: false,
    tail: 1.5,
  },
  snap: true,
  zoom: 110,
  loop: { enabled: false, start: 0, end: 2 },
});
export const clipDuration = (clip: Clip) => (clip.trimEnd - clip.trimStart) / clip.rate;
export const contentDuration = (project: Project) =>
  Math.max(0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + clipDuration(c))));
export const projectDuration = (project: Project) =>
  Math.min(LIMITS.duration + 10, contentDuration(project) + project.export.tail);
export const makeClip = (asset: Asset, start = 0): Clip => ({
  id: uid(),
  assetId: asset.id,
  name: asset.name,
  start,
  trimStart: 0,
  trimEnd: asset.duration,
  gain: 0.8,
  pan: 0,
  rate: 1,
  pitchSemitones: 0,
  automation: emptyAutomation(),
  reverse: false,
  fadeIn: 0.005,
  fadeOut: 0.025,
  effects: cleanEffects(),
  cleanup: cleanCleanup(),
});
export const dbToGain = (db: number) => 10 ** (db / 20);
export const gainToDb = (gain: number) => (gain > 0 ? 20 * Math.log10(gain) : -60);
export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
export function editClip(project: Project, id: string, change: Partial<Clip>): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === id ? { ...c, ...change } : c)),
    })),
  };
}
export function splitClip(project: Project, id: string, position: number): Project {
  return {
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: t.clips.flatMap((c) => {
        if (
          c.id !== id ||
          position <= c.start + 0.01 ||
          position >= c.start + clipDuration(c) - 0.01
        )
          return [c];
        const sourceTime = (position - c.start) * c.rate;
        const cut = c.reverse ? c.trimEnd - sourceTime : c.trimStart + sourceTime;
        const fraction = (position - c.start) / clipDuration(c);
        const first = {
          ...c,
          trimStart: c.reverse ? cut : c.trimStart,
          trimEnd: c.reverse ? c.trimEnd : cut,
          fadeOut: 0,
          automation: cropAutomation(c.automation, 0, fraction),
        };
        const second = {
          ...c,
          id: uid(),
          start: position,
          trimStart: c.reverse ? c.trimStart : cut,
          trimEnd: c.reverse ? cut : c.trimEnd,
          fadeIn: 0,
          automation: cropAutomation(c.automation, fraction, 1),
        };
        return [first, second];
      }),
    })),
  };
}
export function snapTime(time: number, enabled: boolean): number {
  return Math.max(0, enabled ? Math.round(time * 20) / 20 : time);
}
export function snapClipTime(
  project: Project,
  id: string,
  time: number,
  playhead: number,
  duration = 0,
): number {
  if (!project.snap) return Math.max(0, time);
  const anchors = [
    0,
    playhead,
    ...project.tracks.flatMap((t) =>
      t.clips.filter((c) => c.id !== id).flatMap((c) => [c.start, c.start + clipDuration(c)]),
    ),
  ];
  let result = time,
    distance = 8 / project.zoom,
    found = false;
  for (const anchor of anchors)
    for (const candidate of [anchor, anchor - duration]) {
      const delta = Math.abs(candidate - time);
      if (candidate >= 0 && delta < distance) {
        result = candidate;
        distance = delta;
        found = true;
      }
    }
  return Math.max(0, found ? result : snapTime(time, true));
}
export function repeatClip(project: Project, id: string, total: number): Project {
  if (!Number.isInteger(total) || total < 2 || total > 16)
    throw new Error('Choose 2–16 total repetitions.');
  const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
  if (!clip) throw new Error('Select a clip to repeat.');
  if (project.tracks.reduce((n, t) => n + t.clips.length, 0) + total - 1 > LIMITS.clips)
    throw new Error('Repeating would exceed 128 clips.');
  if (clip.start + clipDuration(clip) * total > LIMITS.duration)
    throw new Error('Repeating would exceed 120 seconds.');
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.clips.some((c) => c.id === id)
        ? {
            ...t,
            clips: [
              ...t.clips,
              ...Array.from({ length: total - 1 }, (_, i) => ({
                ...clip,
                id: uid(),
                start: clip.start + clipDuration(clip) * (i + 1),
              })),
            ],
          }
        : t,
    ),
  };
}
export function audibleTracks(project: Project): Track[] {
  const solo = project.tracks.some((t) => t.solo);
  return project.tracks.filter((t) => !t.mute && (!solo || t.solo));
}

// Validation reconstructs objects, discarding unknown fields and prototype keys.
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('Invalid project structure.');
  return v as Record<string, unknown>;
};
const str = (v: unknown) => {
  if (typeof v !== 'string' || v.length > 200 || !v.length)
    throw new Error('Invalid project text.');
  return v;
};
const num = (v: unknown, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw new Error('Invalid project parameter.');
  return v;
};
const bool = (v: unknown) => {
  if (typeof v !== 'boolean') throw new Error('Invalid project flag.');
  return v;
};
export function validateEffects(input: unknown, legacy = false): Effects {
  const e = object(input),
    defaults = cleanEffects();
  const list = (value: unknown): EffectId[] => {
    if (
      !Array.isArray(value) ||
      value.length > EFFECT_IDS.length ||
      new Set(value).size !== value.length ||
      value.some((id) => !EFFECT_IDS.includes(id as EffectId))
    )
      throw new Error('Invalid effect order or bypass list.');
    return [...value] as EffectId[];
  };
  const order = legacy ? defaults.order : list(e.order);
  if (order.length !== EFFECT_IDS.length)
    throw new Error('The effect chain must contain each effect once.');
  const eq = legacy ? defaults.eq : object(e.eq),
    comp = legacy ? defaults.compressor : object(e.compressor);
  return {
    enabled: bool(e.enabled),
    highpass: num(e.highpass, 20, 18000),
    lowpass: num(e.lowpass, 80, 20000),
    distortion: num(e.distortion, 0, 1),
    reverb: num(e.reverb, 0, 1),
    echo: num(e.echo, 0, 1),
    order,
    bypassed: legacy ? defaults.bypassed : list(e.bypassed),
    eq: { low: num(eq.low, -12, 12), mid: num(eq.mid, -12, 12), high: num(eq.high, -12, 12) },
    compressor: {
      threshold: num(comp.threshold, -100, 0),
      ratio: num(comp.ratio, 1, 20),
      knee: num(comp.knee, 0, 40),
      attackMs: num(comp.attackMs, 0, 1000),
      releaseMs: num(comp.releaseMs, 1, 1000),
    },
  };
}
export function validateCleanup(input: unknown, old = false): Cleanup {
  const c = object(input);
  if (!old && c.humHz !== 0 && c.humHz !== 50 && c.humHz !== 60)
    throw new Error('Invalid hum frequency.');
  return {
    dcRemove: old ? false : bool(c.dcRemove),
    humHz: old ? 0 : (c.humHz as 0 | 50 | 60),
    gateEnabled: bool(c.gateEnabled),
    thresholdDb: num(c.thresholdDb, -80, -6),
    attackMs: num(c.attackMs, 0.1, 100),
    releaseMs: num(c.releaseMs, 1, 1000),
    normalize: bool(c.normalize),
  };
}
export function validateProject(input: unknown): Project {
  const p = object(input),
    legacy = p.version === 1;
  const old = legacy || p.version === 2;
  if (!old && p.version !== 3)
    throw new Error(
      'This project version is not supported. Use a VAudioFX version 1, 2 or 3 package.',
    );
  if (!Array.isArray(p.tracks) || p.tracks.length > LIMITS.tracks)
    throw new Error('Invalid track count.');
  const ids = new Set<string>();
  const unique = (v: unknown) => {
    const id = str(v);
    if (ids.has(id)) throw new Error('Duplicate project ID.');
    ids.add(id);
    return id;
  };
  let count = 0;
  const tracks: Track[] = p.tracks.map((value) => {
    const t = object(value);
    if (!Array.isArray(t.clips) || (count += t.clips.length) > LIMITS.clips)
      throw new Error('Too many audio clips.');
    const color = str(t.color);
    if (!/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Invalid track color.');
    return {
      id: unique(t.id),
      name: str(t.name),
      color,
      gain: num(t.gain, 0, 2),
      pan: num(t.pan, -1, 1),
      mute: bool(t.mute),
      solo: bool(t.solo),
      clips: t.clips.map((value) => {
        const c = object(value);
        const clip: Clip = {
          id: unique(c.id),
          assetId: str(c.assetId),
          name: str(c.name),
          start: num(c.start, 0, LIMITS.duration),
          trimStart: num(c.trimStart, 0, LIMITS.duration),
          trimEnd: num(c.trimEnd, 0, LIMITS.duration),
          rate: num(c.rate, 0.25, 4),
          pitchSemitones: old ? 0 : num(c.pitchSemitones, -12, 12),
          automation: old ? emptyAutomation() : validateAutomation(c.automation),
          gain: num(c.gain, 0, 2),
          pan: num(c.pan, -1, 1),
          reverse: bool(c.reverse),
          fadeIn: num(c.fadeIn, 0, 120),
          fadeOut: num(c.fadeOut, 0, 120),
          effects: validateEffects(c.effects, legacy),
          cleanup: legacy ? cleanCleanup() : validateCleanup(c.cleanup, old),
        };
        if (clip.trimEnd <= clip.trimStart || clip.start + clipDuration(clip) > LIMITS.duration)
          throw new Error('Clip duration exceeds the project limit.');
        return clip;
      }),
    };
  });
  const e = object(p.export);
  if (!old && !['wav', 'ogg', 'mp3'].includes(e.format as string))
    throw new Error('Unsupported export format.');
  if ((e.sampleRate !== 44100 && e.sampleRate !== 48000) || (e.channels !== 1 && e.channels !== 2))
    throw new Error('Unsupported export settings.');
  const loop = legacy ? { enabled: false, start: 0, end: 2 } : object(p.loop);
  const loopRegion = {
    enabled: bool(loop.enabled),
    start: num(loop.start, 0, 130),
    end: num(loop.end, 0.05, 130),
  };
  if (loopRegion.end - loopRegion.start < 0.05 - 1e-9)
    throw new Error('Loop regions must be at least 50 ms long.');
  return {
    version: 3,
    id: str(p.id),
    name: str(p.name),
    updatedAt: num(p.updatedAt, 0, Number.MAX_SAFE_INTEGER),
    tracks,
    export: {
      format: old ? 'wav' : (e.format as ExportSettings['format']),
      sampleRate: e.sampleRate,
      channels: e.channels,
      normalize: bool(e.normalize),
      limiter: legacy ? false : bool(e.limiter),
      tail: num(e.tail, 0, 10),
    },
    snap: bool(p.snap),
    zoom: num(p.zoom, 5, 400),
    loop: loopRegion,
  };
}

function validateAutomation(input: unknown): Automation {
  const value = object(input),
    result = emptyAutomation();
  for (const lane of ['gain', 'pan', 'lowpass'] as const) {
    const points = value[lane];
    if (!Array.isArray(points) || points.length > 32)
      throw new Error('Automation needs at most 32 points per lane.');
    let previous = -1;
    result[lane] = points.map((raw) => {
      const p = object(raw),
        time = num(p.time, 0, 1),
        [min, max] = AUTOMATION_BOUNDS[lane];
      if (time <= previous) throw new Error('Automation positions must be unique and increasing.');
      previous = time;
      return { time, value: num(p.value, min, max) };
    });
  }
  return result;
}
