import { SlidersHorizontal, RotateCcw, WandSparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  cleanEffects,
  clipDuration,
  dbToGain,
  gainToDb,
  type Asset,
  type Clip,
  type Project,
  type Track,
} from '../domain/model';
import { Button, NumberField, Range } from './ui';
import { Waveform } from './Waveform';
import { EffectChain } from './EffectChain';
import { CleanupPanel } from './CleanupPanel';
import { CreativeMacros } from './CreativeMacros';
import { AutomationPanel } from './AutomationPanel';
import { SourceNavigator } from './SourceNavigator';
import { presetPatch } from '../features/creative';

export function Inspector({
  clip,
  track,
  asset,
  project,
  onClip,
  onTrack,
  onProject,
  onDeleteTrack,
  onTrimSilence,
  cleanupBusy,
  onRepeat,
  position,
  onSeek,
}: {
  clip?: Clip;
  track?: Track;
  asset?: Asset;
  project: Project;
  onClip: (patch: Partial<Clip>) => void;
  onTrack: (patch: Partial<Track>) => void;
  onProject: (project: Project) => void;
  onDeleteTrack: () => void;
  onTrimSilence: () => void;
  cleanupBusy: boolean;
  onRepeat: (total: number) => void;
  position: number;
  onSeek: (time: number) => void;
}) {
  const [repeatCount, setRepeatCount] = useState(3);
  const effect = (patch: Partial<Clip['effects']>) => {
    if (clip) onClip({ effects: { ...clip.effects, ...patch } });
  };
  const creature = () => {
    if (clip) onClip(presetPatch('creature'));
  };
  return (
    <aside className="inspector panel" aria-label="Inspector">
      <div className="panel-heading">
        <h2>Inspector</h2>
        <SlidersHorizontal size={15} />
      </div>
      <div className="inspector-scroll">
        {clip ? (
          <>
            <div className="selection-title">
              <span className="eyebrow">SELECTED CLIP</span>
              <input
                aria-label="Clip name"
                value={clip.name}
                onChange={(event) => onClip({ name: event.target.value || 'Clip' })}
                maxLength={80}
              />
              <small>
                {clipDuration(clip).toFixed(3)} seconds ·{' '}
                {asset?.kind === 'recording'
                  ? 'Your recording'
                  : asset?.kind === 'import'
                    ? 'Imported audio'
                    : asset?.category === 'Synthesis' && asset.tags.includes('procedural')
                      ? 'Generated audio'
                      : 'Library sound'}
              </small>
            </div>
            {asset && (
              <div className="inspector-wave">
                <Waveform
                  asset={asset}
                  start={clip.trimStart}
                  end={clip.trimEnd}
                  reverse={clip.reverse}
                />
                <small>Source waveform · effects heard in preview</small>
              </div>
            )}
            <section>
              <h3>Shape your sound</h3>
              <Button className="preset-button" onClick={creature}>
                <WandSparkles size={15} /> Creature voice <span>Apply</span>
              </Button>
              <CreativeMacros clip={clip} onChange={onClip} />
              <Range
                label="Loudness"
                value={gainToDb(clip.gain)}
                min={-40}
                max={6}
                step={0.5}
                display={`${gainToDb(clip.gain).toFixed(1)} dB`}
                onChange={(value) => onClip({ gain: dbToGain(value) })}
              />
              <Range
                label="Depth / speed"
                value={12 * Math.log2(clip.rate)}
                min={-24}
                max={24}
                step={1}
                display={`${(12 * Math.log2(clip.rate)).toFixed(0)} st`}
                help="Lower is deeper and longer. Pitch and speed change together."
                onChange={(value) => onClip({ rate: 2 ** (value / 12) })}
              />
              <Range
                label="Left / right"
                value={clip.pan}
                min={-1}
                max={1}
                step={0.05}
                display={
                  clip.pan === 0
                    ? 'Center'
                    : `${Math.round(Math.abs(clip.pan) * 100)}% ${clip.pan < 0 ? 'L' : 'R'}`
                }
                onChange={(value) => onClip({ pan: value })}
              />
              <Range
                label="Independent pitch"
                value={clip.pitchSemitones}
                min={-12}
                max={12}
                step={1}
                display={`${clip.pitchSemitones > 0 ? '+' : ''}${clip.pitchSemitones} st`}
                help="Changes pitch while preserving the clip length. Large shifts can color voices and soften transients."
                onChange={(pitchSemitones) => onClip({ pitchSemitones })}
              />
              <label className="check-control">
                <input
                  type="checkbox"
                  checked={clip.reverse}
                  onChange={(event) => onClip({ reverse: event.target.checked })}
                />{' '}
                Play in reverse
              </label>
            </section>
            {asset && (
              <SourceNavigator
                key={clip.id}
                asset={asset}
                clip={clip}
                position={position}
                onSeek={onSeek}
              />
            )}
            <AutomationPanel clip={clip} position={position} onChange={onClip} />
            <section>
              <h3>Timing & fades</h3>
              <div className="number-grid">
                <NumberField
                  label="Position (s)"
                  value={clip.start}
                  min={0}
                  max={120 - clipDuration(clip)}
                  onChange={(value) => onClip({ start: value })}
                />
                <NumberField
                  label="Fade in (s)"
                  value={clip.fadeIn}
                  min={0}
                  max={clipDuration(clip)}
                  onChange={(value) => onClip({ fadeIn: value })}
                />
                <NumberField
                  label="Source in (s)"
                  value={clip.trimStart}
                  min={0}
                  max={clip.trimEnd - 0.01}
                  onChange={(value) => onClip({ trimStart: value })}
                />
                <NumberField
                  label="Source out (s)"
                  value={clip.trimEnd}
                  min={clip.trimStart + 0.01}
                  max={asset?.duration ?? clip.trimEnd}
                  onChange={(value) => onClip({ trimEnd: value })}
                />
                <NumberField
                  label="Fade out (s)"
                  value={clip.fadeOut}
                  min={0}
                  max={clipDuration(clip)}
                  onChange={(value) => onClip({ fadeOut: value })}
                />
              </div>
              <div className="repeat-controls">
                <NumberField
                  label="Total repetitions"
                  min={2}
                  max={16}
                  step={1}
                  value={repeatCount}
                  onChange={(value) => setRepeatCount(Math.round(value))}
                />
                <Button onClick={() => onRepeat(repeatCount)}>Repeat clip</Button>
              </div>
            </section>
            <CleanupPanel
              cleanup={clip.cleanup}
              onChange={(cleanup) => onClip({ cleanup })}
              onTrim={onTrimSilence}
              busy={cleanupBusy}
            />
            <section>
              <div className="section-title">
                <h3>Texture & space</h3>
                <label className="check-control">
                  <input
                    aria-label="Enable effects"
                    type="checkbox"
                    checked={clip.effects.enabled}
                    onChange={(e) => effect({ enabled: e.target.checked })}
                  />{' '}
                  On
                </label>
              </div>
              <div className={clip.effects.enabled ? '' : 'bypassed'}>
                <Range
                  label="Darker / brighter"
                  min={80}
                  max={20000}
                  step={20}
                  value={clip.effects.lowpass}
                  display={`${clip.effects.lowpass} Hz`}
                  help="Lower removes high frequencies for a darker sound."
                  onChange={(value) => effect({ lowpass: value })}
                />
                <Range
                  label="Clean / dirty"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clip.effects.distortion}
                  display={`${Math.round(clip.effects.distortion * 100)}%`}
                  onChange={(value) => effect({ distortion: value })}
                />
                <Range
                  label="Space"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clip.effects.reverb}
                  display={`${Math.round(clip.effects.reverb * 100)}%`}
                  help="Adds a short, diffuse room tail."
                  onChange={(value) => effect({ reverb: value })}
                />
                <Range
                  label="Echo"
                  min={0}
                  max={1}
                  step={0.01}
                  value={clip.effects.echo}
                  display={`${Math.round(clip.effects.echo * 100)}%`}
                  onChange={(value) => effect({ echo: value })}
                />
              </div>
              <details className="advanced">
                <summary>Advanced filter & playback</summary>
                <Range
                  label="High-pass filter"
                  min={20}
                  max={18000}
                  step={10}
                  value={clip.effects.highpass}
                  display={`${clip.effects.highpass} Hz`}
                  help="Removes low rumble below this frequency."
                  onChange={(value) => effect({ highpass: value })}
                />
                <NumberField
                  label="Playback rate"
                  min={0.25}
                  max={4}
                  step={0.01}
                  value={clip.rate}
                  onChange={(value) => onClip({ rate: value })}
                />
                <p className="help">
                  Gain and fades precede the ordered effect chain. Pan follows it. Effect bypass
                  preserves all settings.
                </p>
              </details>
              <Button onClick={() => effect(cleanEffects())}>
                <RotateCcw size={13} /> Reset effects
              </Button>
            </section>
            <EffectChain effects={clip.effects} onChange={(effects) => onClip({ effects })} />
          </>
        ) : track ? (
          <>
            <div className="selection-title">
              <span className="eyebrow">SELECTED LAYER</span>
              <h3>{track.name}</h3>
              <small>{track.clips.length} clips</small>
            </div>
            <section>
              <h3>Layer mix</h3>
              <Range
                label="Layer loudness"
                value={gainToDb(track.gain)}
                min={-40}
                max={6}
                step={0.5}
                display={`${gainToDb(track.gain).toFixed(1)} dB`}
                onChange={(value) => onTrack({ gain: dbToGain(value) })}
              />
              <Range
                label="Layer pan"
                value={track.pan}
                min={-1}
                max={1}
                step={0.05}
                display={track.pan.toFixed(2)}
                onChange={(value) => onTrack({ pan: value })}
              />
              <Button onClick={onDeleteTrack}>
                <Trash2 size={14} /> Delete layer
              </Button>
            </section>
          </>
        ) : (
          <div className="inspector-empty">
            <SlidersHorizontal size={28} />
            <h3>
              A little change.
              <br />A different sound.
            </h3>
            <p>Select a clip to change its depth, texture, timing, and space.</p>
            <div className="shortcut">
              <kbd>Space</kbd>
              <span>Play / pause</span>
            </div>
            <div className="shortcut">
              <kbd>Ctrl Z</kbd>
              <span>Undo an edit</span>
            </div>
            <div className="shortcut">
              <kbd>Ctrl S</kbd>
              <span>Save locally</span>
            </div>
          </div>
        )}
        <section className="export-summary">
          <span className="eyebrow">PROJECT OUTPUT</span>
          <div>
            {project.export.sampleRate / 1000} kHz{' '}
            <span>
              · {project.export.channels === 1 ? 'Mono' : 'Stereo'} ·{' '}
              {project.export.format === 'wav'
                ? 'PCM WAV'
                : project.export.format === 'ogg'
                  ? 'Ogg Vorbis'
                  : 'MP3'}
            </span>
          </div>
          <NumberField
            label="Effect tail (s)"
            min={0}
            max={10}
            step={0.1}
            value={project.export.tail}
            onChange={(value) =>
              onProject({ ...project, export: { ...project.export, tail: value } })
            }
          />
          <p className="help">
            Use at least 1.5s with room reverb, or 2.2s with reverb and echo together.
          </p>
        </section>
      </div>
    </aside>
  );
}
