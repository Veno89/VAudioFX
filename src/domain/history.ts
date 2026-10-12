import type { Project } from './model';

export class ProjectHistory {
  private past: Project[] = [];
  private future: Project[] = [];
  constructor(public current: Project) {}
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  referencesAsset(id: string) {
    return [this.current, ...this.past, ...this.future].some((p) =>
      p.tracks.some((t) => t.clips.some((c) => c.assetId === id)),
    );
  }
  change(next: Project) {
    this.past.push(this.current);
    this.past = this.past.slice(-80);
    this.future = [];
    this.current = { ...next, updatedAt: Date.now() };
    return this.current;
  }
  undo() {
    const previous = this.past.pop();
    if (previous) {
      this.future.push(this.current);
      this.current = previous;
    }
    return this.current;
  }
  redo() {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.current);
      this.current = next;
    }
    return this.current;
  }
}
