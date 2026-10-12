import { ProjectHistory } from './history';
import { newProject, validateProject, type Project } from './model';

export class ProjectStore {
  private history = new ProjectHistory(newProject());
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.history.current;
  get canUndo() {
    return this.history.canUndo;
  }
  get canRedo() {
    return this.history.canRedo;
  }
  referencesAsset(id: string) {
    return this.history.referencesAsset(id);
  }
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  change(project: Project) {
    this.history.change(validateProject(project));
    this.emit();
  }
  load(project: Project) {
    this.history = new ProjectHistory(validateProject(project));
    this.emit();
  }
  undo() {
    this.history.undo();
    this.emit();
  }
  redo() {
    this.history.redo();
    this.emit();
  }
}
export const projectStore = new ProjectStore();
