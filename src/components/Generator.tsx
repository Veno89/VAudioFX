import { useEffect, useRef, useState } from 'react';
import { sourceKinds, sourceDefaults, type SourceSpec } from '../audio/synthesis';
import { Button, Modal, NumberField, Range } from './ui';

export function Generator({
  hasTrack,
  onCreate,
  onClose,
}: {
  hasTrack: boolean;
  onCreate: (spec: SourceSpec, name: string, newLayer: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const [spec, setSpec] = useState(sourceDefaults),
    [name, setName] = useState('Generated sweep'),
    [newLayer, setNewLayer] = useState(true),
    [working, setWorking] = useState(false),
    [error, setError] = useState('');
  const noise = ['white', 'pink', 'burst'].includes(spec.kind);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const create = async () => {
    if (working) return;
    setWorking(true);
    setError('');
    try {
      if ((await onCreate(spec, name, newLayer)) && alive.current) onClose();
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'Could not create this sound.');
    } finally {
      if (alive.current) setWorking(false);
    }
  };
  return (
    <Modal title="Generate a sound" onClose={onClose}>
      <div className="dialog-body generator">
        <p>
          Create a reusable original locally. It is saved as a WAV source, placed at the playhead,
          and can be trimmed, processed, backed up, and exported like any recording.
        </p>
        <fieldset disabled={working}>
          <label className="field">
            Source
            <select
              aria-label="Generator source"
              value={spec.kind}
              onChange={(e) => {
                const kind = e.target.value as SourceSpec['kind'];
                setSpec({ ...spec, kind, to: kind === 'sweep' ? spec.to : spec.from });
                setName('Generated ' + sourceKinds.find((k) => k.id === kind)!.name.toLowerCase());
              }}
            >
              {sourceKinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
          <p className="help">{sourceKinds.find((k) => k.id === spec.kind)?.description}</p>
          <label className="field">
            Sound name
            <input
              aria-label="Generated sound name"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <NumberField
            label="Generator duration (s)"
            value={spec.duration}
            min={0.05}
            max={10}
            step={0.05}
            onChange={(duration) => setSpec({ ...spec, duration })}
          />
          {!noise && (
            <div className="number-grid">
              <NumberField
                label="Start frequency (Hz)"
                value={spec.from}
                min={20}
                max={10000}
                step={10}
                onChange={(from) =>
                  setSpec({ ...spec, from, to: spec.kind === 'sweep' ? spec.to : from })
                }
              />
              {spec.kind === 'sweep' && (
                <NumberField
                  label="End frequency (Hz)"
                  value={spec.to}
                  min={20}
                  max={10000}
                  step={10}
                  onChange={(to) => setSpec({ ...spec, to })}
                />
              )}
            </div>
          )}
          {spec.kind !== 'burst' && (
            <label className="field">
              Shape
              <select
                aria-label="Generator shape"
                value={spec.shape}
                onChange={(e) => setSpec({ ...spec, shape: e.target.value as SourceSpec['shape'] })}
              >
                <option value="hit">Decaying hit</option>
                <option value="swell">Soft swell</option>
                <option value="steady">Steady, with soft edges</option>
              </select>
            </label>
          )}
          <Range
            label="Pulsing texture"
            value={spec.pulse}
            min={0}
            max={1}
            step={0.05}
            display={`${Math.round(spec.pulse * 100)}%`}
            help="Adds regular changes in loudness for tremble and bubbling textures."
            onChange={(pulse) => setSpec({ ...spec, pulse })}
          />
          {spec.pulse > 0 && (
            <NumberField
              label="Pulses per second"
              value={spec.pulseHz}
              min={1}
              max={30}
              step={1}
              onChange={(pulseHz) => setSpec({ ...spec, pulseHz })}
            />
          )}
          {noise && (
            <NumberField
              label="Noise variation"
              value={spec.seed}
              min={0}
              max={4294967295}
              step={1}
              onChange={(seed) => setSpec({ ...spec, seed })}
            />
          )}
          <label className="field">
            Placement
            <select
              aria-label="Generated sound placement"
              value={newLayer ? 'new' : 'selected'}
              onChange={(e) => setNewLayer(e.target.value === 'new')}
            >
              <option value="new">New layer</option>
              {hasTrack && <option value="selected">Selected layer</option>}
            </select>
          </label>
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <Button onClick={onClose} disabled={working}>
            Cancel
          </Button>
          <Button
            className="primary"
            onClick={() => void create()}
            disabled={working || !name.trim()}
          >
            {working ? 'Generating sound…' : 'Create and add sound'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
