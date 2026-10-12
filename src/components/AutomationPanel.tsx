import { useState } from 'react';
import { AUTOMATION_BOUNDS, automationAt, type AutomationLane } from '../domain/automation';
import { clipDuration, type Clip } from '../domain/model';
import { Button, NumberField } from './ui';

export function AutomationPanel({
  clip,
  position,
  onChange,
}: {
  clip: Clip;
  position: number;
  onChange: (patch: Partial<Clip>) => void;
}) {
  const [lane, setLane] = useState<AutomationLane>('gain');
  const points = clip.automation[lane],
    [min, max] = AUTOMATION_BOUNDS[lane];
  const fallback = lane === 'gain' ? 1 : lane === 'pan' ? clip.pan : clip.effects.lowpass;
  const time =
    Math.round(Math.max(0, Math.min(1, (position - clip.start) / clipDuration(clip))) * 1000) /
    1000;
  const update = (next: typeof points) =>
    onChange({
      automation: { ...clip.automation, [lane]: [...next].sort((a, b) => a.time - b.time) },
    });
  return (
    <details className="advanced automation-panel">
      <summary>Parameter automation</summary>
      <label className="field">
        Automate
        <select
          aria-label="Automation parameter"
          value={lane}
          onChange={(e) => setLane(e.target.value as AutomationLane)}
        >
          <option value="gain">Loudness multiplier</option>
          <option value="pan">Left / right</option>
          <option value="lowpass">Low-pass frequency (Hz)</option>
        </select>
      </label>
      <p className="help">
        Points follow the played region from 0–100%, with straight ramps between points. Trimming
        and speed changes rescale them. Splitting preserves the curve. Low-pass automation requires
        that effect to be on.
      </p>
      {points.length > 0 && (
        <svg
          className="automation-curve"
          viewBox="0 0 200 60"
          role="img"
          aria-label={`${lane} automation curve`}
        >
          <polyline
            points={[
              { time: 0, value: automationAt(points, 0, fallback) },
              ...points,
              { time: 1, value: automationAt(points, 1, fallback) },
            ]
              .map((p) => `${p.time * 200},${55 - ((p.value - min) / (max - min)) * 50}`)
              .join(' ')}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          {points.map((p) => (
            <circle
              key={p.time}
              cx={p.time * 200}
              cy={55 - ((p.value - min) / (max - min)) * 50}
              r="3"
              fill="currentColor"
            />
          ))}
        </svg>
      )}
      {points.map((point, index) => (
        <div className="automation-point" key={index}>
          <NumberField
            label={`Point ${index + 1} position (%)`}
            value={point.time * 100}
            min={index ? points[index - 1].time * 100 + 0.1 : 0}
            max={index + 1 < points.length ? points[index + 1].time * 100 - 0.1 : 100}
            step={0.1}
            onChange={(v) =>
              update(points.map((p, i) => (i === index ? { ...p, time: v / 100 } : p)))
            }
          />
          <NumberField
            label={`Point ${index + 1} value`}
            value={point.value}
            min={min}
            max={max}
            step={lane === 'lowpass' ? 10 : 0.05}
            onChange={(v) => update(points.map((p, i) => (i === index ? { ...p, value: v } : p)))}
          />
          <Button
            label={`Remove point ${index + 1}`}
            onClick={() => update(points.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <div className="wave-navigation-actions">
        <Button
          disabled={points.length >= 32 || points.some((p) => Math.abs(p.time - time) < 0.001)}
          onClick={() => update([...points, { time, value: automationAt(points, time, fallback) }])}
        >
          Add point at playhead
        </Button>
        <Button disabled={!points.length} onClick={() => update([])}>
          Clear lane
        </Button>
      </div>
      <small>
        {points.length}/32 points · playhead at {(time * 100).toFixed(1)}%
      </small>
    </details>
  );
}
