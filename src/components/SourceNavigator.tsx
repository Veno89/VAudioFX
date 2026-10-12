import { useState } from 'react';
import { clipDuration, type Asset, type Clip } from '../domain/model';
import { Waveform } from './Waveform';
import { Button, NumberField } from './ui';

export function SourceNavigator({
  asset,
  clip,
  position,
  onSeek,
}: {
  asset: Asset;
  clip: Clip;
  position: number;
  onSeek: (time: number) => void;
}) {
  const [zoom, setZoom] = useState(1),
    [center, setCenter] = useState(0.5);
  const duration = clipDuration(clip),
    span = 1 / zoom,
    from = Math.max(0, Math.min(1 - span, center - span / 2));
  const to = from + span,
    sourceSpan = clip.trimEnd - clip.trimStart;
  const start = clip.reverse ? clip.trimEnd - to * sourceSpan : clip.trimStart + from * sourceSpan;
  const end = start + span * sourceSpan,
    progress = (position - clip.start) / duration;
  return (
    <details className="advanced source-navigation">
      <summary>Waveform navigation</summary>
      <div className="wave-navigation-actions">
        <Button
          label="Zoom source waveform in"
          disabled={zoom >= 32}
          onClick={() => setZoom(Math.min(32, zoom * 2))}
        >
          Zoom in
        </Button>
        <Button
          label="Zoom source waveform out"
          disabled={zoom <= 1}
          onClick={() => setZoom(Math.max(1, zoom / 2))}
        >
          Zoom out
        </Button>
        <Button
          onClick={() => {
            setZoom(1);
            setCenter(0.5);
          }}
        >
          Fit region
        </Button>
      </div>
      <button
        className="source-wave-seek"
        aria-label="Seek within source waveform"
        onClick={(e) => {
          if (e.detail === 0) {
            onSeek(clip.start + (from + span / 2) * duration);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek(
            clip.start +
              (from + Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * span) *
                duration,
          );
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            onSeek(
              Math.max(
                clip.start,
                Math.min(
                  clip.start + duration,
                  position + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.05 : 0.01),
                ),
              ),
            );
          }
        }}
      >
        <Waveform asset={asset} start={start} end={end} reverse={clip.reverse} />
        {progress >= from && progress <= to && (
          <span
            className="source-playhead"
            style={{ left: `${((progress - from) / span) * 100}%` }}
          />
        )}
      </button>
      <NumberField
        label="Waveform center (%)"
        min={0}
        max={100}
        step={1}
        value={center * 100}
        onChange={(v) => setCenter(v / 100)}
      />
      <NumberField
        label="Seek within clip (s)"
        min={0}
        max={duration}
        step={0.001}
        value={Math.max(0, Math.min(duration, position - clip.start))}
        onChange={(v) => onSeek(clip.start + v)}
      />
      <small>
        {zoom}× · source {start.toFixed(3)}–{end.toFixed(3)}s · arrows seek 10 ms, Shift 50 ms
      </small>
    </details>
  );
}
