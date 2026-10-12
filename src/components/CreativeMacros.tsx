import { useState } from 'react';
import { cleanEffects, type Clip } from '../domain/model';
import {
  creativePresets,
  macroPatch,
  macroValue,
  presetPatch,
  type CreativePreset,
  type Macro,
} from '../features/creative';
import { Button, Range } from './ui';

const macros: { id: Macro; label: string; help: string }[] = [
  {
    id: 'size',
    label: 'Character size',
    help: 'Larger is deeper, longer, and heavier. Pitch and duration change together.',
  },
  {
    id: 'aggression',
    label: 'Aggression',
    help: 'Adds saturation and compression for a rougher, denser sound.',
  },
  {
    id: 'brightness',
    label: 'Character brightness',
    help: 'Opens the low-pass filter and raises the high-frequency EQ.',
  },
  {
    id: 'space',
    label: 'Room size',
    help: 'Blends room reverb and a quiet echo. Allow a 2.2-second export tail.',
  },
];
export function CreativeMacros({
  clip,
  onChange,
}: {
  clip: Clip;
  onChange: (patch: Partial<Clip>) => void;
}) {
  const [preset, setPreset] = useState<CreativePreset>('creature');
  return (
    <details className="advanced creative-macros">
      <summary>Creative presets & macros</summary>
      <label className="field">
        Starting character
        <select
          aria-label="Creative preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value as CreativePreset)}
        >
          {creativePresets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <p className="help">{creativePresets.find((p) => p.id === preset)?.help}</p>
      <Button onClick={() => onChange(presetPatch(preset))}>Apply creative preset</Button>
      <Button onClick={() => onChange({ rate: 1, gain: 0.8, effects: cleanEffects() })}>
        Reset character
      </Button>
      {macros.map((m) => (
        <Range
          key={m.id}
          label={m.label}
          value={macroValue(clip, m.id)}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(macroValue(clip, m.id) * 100)}%`}
          help={m.help}
          onChange={(value) => onChange(macroPatch(clip, m.id, value))}
        />
      ))}
      <p className="help">
        Macros set related parameters together and enable the effects they use. Fine-tune them
        below, save a custom chain, or undo the edit. Reset character restores standard speed, gain,
        and effects.
      </p>
    </details>
  );
}
