import { validateEffects, type Effects } from '../domain/model';
import { database } from './database';

export interface ChainPreset {
  id: string;
  name: string;
  effects: Effects;
}
export function validatePresets(input: unknown): ChainPreset[] {
  if (!Array.isArray(input) || input.length > 128)
    throw new Error('Invalid local preset collection.');
  const ids = new Set<string>();
  return input.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Invalid local preset.');
    const { id, name, effects } = value as Record<string, unknown>;
    if (
      typeof id !== 'string' ||
      !id.length ||
      id.length > 200 ||
      ids.has(id) ||
      typeof name !== 'string' ||
      !name.trim() ||
      name.length > 80
    )
      throw new Error('Invalid preset name or ID.');
    ids.add(id);
    return { id, name: name.trim(), effects: validateEffects(effects) };
  });
}
export async function loadPresets(): Promise<ChainPreset[]> {
  const value = await database.get<unknown>('settings', 'effectChainPresets-v2');
  return value === undefined ? [] : validatePresets(value);
}
export async function savePresets(presets: ChainPreset[]): Promise<ChainPreset[]> {
  const validated = validatePresets(presets);
  await database.setting('effectChainPresets-v2', validated);
  return validated;
}
