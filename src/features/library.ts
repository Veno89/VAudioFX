import manifest from './sample-manifest.json';
import type { Asset } from '../domain/model';

export const builtinSamples: Asset[] = manifest.map((sample) => ({ ...sample, kind: 'builtin' }));
export const PACKS = [
  {
    id: 'impact',
    name: 'Impacts & footsteps',
    description: 'Metal, wood, glass, surfaces, and footsteps.',
  },
  { id: 'rpg', name: 'RPG foley', description: 'Blades, books, coins, cloth, and doors.' },
];
export const starterIds = builtinSamples
  .filter((sample, i) => i % 13 === 0 || /chop|knifeSlice|doorOpen|bookClose/.test(sample.id))
  .map((a) => a.id);
