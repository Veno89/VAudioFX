import { useEffect, useMemo, useState } from 'react';
import type { Asset } from '../domain/model';
import { assetRepository } from '../audio/assets';
import { peaksForRegion } from '../audio/waveform';

export function Waveform({
  asset,
  start = 0,
  end,
  reverse = false,
}: {
  asset: Asset;
  start?: number;
  end?: number;
  reverse?: boolean;
}) {
  const [buffer, setBuffer] = useState<AudioBuffer>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    setBuffer(undefined);
    void assetRepository
      .decode(asset)
      .then((audio) => {
        if (active) setBuffer(audio);
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'Waveform unavailable');
      });
    return () => {
      active = false;
    };
  }, [asset.id]);
  const peaks = useMemo(
    () => (buffer ? peaksForRegion(buffer, start, end ?? buffer.duration, 180, reverse) : []),
    [buffer, start, end, reverse],
  );
  if (error)
    return (
      <span className="waveform-message" title={error}>
        Audio unavailable
      </span>
    );
  if (!buffer) return <span className="waveform-message">Decoding audio…</span>;
  return (
    <svg
      className="waveform"
      viewBox="0 0 540 60"
      preserveAspectRatio="none"
      role="img"
      aria-label={`Source waveform for ${asset.name}`}
    >
      <path d="M0 30H540" className="waveform-baseline" />
      {peaks.map((peak, i) => (
        <line
          key={i}
          x1={i * 3 + 1}
          x2={i * 3 + 1}
          y1={30 - peak * 28}
          y2={30 + peak * 28}
          stroke="currentColor"
          strokeWidth="1.6"
        />
      ))}
    </svg>
  );
}
