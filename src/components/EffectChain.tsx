import { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, RotateCcw } from 'lucide-react';
import { cleanEffects, uid, type Effects, type EffectId } from '../domain/model';
import { loadPresets, savePresets, type ChainPreset } from '../storage/presets';
import { Button, NumberField, Range } from './ui';

const names: Record<EffectId, string> = {
  highpass: 'Remove rumble',
  lowpass: 'Darken',
  eq: 'Tone balance',
  distortion: 'Distortion',
  compressor: 'Even out loudness',
  reverb: 'Room reverb',
  echo: 'Echo',
};

export function EffectChain({
  effects,
  onChange,
}: {
  effects: Effects;
  onChange: (effects: Effects) => void;
}) {
  const [presets, setPresets] = useState<ChainPreset[]>([]),
    [selected, setSelected] = useState(''),
    [name, setName] = useState('My effect chain'),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void loadPresets()
      .then((value) => {
        if (active) {
          setPresets(value);
          setReady(true);
        }
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : 'Could not load presets.');
      });
    return () => {
      active = false;
    };
  }, []);
  const write = async (next: ChainPreset[], id: string) => {
    setBusy(true);
    setNotice('');
    try {
      setPresets(await savePresets(next));
      setSelected(id);
      setNotice('Presets saved in this browser.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Preset save failed.');
    } finally {
      setBusy(false);
    }
  };
  const create = (copy?: ChainPreset) => {
    const id = uid();
    void write(
      [
        ...presets,
        {
          id,
          name: copy ? `${copy.name.slice(0, 75)} copy` : name.trim(),
          effects: copy?.effects ?? effects,
        },
      ],
      id,
    );
  };
  const move = (index: number, direction: number) => {
    const order = [...effects.order];
    [order[index], order[index + direction]] = [order[index + direction], order[index]];
    onChange({ ...effects, order });
  };
  const preset = presets.find((p) => p.id === selected);
  return (
    <section className="effect-chain">
      <h3>Effect chain</h3>
      <p className="help">
        Sound passes through enabled effects from top to bottom. Moving an effect changes the
        result.
      </p>
      <ol className={effects.enabled ? 'chain-list' : 'chain-list bypassed'}>
        {effects.order.map((id, index) => (
          <li key={id}>
            <label className="check-control">
              <input
                type="checkbox"
                aria-label={`Enable ${names[id]}`}
                checked={!effects.bypassed.includes(id)}
                onChange={(e) =>
                  onChange({
                    ...effects,
                    bypassed: e.target.checked
                      ? effects.bypassed.filter((value) => value !== id)
                      : [...effects.bypassed, id],
                  })
                }
              />
              {names[id]}
            </label>
            <div className="chain-actions">
              <Button
                label={`Move ${names[id]} earlier`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={12} />
              </Button>
              <Button
                label={`Move ${names[id]} later`}
                disabled={index === effects.order.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={12} />
              </Button>
              <Button
                label={`Reset ${names[id]}`}
                onClick={() => onChange({ ...effects, [id]: cleanEffects()[id] })}
              >
                <RotateCcw size={12} />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <details className="advanced">
        <summary>Tone balance · three-band EQ</summary>
        {(['low', 'mid', 'high'] as const).map((band) => (
          <Range
            key={band}
            label={`${band === 'low' ? 'Weight' : band === 'mid' ? 'Presence' : 'Brightness'} (${band === 'low' ? '180' : band === 'mid' ? '1,000' : '4,500'} Hz)`}
            min={-12}
            max={12}
            step={0.5}
            value={effects.eq[band]}
            display={`${effects.eq[band]} dB`}
            onChange={(value) => onChange({ ...effects, eq: { ...effects.eq, [band]: value } })}
          />
        ))}
        <p className="help">
          Low/high shelves and a broad middle band. Enable Tone balance in the chain to hear these
          changes.
        </p>
      </details>
      <details className="advanced">
        <summary>Even out loudness · compressor</summary>
        <p className="help">
          Reduces differences between loud and quiet parts. Enable it in the chain, then lower the
          threshold for stronger control.
        </p>
        <Range
          label="Compression threshold"
          min={-100}
          max={0}
          value={effects.compressor.threshold}
          display={`${effects.compressor.threshold} dB`}
          onChange={(threshold) =>
            onChange({ ...effects, compressor: { ...effects.compressor, threshold } })
          }
        />
        <div className="number-grid">
          <NumberField
            label="Ratio (:1)"
            min={1}
            max={20}
            step={0.5}
            value={effects.compressor.ratio}
            onChange={(ratio) =>
              onChange({ ...effects, compressor: { ...effects.compressor, ratio } })
            }
          />
          <NumberField
            label="Knee (dB)"
            min={0}
            max={40}
            step={1}
            value={effects.compressor.knee}
            onChange={(knee) =>
              onChange({ ...effects, compressor: { ...effects.compressor, knee } })
            }
          />
          <NumberField
            label="Attack (ms)"
            min={0}
            max={1000}
            step={1}
            value={effects.compressor.attackMs}
            onChange={(attackMs) =>
              onChange({ ...effects, compressor: { ...effects.compressor, attackMs } })
            }
          />
          <NumberField
            label="Release (ms)"
            min={1}
            max={1000}
            step={1}
            value={effects.compressor.releaseMs}
            onChange={(releaseMs) =>
              onChange({ ...effects, compressor: { ...effects.compressor, releaseMs } })
            }
          />
        </div>
      </details>
      <details className="advanced">
        <summary>Your effect-chain presets</summary>
        <label className="preset-field">
          Saved chain
          <select
            aria-label="Saved effect chain"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              const p = presets.find((value) => value.id === e.target.value);
              if (p) setName(p.name);
            }}
          >
            <option value="">Choose a chain</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="preset-field">
          Preset name
          <input
            aria-label="Preset name"
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="preset-actions">
          <Button
            disabled={!preset || busy}
            onClick={() => {
              if (preset) {
                onChange(preset.effects);
                setNotice(`Loaded ${preset.name}.`);
              }
            }}
          >
            Load chain
          </Button>
          <Button
            disabled={!ready || busy || !name.trim() || presets.length >= 128}
            onClick={() => create()}
          >
            Save new chain
          </Button>
          <Button
            disabled={!preset || busy || !name.trim()}
            onClick={() =>
              void write(
                presets.map((p) => (p.id === selected ? { ...p, name: name.trim(), effects } : p)),
                selected,
              )
            }
          >
            Update chain
          </Button>
          <Button
            disabled={!preset || busy || presets.length >= 128}
            onClick={() => {
              if (preset) create(preset);
            }}
          >
            Duplicate chain
          </Button>
          <Button
            disabled={!preset || busy}
            onClick={() =>
              void write(
                presets.filter((p) => p.id !== selected),
                '',
              )
            }
          >
            Delete chain
          </Button>
        </div>
        <p className="help">
          Presets store effect order, bypass, and parameters. Timing, pitch, and cleanup stay with
          each clip.
        </p>
        {notice && (
          <p className="help" role="status">
            {notice}
          </p>
        )}
      </details>
    </section>
  );
}
