import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import {
  Plus,
  Scissors,
  Copy,
  Trash2,
  Magnet,
  ZoomIn,
  ZoomOut,
  AudioLines,
  GripVertical,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import {
  clamp,
  clipDuration,
  contentDuration,
  editClip,
  LIMITS,
  snapTime,
  snapClipTime,
  type Asset,
  type Clip,
  type Project,
  type Track,
} from '../domain/model';
import { Button, Modal, formatTime } from './ui';
import { Waveform } from './Waveform';

export function Timeline({
  project,
  assets,
  selectedClip,
  selectedTrack,
  position,
  onChange,
  onSelectClip,
  onSelectTrack,
  onSeek,
  onDrop,
  onDuplicate,
  onSplit,
  onDelete,
  onAddTrack,
  onRecord,
}: {
  project: Project;
  assets: Asset[];
  selectedClip: string;
  selectedTrack: string;
  position: number;
  onChange: (project: Project) => void;
  onSelectClip: (id: string) => void;
  onSelectTrack: (id: string) => void;
  onSeek: (position: number) => void;
  onDrop: (asset: Asset, trackId: string, time: number) => void;
  onDuplicate: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onAddTrack: () => void;
  onRecord: () => void;
}) {
  const [drag, setDrag] = useState<{ id: string; patch: Partial<Clip>; trackId: string }>();
  const [actions, setActions] = useState(false);
  const dragCleanup = useRef<() => void>(() => {});
  const currentProject = useRef(project);
  currentProject.current = project;
  useEffect(() => () => dragCleanup.current(), []);
  const transfer = (clip: Clip, patch: Partial<Clip>, trackId: string) => ({
    ...project,
    tracks: project.tracks.map((t) => ({
      ...t,
      clips: [
        ...t.clips.filter((c) => c.id !== clip.id),
        ...(t.id === trackId ? [{ ...clip, ...patch }] : []),
      ],
    })),
  });
  const extent = Math.min(124, Math.max(7, contentDuration(project) + 2)),
    width = extent * project.zoom;
  const trackChange = (track: Track, patch: Partial<Track>) =>
    onChange({
      ...project,
      tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, ...patch } : t)),
    });
  const order = (index: number, direction: number) => {
    const tracks = [...project.tracks],
      target = index + direction;
    if (target < 0 || target >= tracks.length) return;
    [tracks[index], tracks[target]] = [tracks[target], tracks[index]];
    onChange({ ...project, tracks });
  };
  const beginDrag = (event: PointerEvent, clip: Clip, kind: 'move' | 'start' | 'end') => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    dragCleanup.current();
    onSelectClip(clip.id);
    const pointer = event.clientX,
      scale = project.zoom,
      target = event.currentTarget as HTMLElement;
    target.closest<HTMLElement>('.audio-clip')?.focus();
    target.setPointerCapture(event.pointerId);
    let patch: Partial<Clip> = {};
    const originalTrackId = project.tracks.find((t) => t.clips.some((c) => c.id === clip.id))!.id;
    let trackId = originalTrackId;
    const move = (moveEvent: globalThis.PointerEvent) => {
      const delta = (moveEvent.clientX - pointer) / scale;
      if (kind === 'move')
        patch = {
          start: clamp(
            snapClipTime(project, clip.id, clip.start + delta, position, clipDuration(clip)),
            0,
            LIMITS.duration - clipDuration(clip),
          ),
        };
      if (kind === 'move') {
        const canvas = document
          .elementFromPoint(moveEvent.clientX, moveEvent.clientY)
          ?.closest<HTMLElement>('[data-track-id]');
        if (canvas?.dataset.trackId) trackId = canvas.dataset.trackId;
      } else if (kind === 'start') {
        const asset = assets.find((a) => a.id === clip.assetId);
        const available = clip.reverse
          ? (asset?.duration ?? clip.trimEnd) - clip.trimEnd
          : clip.trimStart;
        const sourceDelta = clamp(
          (snapClipTime(project, clip.id, clip.start + delta, position) - clip.start) * clip.rate,
          Math.max(-available, -clip.start * clip.rate),
          clip.trimEnd - clip.trimStart - 0.01,
        );
        patch = {
          ...(clip.reverse
            ? { trimEnd: clip.trimEnd - sourceDelta }
            : { trimStart: clip.trimStart + sourceDelta }),
          start: Math.max(0, clip.start + sourceDelta / clip.rate),
        };
      } else {
        const asset = assets.find((a) => a.id === clip.assetId);
        const endDelta =
          (snapClipTime(project, clip.id, clip.start + clipDuration(clip) + delta, position) -
            clip.start -
            clipDuration(clip)) *
          clip.rate;
        patch = clip.reverse
          ? {
              trimStart: clamp(
                clip.trimStart - endDelta,
                Math.max(0, clip.trimEnd - (LIMITS.duration - clip.start) * clip.rate),
                clip.trimEnd - 0.01,
              ),
            }
          : {
              trimEnd: clamp(
                clip.trimEnd + endDelta,
                clip.trimStart + 0.01,
                Math.min(
                  asset?.duration ?? clip.trimEnd,
                  clip.trimStart + (LIMITS.duration - clip.start) * clip.rate,
                ),
              ),
            };
      }
      setDrag({ id: clip.id, patch, trackId });
    };
    const cleanup = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', cancel);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      dragCleanup.current = () => {};
    };
    const end = () => {
      cleanup();
      setDrag(undefined);
      if (
        currentProject.current === project &&
        (Object.keys(patch).length || trackId !== originalTrackId)
      ) {
        onChange(
          trackId !== originalTrackId
            ? transfer(clip, patch, trackId)
            : editClip(project, clip.id, patch),
        );
        onSelectClip(clip.id);
      }
    };
    const cancel = () => {
      cleanup();
      setDrag(undefined);
    };
    dragCleanup.current = cleanup;
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end, { once: true });
    target.addEventListener('pointercancel', cancel, { once: true });
  };
  const ref = useRef<HTMLDivElement>(null);
  const tickStep =
    project.zoom < 12
      ? 10
      : project.zoom < 30
        ? 5
        : project.zoom < 70
          ? 2
          : project.zoom >= 200
            ? 0.5
            : 1;
  const ticks = Array.from({ length: Math.floor(extent / tickStep) + 1 }, (_, i) => i * tickStep);
  return (
    <section className="timeline-panel panel" aria-label="Timeline editor">
      <div className="timeline-toolbar">
        <div>
          <h2>Timeline</h2>
          <span>
            {project.tracks.length} layers <span className="muted">· seconds</span>
          </span>
        </div>
        <div className="timeline-tools">
          <Button
            label="Split selected clip at playhead"
            disabled={!selectedClip}
            onClick={onSplit}
          >
            <Scissors size={15} />
          </Button>
          <Button label="Duplicate selected clip" disabled={!selectedClip} onClick={onDuplicate}>
            <Copy size={15} />
          </Button>
          <Button label="Delete selected clip" disabled={!selectedClip} onClick={onDelete}>
            <Trash2 size={15} />
          </Button>
          <i />
          <Button
            label="Snap to clip edges, playhead, and 50 millisecond grid"
            active={project.snap}
            onClick={() => onChange({ ...project, snap: !project.snap })}
          >
            <Magnet size={16} />
          </Button>
          <Button
            label="Zoom out"
            disabled={project.zoom <= 5}
            onClick={() => onChange({ ...project, zoom: Math.max(5, project.zoom - 25) })}
          >
            <ZoomOut size={16} />
          </Button>
          <span className="zoom-label">{Math.round((project.zoom / 110) * 100)}%</span>
          <Button
            label="Zoom in"
            disabled={project.zoom >= 400}
            onClick={() => onChange({ ...project, zoom: Math.min(400, project.zoom + 25) })}
          >
            <ZoomIn size={16} />
          </Button>
          <Button
            label="Fit timeline to view"
            onClick={() => {
              if (ref.current) {
                ref.current.scrollLeft = 0;
                onChange({
                  ...project,
                  zoom: clamp((ref.current.clientWidth - 170) / extent, 5, 400),
                });
              }
            }}
          >
            Fit
          </Button>
        </div>
      </div>
      <div className="timeline-scroll" ref={ref}>
        <div className="timeline-inner" style={{ width: width + 170 }}>
          <div className="timeline-ruler">
            <div className="track-label ruler-label">LAYERS</div>
            <div
              className="ruler-canvas"
              style={{ width }}
              onPointerDown={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onSeek(clamp((event.clientX - rect.left) / project.zoom, 0, LIMITS.duration));
              }}
            >
              {project.loop.enabled && (
                <div
                  className="loop-band"
                  aria-label="Loop region"
                  style={{
                    left: project.loop.start * project.zoom,
                    width: (project.loop.end - project.loop.start) * project.zoom,
                  }}
                />
              )}
              {ticks.map((time) => (
                <span key={time} style={{ left: time * project.zoom }}>
                  {time.toFixed(tickStep < 1 ? 1 : 0)}s
                </span>
              ))}
              <div className="ruler-playhead" style={{ left: position * project.zoom }} />
            </div>
          </div>
          {project.tracks.map((track, index) => (
            <div
              className={`track-row ${selectedTrack === track.id ? 'track-selected' : ''} ${drag?.trackId === track.id ? 'track-drag-target' : ''}`}
              key={track.id}
              style={{ '--track-color': track.color } as CSSProperties}
            >
              <div className="track-label" onClick={() => onSelectTrack(track.id)}>
                <div className="track-name">
                  <GripVertical size={13} />
                  <input
                    aria-label={`Name of layer ${index + 1}`}
                    value={track.name}
                    onChange={(event) =>
                      trackChange(track, { name: event.target.value || 'Layer' })
                    }
                    maxLength={80}
                  />
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="track-buttons">
                  <Button
                    label={`Mute ${track.name}`}
                    active={track.mute}
                    onClick={() => trackChange(track, { mute: !track.mute })}
                  >
                    M
                  </Button>
                  <Button
                    label={`Solo ${track.name}`}
                    active={track.solo}
                    onClick={() => trackChange(track, { solo: !track.solo })}
                  >
                    S
                  </Button>
                  <span className="track-volume">{Math.round(track.gain * 100)}%</span>
                  <Button
                    label={`Move ${track.name} up`}
                    disabled={index === 0}
                    onClick={() => order(index, -1)}
                  >
                    <ArrowUp size={12} />
                  </Button>
                  <Button
                    label={`Move ${track.name} down`}
                    disabled={index === project.tracks.length - 1}
                    onClick={() => order(index, 1)}
                  >
                    <ArrowDown size={12} />
                  </Button>
                </div>
              </div>
              <div
                className="track-canvas"
                data-track-id={track.id}
                style={{ width, backgroundSize: `${project.zoom * tickStep}px 100%` }}
                onClick={() => onSelectTrack(track.id)}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('application/x-vaudiofx-asset'))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const asset = assets.find(
                    (a) => a.id === event.dataTransfer.getData('application/x-vaudiofx-asset'),
                  );
                  if (asset)
                    onDrop(
                      asset,
                      track.id,
                      snapTime(
                        (event.clientX - event.currentTarget.getBoundingClientRect().left) /
                          project.zoom,
                        project.snap,
                      ),
                    );
                }}
              >
                {project.loop.enabled && (
                  <div
                    className="loop-band"
                    style={{
                      left: project.loop.start * project.zoom,
                      width: (project.loop.end - project.loop.start) * project.zoom,
                    }}
                  />
                )}
                {track.clips.map((original) => {
                  const clip = drag?.id === original.id ? { ...original, ...drag.patch } : original,
                    asset = assets.find((a) => a.id === clip.assetId);
                  return (
                    <div
                      key={clip.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Select clip ${clip.name}`}
                      className={`audio-clip ${selectedClip === clip.id ? 'clip-selected' : ''}`}
                      style={{
                        left: clip.start * project.zoom,
                        width: Math.max(18, clipDuration(clip) * project.zoom),
                      }}
                      onPointerDown={(event) => beginDrag(event, original, 'move')}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectClip(clip.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.code === 'Space') {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectClip(clip.id);
                        }
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectClip(clip.id);
                          onChange(
                            editClip(project, clip.id, {
                              start: clamp(
                                clip.start +
                                  (event.key === 'ArrowLeft' ? -1 : 1) *
                                    (event.shiftKey ? 0.05 : 0.01),
                                0,
                                LIMITS.duration - clipDuration(clip),
                              ),
                            }),
                          );
                        }
                        if (
                          event.key === 'ContextMenu' ||
                          (event.shiftKey && event.key === 'F10')
                        ) {
                          event.preventDefault();
                          onSelectClip(clip.id);
                          setActions(true);
                        }
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        onSelectClip(clip.id);
                        setActions(true);
                      }}
                    >
                      <div className="clip-title">{clip.name}</div>
                      {asset && (
                        <Waveform
                          asset={asset}
                          start={clip.trimStart}
                          end={clip.trimEnd}
                          reverse={clip.reverse}
                        />
                      )}
                      <div
                        className="fade-shape fade-left"
                        style={{ width: Math.min(clip.fadeIn, clipDuration(clip)) * project.zoom }}
                      />
                      <div
                        className="fade-shape fade-right"
                        style={{ width: Math.min(clip.fadeOut, clipDuration(clip)) * project.zoom }}
                      />
                      <span
                        className="trim-handle trim-left"
                        title={`Trim start of ${clip.name}`}
                        onPointerDown={(event) => beginDrag(event, original, 'start')}
                      />
                      <span
                        className="trim-handle trim-right"
                        title={`Trim end of ${clip.name}`}
                        onPointerDown={(event) => beginDrag(event, original, 'end')}
                      />
                    </div>
                  );
                })}
                <div className="track-playhead" style={{ left: position * project.zoom }} />
              </div>
            </div>
          ))}
          <div className="add-layer-row">
            <Button onClick={onAddTrack} disabled={project.tracks.length >= LIMITS.tracks}>
              <Plus size={14} /> Add layer
            </Button>
          </div>
        </div>
      </div>
      {!project.tracks.some((t) => t.clips.length) && (
        <div className="timeline-empty">
          <div className="empty-symbol">
            <AudioLines size={30} />
          </div>
          <h3>Every sound starts somewhere.</h3>
          <p>
            Drag a sound onto a layer, import your own,
            <br />
            or make something only you could record.
          </p>
          <Button className="primary" onClick={onRecord}>
            Record a sound
          </Button>
          <small>Tip: a low gurgle + Creature voice makes a great undead starting point.</small>
        </div>
      )}
      <div className="timeline-footer">
        <span>Drag across layers · edges trim · ←/→ nudges · right-click for actions</span>
        <span>
          {formatTime(contentDuration(project))} <span className="muted">of audio</span>
        </span>
      </div>
      {actions && (
        <Modal title="Clip actions" onClose={() => setActions(false)}>
          <div className="dialog-body clip-actions">
            <Button
              onClick={() => {
                onDuplicate();
                setActions(false);
              }}
            >
              Duplicate clip
            </Button>
            <Button
              onClick={() => {
                onSplit();
                setActions(false);
              }}
            >
              Split at playhead
            </Button>
            <Button
              onClick={() => {
                onDelete();
                setActions(false);
              }}
            >
              Delete clip
            </Button>
            <p className="help">
              Ctrl D duplicates · S splits · Delete removes · Shift + arrows nudges 50 ms. All edits
              can be undone.
            </p>
          </div>
        </Modal>
      )}
    </section>
  );
}
