import { clipDuration, projectDuration, type Clip, type Project } from '../domain/model';
import { Button, NumberField } from './ui';

export function LoopControls({
  project,
  clip,
  onChange,
}: {
  project: Project;
  clip?: Clip;
  onChange: (project: Project) => void;
}) {
  const duration = projectDuration(project),
    hasAudio = project.tracks.some((t) => t.clips.length > 0);
  const set = (patch: Partial<Project['loop']>) =>
    onChange({ ...project, loop: { ...project.loop, ...patch } });
  return (
    <div className="loop-controls" aria-label="Audition loop controls">
      <label className="check-control">
        <input
          type="checkbox"
          aria-label="Loop playback"
          disabled={!hasAudio || duration < 0.05}
          checked={project.loop.enabled}
          onChange={(e) => {
            const end = Math.min(duration, Math.max(0.05, project.loop.end)),
              start = Math.max(0, Math.min(project.loop.start, end - 0.05));
            set({ enabled: e.target.checked, start, end });
          }}
        />
        Loop
      </label>
      <NumberField
        label="Loop start (s)"
        min={0}
        max={project.loop.end - 0.05}
        value={project.loop.start}
        onChange={(start) => set({ start })}
      />
      <NumberField
        label="Loop end (s)"
        min={project.loop.start + 0.05}
        max={130}
        value={project.loop.end}
        onChange={(end) => set({ end })}
      />
      <Button
        disabled={!clip || clipDuration(clip) < 0.05}
        onClick={() => {
          if (clip) set({ enabled: true, start: clip.start, end: clip.start + clipDuration(clip) });
        }}
      >
        Loop selected clip
      </Button>
      <small>Audition only · WAV keeps the full timeline</small>
    </div>
  );
}
