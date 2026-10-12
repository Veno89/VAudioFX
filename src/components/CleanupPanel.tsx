import { cleanCleanup, type Cleanup } from '../domain/model';
import { Button, NumberField, Range } from './ui';

export function CleanupPanel({
  cleanup,
  onChange,
  onTrim,
  busy,
}: {
  cleanup: Cleanup;
  onChange: (cleanup: Cleanup) => void;
  onTrim: () => void;
  busy: boolean;
}) {
  return (
    <section>
      <h3>Clean up the source</h3>
      <label className="check-control">
        <input
          type="checkbox"
          checked={cleanup.dcRemove}
          onChange={(e) => onChange({ ...cleanup, dcRemove: e.target.checked })}
        />
        Remove DC offset
      </label>
      <label className="field">
        Electrical hum
        <select
          aria-label="Hum removal"
          value={cleanup.humHz}
          onChange={(e) => onChange({ ...cleanup, humHz: Number(e.target.value) as 0 | 50 | 60 })}
        >
          <option value={0}>Off</option>
          <option value={50}>50 Hz + harmonics</option>
          <option value={60}>60 Hz + harmonics</option>
        </select>
      </label>
      <p className="help">
        Narrow filters reduce mains hum and its next two harmonics. Nearby bass tones can also
        change.
      </p>
      <Range
        label="Cleanup threshold"
        min={-80}
        max={-6}
        step={1}
        value={cleanup.thresholdDb}
        display={`${cleanup.thresholdDb} dB`}
        onChange={(thresholdDb) => onChange({ ...cleanup, thresholdDb })}
        help="Lower keeps quieter details. Used by silence trim and the noise gate."
      />
      <Button onClick={onTrim} disabled={busy}>
        {busy ? 'Finding sound…' : 'Trim quiet edges'}
      </Button>
      <label className="check-control">
        <input
          type="checkbox"
          checked={cleanup.gateEnabled}
          onChange={(e) => onChange({ ...cleanup, gateEnabled: e.target.checked })}
        />
        Noise gate
      </label>
      <p className="help">
        Quiets background noise between sounds. Noise during speech remains; raise the threshold
        carefully.
      </p>
      <label className="check-control">
        <input
          type="checkbox"
          checked={cleanup.normalize}
          onChange={(e) => onChange({ ...cleanup, normalize: e.target.checked })}
        />
        Normalize source region to −1 dB
      </label>
      <details className="advanced">
        <summary>Gate response</summary>
        <div className="number-grid">
          <NumberField
            label="Gate attack (ms)"
            min={0.1}
            max={100}
            step={1}
            value={cleanup.attackMs}
            onChange={(attackMs) => onChange({ ...cleanup, attackMs })}
          />
          <NumberField
            label="Gate release (ms)"
            min={1}
            max={1000}
            step={1}
            value={cleanup.releaseMs}
            onChange={(releaseMs) => onChange({ ...cleanup, releaseMs })}
          />
        </div>
      </details>
      <Button onClick={() => onChange(cleanCleanup())}>Reset cleanup</Button>
      <p className="help">
        Cleanup precedes fades and effects. The original recording is preserved. Undo restores a
        trim.
      </p>
    </section>
  );
}
