import {
  cleanEffects,
  makeClip,
  makeTrack,
  newProject,
  validateProject,
  type Asset,
  type Clip,
  type Effects,
  type Project,
} from '../domain/model';
import {
  generateSource,
  sourceDefaults,
  type SourceKind,
  type SourceSpec,
} from '../audio/synthesis';

interface LayerPlan {
  name: string;
  source: SourceSpec;
  start: number;
  effects?: Partial<Effects>;
  clip?: Partial<Pick<Clip, 'gain' | 'rate' | 'pan' | 'fadeIn' | 'fadeOut'>>;
  repeats?: number;
  spacing?: number;
}
interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  layers: LayerPlan[];
}
const source = (
  kind: SourceKind,
  duration: number,
  from = 120,
  to = from,
  extra: Partial<SourceSpec> = {},
): SourceSpec => ({ ...sourceDefaults(), kind, duration, from, to, ...extra });
const layer = (
  name: string,
  sound: SourceSpec,
  start = 0,
  effects: Partial<Effects> = {},
  clip: LayerPlan['clip'] = {},
): LayerPlan => ({ name, source: sound, start, effects, clip });
const catalog: Template[] = [
  {
    id: 'zombie',
    name: 'Zombie / Undead Voice',
    category: 'Creature',
    description:
      'A pulsing low rasp and bubbling texture. Synthesized; add your own voice for a personal character.',
    layers: [
      layer(
        'Undead rasp',
        source('sawtooth', 1.6, 80, 43, { pulse: 0.65, pulseHz: 9, shape: 'swell' }),
        0,
        { highpass: 45, lowpass: 1400, distortion: 0.14, reverb: 0.12 },
      ),
      layer(
        'Bubbling texture',
        source('sweep', 1.3, 150, 40, { pulse: 0.95, pulseHz: 13, shape: 'steady' }),
        0.1,
        { lowpass: 1200, reverb: 0.08 },
        { gain: 0.32 },
      ),
      layer(
        'Throat air',
        source('pink', 1.5, 120, 120, { pulse: 0.75, pulseHz: 9, shape: 'swell' }),
        0,
        { highpass: 80, lowpass: 1900 },
        { gain: 0.25 },
      ),
    ],
  },
  {
    id: 'growl',
    name: 'Monster Growl',
    category: 'Creature',
    description: 'A descending buzzy body with rough breathing and deep weight.',
    layers: [
      layer(
        'Growl body',
        source('sawtooth', 1.4, 95, 35, { pulse: 0.4, pulseHz: 18, shape: 'swell' }),
        0,
        { lowpass: 1600, distortion: 0.22, reverb: 0.14 },
      ),
      layer(
        'Rough breath',
        source('pink', 1.2, 120, 120, { shape: 'swell' }),
        0.1,
        { highpass: 100, lowpass: 2400 },
        { gain: 0.35 },
      ),
    ],
  },
  {
    id: 'fireball',
    name: 'Fireball',
    category: 'Magic',
    description: 'A rising rush, sharp impact, and low rumble.',
    layers: [
      layer('Ignition rush', source('white', 0.9, 120, 120, { shape: 'swell' }), 0, {
        highpass: 180,
        lowpass: 4200,
        reverb: 0.12,
      }),
      layer('Impact crack', source('burst', 0.45), 0.68, { lowpass: 5500, distortion: 0.15 }),
      layer('Deep rumble', source('sweep', 1.5, 72, 28), 0.7, { lowpass: 900, reverb: 0.25 }),
    ],
  },
  {
    id: 'projectile',
    name: 'Magic Projectile',
    category: 'Magic',
    description: 'A rising tonal launch, airy motion, and a sparkling echo.',
    layers: [
      layer('Spell lift', source('sweep', 0.7, 180, 1600, { shape: 'swell' }), 0, {
        highpass: 110,
        echo: 0.22,
        reverb: 0.12,
      }),
      layer(
        'Moving air',
        source('white', 0.65, 120, 120, { shape: 'swell' }),
        0.08,
        { highpass: 700, lowpass: 4800 },
        { gain: 0.4 },
      ),
    ],
  },
  {
    id: 'magic-impact',
    name: 'Magical Impact',
    category: 'Magic',
    description: 'A short crack with two descending, ringing partials.',
    layers: [
      layer(
        'Magic crack',
        source('burst', 0.2),
        0,
        { highpass: 400, lowpass: 6000 },
        { gain: 0.6 },
      ),
      layer('Crystal ring', source('sweep', 0.8, 950, 710), 0, { echo: 0.28, reverb: 0.3 }),
      layer(
        'Crystal overtone',
        source('sine', 0.55, 1470),
        0.025,
        { reverb: 0.25 },
        { gain: 0.3, pan: 0.15 },
      ),
    ],
  },
  {
    id: 'explosion',
    name: 'Explosion',
    category: 'Combat',
    description: 'A wide noise blast, bass drop, and lingering debris wash.',
    layers: [
      layer('Blast', source('burst', 0.8), 0, { lowpass: 6000, distortion: 0.18, reverb: 0.15 }),
      layer('Sub drop', source('sweep', 1.8, 100, 25), 0.025, { lowpass: 650, reverb: 0.18 }),
      layer(
        'Debris wash',
        source('pink', 1.6),
        0.12,
        { highpass: 250, lowpass: 3200, reverb: 0.18 },
        { gain: 0.45 },
      ),
    ],
  },
  {
    id: 'sword',
    name: 'Sword Impact',
    category: 'Combat',
    description: 'A fast air cut, contact crack, and metallic ring.',
    layers: [
      layer(
        'Blade whoosh',
        source('white', 0.22, 120, 120, { shape: 'swell' }),
        0,
        { highpass: 800, lowpass: 5200 },
        { gain: 0.5 },
      ),
      layer('Blade contact', source('burst', 0.15), 0.16, {
        highpass: 400,
        lowpass: 7000,
        distortion: 0.12,
      }),
      layer(
        'Metal ring',
        source('square', 0.55, 1800, 1600),
        0.16,
        { highpass: 900, lowpass: 5500, reverb: 0.2 },
        { gain: 0.25 },
      ),
    ],
  },
  {
    id: 'footsteps',
    name: 'Footsteps',
    category: 'Movement',
    description: 'Four evenly spaced synthesized sole thuds and gritty contacts.',
    layers: [
      {
        ...layer('Sole thud', source('sweep', 0.16, 150, 45), 0, { lowpass: 800 }, { gain: 0.7 }),
        repeats: 4,
        spacing: 0.45,
      },
      {
        ...layer(
          'Ground contact',
          source('burst', 0.12),
          0.015,
          { highpass: 600, lowpass: 4500 },
          { gain: 0.4 },
        ),
        repeats: 4,
        spacing: 0.45,
      },
    ],
  },
  {
    id: 'whisper',
    name: 'Ghostly Whisper',
    category: 'Creature',
    description:
      'A breath-like synthesized wash and faint eerie tone. Layer a whispered recording for words.',
    layers: [
      layer(
        'Ghost breath',
        source('pink', 2.2, 120, 120, { shape: 'swell', pulse: 0.3, pulseHz: 3 }),
        0,
        { highpass: 650, lowpass: 6500, reverb: 0.45, echo: 0.2 },
      ),
      layer(
        'Spectral tone',
        source('sweep', 2, 370, 460, { shape: 'swell' }),
        0.1,
        { reverb: 0.4 },
        { gain: 0.18 },
      ),
    ],
  },
  {
    id: 'ui',
    name: 'UI Click',
    category: 'Interface',
    description: 'A tiny clean tone with a crisp, low-level contact tick.',
    layers: [
      layer('UI tone', source('sine', 0.09, 900), 0, { lowpass: 6000 }, { gain: 0.5 }),
      layer('UI tick', source('burst', 0.05), 0, { highpass: 1800, lowpass: 7000 }, { gain: 0.15 }),
    ],
  },
  {
    id: 'laser',
    name: 'Sci-Fi Laser',
    category: 'Sci-Fi',
    description: 'A descending electronic spark with an airy, echoing tail.',
    layers: [
      layer('Descending spark', source('sweep', 0.55, 1800, 140), 0, { echo: 0.5, reverb: 0.15 }),
      layer('Air burst', source('burst', 0.3), 0, { highpass: 2000, lowpass: 8500 }),
    ],
  },
  {
    id: 'wind',
    name: 'Ambient Wind',
    category: 'Ambience',
    description: 'A warm noise swell with quiet upper air and a diffuse room tail.',
    layers: [
      layer('Wind swell', source('pink', 5, 120, 120, { shape: 'swell' }), 0, {
        highpass: 100,
        lowpass: 1100,
        reverb: 0.2,
      }),
      layer(
        'Upper air',
        source('white', 5, 120, 120, { shape: 'swell' }),
        0,
        { highpass: 1200, lowpass: 3600 },
        { gain: 0.12, pan: -0.2 },
      ),
    ],
  },
];
export const templates = catalog.map(({ id, name, description, category, layers }) => ({
  id,
  name,
  description,
  category,
  type: layers.length + ' layers',
}));
export async function createTemplate(id: string): Promise<{ project: Project; assets: Asset[] }> {
  const definition = catalog.find((t) => t.id === id);
  if (!definition) throw new Error('Unknown sound template.');
  const project = newProject(definition.name),
    assets: Asset[] = [];
  project.tracks = [];
  project.export.tail = definition.layers.some((l) => l.effects?.echo) ? 2.2 : 1.5;
  for (const plan of definition.layers) {
    const asset = await generateSource(
        { ...plan.source, seed: plan.source.seed + assets.length * 7919 },
        plan.name,
      ),
      track = makeTrack(assets.length);
    assets.push(asset);
    track.name = plan.name;
    for (let n = 0; n < (plan.repeats ?? 1); n++) {
      const clip = { ...makeClip(asset, plan.start + n * (plan.spacing ?? 0)), ...plan.clip };
      clip.effects = { ...cleanEffects(), ...plan.effects };
      track.clips.push(clip);
    }
    project.tracks.push(track);
  }
  return { project: validateProject(project), assets };
}
