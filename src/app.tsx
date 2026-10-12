import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  AudioLines,
  FilePlus2,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Mic,
  Play,
  Pause,
  Square,
  Download,
  Volume2,
  CircleHelp,
  Check,
  Copy,
  Trash2,
  Upload,
} from 'lucide-react';
import { assetRepository } from './audio/assets';
import { playback } from './audio/playback';
import { renderProject } from './audio/render';
import { findSignalRegion } from './audio/cleanup';
import {
  LIMITS,
  cleanEffects,
  clipDuration,
  editClip,
  makeClip,
  makeTrack,
  newProject,
  projectDuration,
  splitClip,
  repeatClip,
  uid,
  validateProject,
  type Asset,
  type Clip,
  type Project,
  type Track,
} from './domain/model';
import { projectStore } from './domain/store';
import { database, type Preferences } from './storage/database';
import { download, safeFilename } from './export/wav';
import { encodeAudio } from './export/audio';
import { exportPackage, importPackage } from './export/project-package';
import { builtinSamples } from './features/library';
import { createTemplate } from './features/templates';
import { generateSource, sourceDefaults, type SourceSpec } from './audio/synthesis';
import { insertSource, macroPatch, presetPatch } from './features/creative';
import { recipes } from './features/recipes';
import { Generator } from './components/Generator';
import { RecipeGuide } from './components/RecipeGuide';
import { Library } from './components/Library';
import { Timeline } from './components/Timeline';
import { Inspector } from './components/Inspector';
import { Recording } from './components/Recording';
import { LoopControls } from './components/LoopControls';
import { StorageStatus } from './components/StorageStatus';
import { Button, Modal, formatTime } from './components/ui';

const defaults: Preferences = { favorites: [], recent: [], installed: [] };
export function App() {
  const project = useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot);
  const [assets, setAssets] = useState<Asset[]>(builtinSamples),
    [preferences, setPreferences] = useState(defaults),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [selectedClip, setSelectedClip] = useState(''),
    [selectedTrack, setSelectedTrack] = useState(''),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [busy, setBusy] = useState(''),
    [cleanupBusy, setCleanupBusy] = useState(false),
    [saved, setSaved] = useState('Opening local storage…'),
    [modal, setModal] = useState(''),
    [projects, setProjects] = useState<Project[]>([]),
    [volume, setVolume] = useState(35),
    [downloading, setDownloading] = useState(''),
    [recipeId, setRecipeId] = useState(''),
    [recipeStep, setRecipeStep] = useState(0),
    [recipeTarget, setRecipeTarget] = useState('');
  const [renderFootprint, setRenderFootprint] = useState('');
  const audioInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    saveQueue = useRef<Promise<void>>(Promise.resolve()),
    alive = useRef(true),
    cleanupJob = useRef(0),
    playheadFrame = useRef<number | undefined>(undefined),
    playheadUpdate = useRef<number | undefined>(undefined),
    creativeJob = useRef(false),
    recipeJob = useRef(false),
    recipeSession = useRef(0),
    pendingRender = useRef<AbortController | undefined>(undefined),
    pendingEncode = useRef<AbortController | undefined>(undefined),
    pendingPackage = useRef<AbortController | undefined>(undefined),
    cachedRender = useRef<
      { key: string; result: Promise<Awaited<ReturnType<typeof renderProject>>> } | undefined
    >(undefined);
  const positionRef = useRef(position);
  positionRef.current = position;
  const selectionRef = useRef(selectedClip);
  selectionRef.current = selectedClip;
  const clip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClip),
    track = project.tracks.find((t) => t.id === selectedTrack),
    selectedAsset = assets.find((a) => a.id === clip?.assetId);
  const report = useCallback((error: unknown) => {
    if (!alive.current) return;
    setError(
      error instanceof Error
        ? error.message
        : 'Something went wrong. Your original audio has not been changed.',
    );
  }, []);
  const stop = useCallback((reset = true) => {
    generation.current++;
    if (pendingRender.current) cachedRender.current = undefined;
    pendingRender.current?.abort();
    pendingEncode.current?.abort();
    pendingPackage.current?.abort();
    playback.stop();
    setPlaying(false);
    setBusy('');
    if (reset) setPosition(0);
  }, []);
  const change = useCallback(
    (next: Project) => {
      try {
        projectStore.change(next);
        stop(false);
      } catch (error) {
        report(error);
      }
    },
    [stop, report],
  );
  const save = useCallback(
    async (snapshot = projectStore.getSnapshot()) => {
      if (!alive.current) return;
      setSaved('Saving…');
      const sources = assets.filter((a) =>
        snapshot.tracks.some((t) => t.clips.some((c) => c.assetId === a.id)),
      );
      const task = saveQueue.current
        .catch(() => undefined)
        .then(() => database.saveProject(snapshot, sources));
      saveQueue.current = task;
      try {
        await task;
        if (alive.current && projectStore.getSnapshot() === snapshot)
          setSaved('Saved on this device');
      } catch (error) {
        if (alive.current) setSaved('Local save failed');
        throw error;
      }
    },
    [assets],
  );
  useEffect(() => {
    alive.current = true;
    void Promise.all([
      database.all<Asset>('assets'),
      database.get<string>('settings', 'activeProject'),
      database.get<Preferences>('settings', 'preferences'),
    ])
      .then(async ([stored, active, prefs]) => {
        if (!alive.current) return;
        setAssets([
          ...builtinSamples.map((a) => stored.find((s) => s.id === a.id) ?? a),
          ...stored.filter((a) => !builtinSamples.some((b) => b.id === a.id)),
        ]);
        if (
          prefs &&
          Array.isArray(prefs.favorites) &&
          Array.isArray(prefs.recent) &&
          Array.isArray(prefs.installed)
        )
          setPreferences(prefs);
        if (active) {
          const recovered = await database.get<Project>('projects', active);
          if (recovered && alive.current) {
            projectStore.load(validateProject(recovered));
            setMessage('Recovered your locally saved project.');
          }
        }
        if (alive.current) setSaved('Saved on this device');
      })
      .catch((error) => {
        if (alive.current) {
          report(error);
          setSaved('Local storage unavailable');
        }
      })
      .finally(() => {
        if (alive.current) setReady(true);
      });
    const close = () => {
      alive.current = false;
      if (pendingRender.current) cachedRender.current = undefined;
      pendingRender.current?.abort();
      pendingEncode.current?.abort();
      pendingPackage.current?.abort();
      generation.current++;
      cleanupJob.current++;
      if (playheadFrame.current !== undefined) cancelAnimationFrame(playheadFrame.current);
      playheadFrame.current = undefined;
      if (playheadUpdate.current !== undefined) clearTimeout(playheadUpdate.current);
      playheadUpdate.current = undefined;
      positionRef.current = playback.pause();
      void assetRepository.dispose();
    };
    const restore = () => {
      alive.current = true;
      setPlaying(false);
      setBusy('');
      setCleanupBusy(false);
      setPosition(positionRef.current);
    };
    window.addEventListener('pagehide', close);
    window.addEventListener('pageshow', restore);
    return () => {
      alive.current = false;
      pendingRender.current?.abort();
      pendingEncode.current?.abort();
      pendingPackage.current?.abort();
      generation.current++;
      cleanupJob.current++;
      window.removeEventListener('pagehide', close);
      window.removeEventListener('pageshow', restore);
      void playback.dispose();
      void assetRepository.dispose();
    };
  }, [report]);
  useEffect(() => {
    if (!ready) return;
    setSaved('Unsaved changes');
    const timer = setTimeout(() => {
      void save(project).catch(report);
    }, 750);
    return () => clearTimeout(timer);
  }, [project, ready, save, report]);
  useEffect(() => {
    if (!playing) return;
    let active = true;
    const update = () => {
      if (!alive.current || !active) return;
      // Firefox can deliver a frame while closing a page during React work.
      // Publish from a separate task so frame callbacks never update React.
      if (playheadUpdate.current === undefined)
        playheadUpdate.current = window.setTimeout(() => {
          playheadUpdate.current = undefined;
          if (alive.current && active) setPosition(playback.position);
        }, 0);
      playheadFrame.current = requestAnimationFrame(update);
    };
    playheadFrame.current = requestAnimationFrame(update);
    return () => {
      active = false;
      if (playheadFrame.current !== undefined) cancelAnimationFrame(playheadFrame.current);
      playheadFrame.current = undefined;
      if (playheadUpdate.current !== undefined) clearTimeout(playheadUpdate.current);
      playheadUpdate.current = undefined;
    };
  }, [playing]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  const preferenceChange = (patch: Partial<Preferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    void database.setting('preferences', next).catch(report);
  };
  const recent = (id: string) =>
    preferenceChange({ recent: [id, ...preferences.recent.filter((i) => i !== id)].slice(0, 20) });
  const render = () => {
    const { format: _format, ...renderSettings } = project.export;
    const key = JSON.stringify({ tracks: project.tracks, export: renderSettings });
    if (cachedRender.current?.key !== key) {
      const controller = new AbortController();
      pendingRender.current = controller;
      const result = renderProject(project, assets, controller.signal);
      cachedRender.current = { key, result };
      void result
        .then(({ memory }) => {
          if (alive.current && cachedRender.current?.key === key)
            setRenderFootprint(
              `Last render buffers: ${(memory.decodedBytes / 1048576).toFixed(1)} MB sources + ${(memory.preparedBytes / 1048576).toFixed(1)} MB prepared + ${(memory.renderedBytes / 1048576).toFixed(1)} MB mix. Worker copies and browser overhead are additional.`,
            );
        })
        .catch(() => undefined);
      void result.catch(() => {
        if (cachedRender.current?.key === key) cachedRender.current = undefined;
      });
      void result
        .finally(() => {
          if (pendingRender.current === controller) pendingRender.current = undefined;
        })
        .catch(() => undefined);
    }
    return cachedRender.current.result;
  };
  const play = async () => {
    if (playing) {
      const time = playback.pause();
      generation.current++;
      setPlaying(false);
      setPosition(time);
      return;
    }
    if (busy) return;
    const token = ++generation.current;
    setBusy('Rendering preview…');
    setError('');
    try {
      const { buffer } = await render();
      if (!alive.current || token !== generation.current) return;
      await playback.play(
        buffer,
        position >= buffer.duration ? 0 : position,
        () => {
          if (!alive.current || token !== generation.current) return;
          setPlaying(false);
          setPosition(0);
        },
        project.loop,
      );
      if (token === generation.current) setPlaying(playback.playing);
    } catch (error) {
      if (token === generation.current) report(error);
    } finally {
      if (token === generation.current) setBusy('');
    }
  };
  const preview = async (asset: Asset) => {
    stop();
    const token = ++generation.current;
    setBusy('Loading sample…');
    try {
      const buffer = await assetRepository.decode(asset);
      if (token === generation.current) {
        await playback.play(buffer);
        recent(asset.id);
      }
    } catch (error) {
      report(error);
    } finally {
      if (token === generation.current) setBusy('');
    }
  };
  const add = (asset: Asset, trackId = selectedTrack || project.tracks[0]?.id, time = position) => {
    if (project.tracks.flatMap((t) => t.clips).length >= LIMITS.clips) {
      report(new Error('This project already contains 128 clips.'));
      return;
    }
    const newClip = makeClip(asset, Math.min(time, Math.max(0, 120 - asset.duration)));
    let tracks = project.tracks;
    if (!tracks.some((t) => t.id === trackId)) {
      const track = makeTrack(tracks.length);
      trackId = track.id;
      tracks = [...tracks, track];
    }
    change({
      ...project,
      tracks: tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, newClip] } : t)),
    });
    setSelectedClip(newClip.id);
    setSelectedTrack(trackId!);
    recent(asset.id);
  };
  const editSelected = (patch: Partial<Clip>) => {
    if (clip) change(editClip(project, clip.id, patch));
  };
  const trimSilence = async () => {
    if (!clip || !selectedAsset || cleanupBusy) return;
    setCleanupBusy(true);
    setError('');
    stop(false);
    const job = ++cleanupJob.current;
    try {
      const buffer = await assetRepository.decode(selectedAsset);
      const patch = findSignalRegion(
        Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)),
        buffer.sampleRate,
        clip.trimStart,
        clip.trimEnd,
        clip.cleanup.thresholdDb,
      );
      if (!alive.current || job !== cleanupJob.current) return;
      if (projectStore.getSnapshot() !== project || selectionRef.current !== clip.id)
        throw new Error('The selection changed during cleanup. Select the clip and try again.');
      change(editClip(project, clip.id, patch));
      setMessage('Quiet edges trimmed. Original audio preserved.');
    } catch (error) {
      if (alive.current) report(error);
    } finally {
      if (alive.current && job === cleanupJob.current) setCleanupBusy(false);
    }
  };
  const editTrack = (patch: Partial<Track>) => {
    if (track)
      change({
        ...project,
        tracks: project.tracks.map((t) => (t.id === track.id ? { ...t, ...patch } : t)),
      });
  };
  const removeClip = () => {
    if (!clip) return;
    change({
      ...project,
      tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clip.id) })),
    });
    setSelectedClip('');
  };
  const duplicateClip = () => {
    if (!clip) return;
    if (project.tracks.flatMap((t) => t.clips).length >= LIMITS.clips) {
      report(new Error('This project already contains 128 clips.'));
      return;
    }
    const parent = project.tracks.find((t) => t.clips.some((c) => c.id === clip.id))!;
    const duplicate = {
      ...clip,
      id: uid(),
      start: Math.min(120 - clipDuration(clip), clip.start + clipDuration(clip)),
    };
    change({
      ...project,
      tracks: project.tracks.map((t) =>
        t.id === parent.id ? { ...t, clips: [...t.clips, duplicate] } : t,
      ),
    });
    setSelectedClip(duplicate.id);
  };
  const undo = () => {
    stop(false);
    projectStore.undo();
  };
  const redo = () => {
    stop(false);
    projectStore.redo();
  };
  const load = (next: Project, keepRecipe = false) => {
    stop();
    projectStore.load(next);
    cachedRender.current = undefined;
    setSelectedClip('');
    setSelectedTrack('');
    if (!keepRecipe) {
      recipeSession.current++;
      setRecipeId('');
    }
  };
  const createNew = async () => {
    try {
      await save();
      load(newProject());
      setMessage('New project created. Your previous project is saved locally.');
    } catch (error) {
      report(error);
    }
  };
  const openProjects = async () => {
    setModal('projects');
    try {
      setProjects(
        (await database.all<Project>('projects')).sort((a, b) => b.updatedAt - a.updatedAt),
      );
    } catch (error) {
      setProjects([]);
      report(error);
    }
  };
  const saveAs = async () => {
    try {
      await save();
      const next = {
        ...project,
        id: uid(),
        name: `${project.name} copy`.slice(0, 100),
        updatedAt: Date.now(),
      };
      await database.saveProject(
        next,
        assets.filter((a) => !!a.blob),
      );
      load(next);
      setMessage('Project duplicated on this device.');
    } catch (error) {
      report(error);
    }
  };
  const openLocal = async (next: Project) => {
    try {
      await save();
      load(next);
      setModal('');
    } catch (error) {
      report(error);
    }
  };
  const exportAudio = async () => {
    if (busy) return;
    stop(false);
    const token = generation.current;
    const snapshot = project;
    const controller = new AbortController();
    pendingEncode.current = controller;
    setBusy('Rendering audio…');
    setError('');
    try {
      const { buffer, peak, limitedSamples } = await render();
      if (!alive.current || token !== generation.current) return;
      if (peak > 1 && !project.export.normalize && !project.export.limiter) {
        setError(
          'This mix exceeds 0 dB and would clip. Enable peak normalization or peak limiting, or lower the layer volumes before exporting.',
        );
        return;
      }
      setBusy(`Encoding ${snapshot.export.format.toUpperCase()}…`);
      const blob = await encodeAudio(buffer, snapshot.export.format, controller.signal);
      if (!alive.current || token !== generation.current) return;
      download(blob, `${safeFilename(snapshot.name)}.${snapshot.export.format}`);
      setMessage(
        `Exported ${buffer.duration.toFixed(2)}s of ${buffer.numberOfChannels === 1 ? 'mono' : 'stereo'} ${snapshot.export.format === 'wav' ? 'PCM WAV' : snapshot.export.format === 'ogg' ? 'Ogg Vorbis' : 'MP3'}.${limitedSamples ? ` Peak limiter affected ${limitedSamples.toLocaleString()} samples.` : ''}`,
      );
      setModal('');
    } catch (error) {
      if (token === generation.current) report(error);
    } finally {
      if (pendingEncode.current === controller) pendingEncode.current = undefined;
      if (token === generation.current) setBusy('');
    }
  };
  const portable = async () => {
    if (pendingPackage.current) return;
    const controller = new AbortController();
    pendingPackage.current = controller;
    setBusy('Packaging original audio…');
    try {
      const blob = await exportPackage(project, assets, controller.signal);
      controller.signal.throwIfAborted();
      if (!alive.current) return;
      download(blob, `${safeFilename(project.name)}.vafx`);
      setMessage('Portable backup downloaded with all referenced original audio.');
    } catch (error) {
      if (!controller.signal.aborted) report(error);
    } finally {
      if (pendingPackage.current === controller) {
        pendingPackage.current = undefined;
        if (alive.current) setBusy('');
      }
    }
  };
  const importProject = async (file: File) => {
    stop();
    if (pendingPackage.current) return;
    const controller = new AbortController();
    pendingPackage.current = controller;
    setBusy('Checking project package…');
    setError('');
    try {
      const imported = await importPackage(file, controller.signal),
        mapping = new Map<string, string>();
      for (const asset of imported.assets) {
        const original = asset.id;
        asset.id = uid();
        mapping.set(original, asset.id);
        const buffer = await assetRepository.decode(asset);
        controller.signal.throwIfAborted();
        if (Math.abs(buffer.duration - asset.duration) > 0.05)
          throw new Error('Source audio duration does not match its manifest.');
      }
      const next = {
        ...imported.project,
        id: uid(),
        tracks: imported.project.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({ ...c, assetId: mapping.get(c.assetId)! })),
        })),
      };
      await save();
      controller.signal.throwIfAborted();
      await database.saveProject(next, imported.assets, true, controller.signal);
      if (!alive.current) return;
      setAssets((previous) => [...previous, ...imported.assets]);
      load(next);
      setMessage('Portable project restored with its original audio.');
      setModal('');
    } catch (error) {
      if (!controller.signal.aborted) report(error);
    } finally {
      if (pendingPackage.current === controller) {
        pendingPackage.current = undefined;
        if (alive.current) setBusy('');
      }
    }
  };
  const importAudio = async (files: FileList) => {
    setBusy('Importing audio…');
    setError('');
    try {
      for (const file of Array.from(files).slice(0, 16)) {
        const asset = await assetRepository.import(file, file.name);
        setAssets((previous) => [...previous, asset]);
        setMessage(`${asset.name} saved in your local sound library.`);
      }
    } catch (error) {
      report(error);
    } finally {
      setBusy('');
    }
  };
  const take = async (blob: Blob, name: string, atPlayhead: boolean) => {
    const extension = blob.type.includes('ogg')
      ? 'ogg'
      : blob.type.includes('mp4')
        ? 'm4a'
        : 'webm';
    const asset = await assetRepository.import(blob, `${name}.${extension}`, 'recording');
    if (!alive.current) return;
    setAssets((previous) => [...previous, asset]);
    if (atPlayhead) add(asset);
    setMessage(
      'Original take saved on this device. Record another, or close this dialog to shape it.',
    );
  };
  const template = async (id: string, keepRecipe = false): Promise<boolean> => {
    if (creativeJob.current || busy) return false;
    creativeJob.current = true;
    stop(false);
    const token = generation.current;
    let completed = false;
    setBusy('Creating template…');
    try {
      const generated = await createTemplate(id);
      if (!alive.current || token !== generation.current) return false;
      await save();
      if (!alive.current || token !== generation.current) return false;
      await database.saveProject(generated.project, generated.assets, false);
      if (!alive.current || token !== generation.current) return false;
      setAssets((previous) => [...previous, ...generated.assets]);
      load(generated.project, keepRecipe);
      setSelectedClip(generated.project.tracks[0].clips[0].id);
      setSelectedTrack(generated.project.tracks[0].id);
      if (keepRecipe)
        setRecipeTarget(generated.project.tracks[id === 'fireball' ? 1 : 0].clips[0].id);
      setMessage('Template loaded. All layers are editable, locally generated audio.');
      completed = true;
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      creativeJob.current = false;
      if (alive.current && (completed || token === generation.current)) setBusy('');
    }
  };
  const createSound = async (
    spec: SourceSpec,
    name: string,
    newLayer: boolean,
    at = positionRef.current,
    patch: Partial<Clip> = {},
  ): Promise<boolean> => {
    if (creativeJob.current || busy)
      throw new Error('Wait for the current sound operation to finish.');
    creativeJob.current = true;
    stop(false);
    const token = generation.current,
      targetProject = projectStore.getSnapshot().id;
    let completed = false;
    setBusy('Generating sound…');
    try {
      const asset = await generateSource(spec, name);
      if (!alive.current || token !== generation.current) return false;
      const destination = newLayer ? undefined : selectedTrack;
      insertSource(projectStore.getSnapshot(), asset, at, destination, patch);
      await database.saveAsset(asset);
      if (!alive.current) return false;
      setAssets((previous) => [...previous, asset]);
      if (token !== generation.current || targetProject !== projectStore.getSnapshot().id) {
        setMessage('Generated original saved in the library. Timeline insertion was canceled.');
        return false;
      }
      const inserted = insertSource(projectStore.getSnapshot(), asset, at, destination, patch);
      projectStore.change(inserted.project);
      stop(false);
      setSelectedClip(inserted.clip.id);
      setSelectedTrack(inserted.trackId);
      setMessage('Generated original saved on this device and added to the timeline.');
      completed = true;
      return true;
    } finally {
      creativeJob.current = false;
      if (alive.current && (completed || token === generation.current)) setBusy('');
    }
  };
  const activeRecipe = recipes.find((r) => r.id === recipeId);
  const recipeClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === recipeTarget);
  const recipeAction = async () => {
    if (!activeRecipe || busy || recipeJob.current) return;
    recipeJob.current = true;
    const step = recipeStep,
      session = recipeSession.current;
    try {
      const action = activeRecipe.steps[step].action;
      let completed = false;
      if (action === 'use-voice') {
        if (!clip || !selectedAsset || !['recording', 'import'].includes(selectedAsset.kind))
          throw new Error('Select a recorded or imported voice clip.');
        setRecipeTarget(clip.id);
        completed = true;
      } else if (action === 'fireball' || action === 'ui') completed = await template(action, true);
      else {
        const snapshot = projectStore.getSnapshot();
        const target = snapshot.tracks.flatMap((t) => t.clips).find((c) => c.id === recipeTarget);
        if (!target)
          throw new Error('The recipe clip was removed. Restart this recipe from the Recipes tab.');
        if (action === 'bubble') {
          completed = await createSound(
            {
              ...sourceDefaults(),
              kind: 'sweep',
              duration: Math.max(0.05, Math.min(2, clipDuration(target))),
              from: 150,
              to: 40,
              pulse: 0.95,
              pulseHz: 13,
              shape: 'steady',
            },
            'Bubbling texture',
            true,
            target.start,
            { gain: 0.25, effects: { ...cleanEffects(), lowpass: 1200, reverb: 0.08 } },
          );
        } else {
          let next = snapshot;
          if (action === 'repeat') next = repeatClip(snapshot, target.id, 2);
          else if (action === 'creature' || action === 'impact')
            next = editClip(
              snapshot,
              target.id,
              presetPatch(action === 'creature' ? 'creature' : 'impact'),
            );
          else if (action === 'space' || action === 'brighten')
            next = editClip(
              snapshot,
              target.id,
              macroPatch(
                target,
                action === 'space' ? 'space' : 'brightness',
                action === 'space' ? 0.3 : 0.8,
              ),
            );
          if (action === 'space') next = { ...next, export: { ...next.export, tail: 2.2 } };
          projectStore.change(next);
          stop(false);
          completed = true;
        }
        if (completed) {
          setRecipeTarget(target.id);
          setSelectedClip(target.id);
          setSelectedTrack(
            projectStore.getSnapshot().tracks.find((t) => t.clips.some((c) => c.id === target.id))!
              .id,
          );
        }
      }
      if (completed && alive.current && recipeSession.current === session) setRecipeStep(step + 1);
    } catch (error) {
      report(error);
    } finally {
      recipeJob.current = false;
    }
  };
  const cachePack = async (id: string) => {
    setDownloading(`${id}:Starting…`);
    try {
      const pack = builtinSamples.filter((a) => a.pack === id);
      const cached = await assetRepository.cachePack(pack, (count) =>
        setDownloading(`${id}:${count} / ${pack.length}`),
      );
      setAssets((previous) => previous.map((a) => cached.find((c) => c.id === a.id) ?? a));
      preferenceChange({ installed: [...preferences.installed, id] });
      setMessage('Sample pack cached on this device.');
    } catch (error) {
      report(error);
    } finally {
      setDownloading('');
    }
  };
  const renameAsset = async (asset: Asset) => {
    const name = window.prompt('Rename this original audio source', asset.name)?.trim();
    if (!name) return;
    const renamed = { ...asset, name: name.slice(0, 100) };
    try {
      await database.saveAsset(renamed);
      setAssets((previous) => previous.map((a) => (a.id === asset.id ? renamed : a)));
    } catch (error) {
      report(error);
    }
  };
  const deleteAsset = async (asset: Asset) => {
    try {
      const saved = await database.all<Project>('projects');
      if (
        projectStore.referencesAsset(asset.id) ||
        saved.some((p) => p.tracks.some((t) => t.clips.some((c) => c.assetId === asset.id)))
      )
        throw new Error(
          'This original is used by a saved project or undo history. Remove its saved clips and open another project before deleting the source.',
        );
      if (
        !window.confirm(
          `Delete the original “${asset.name}” from this device? This cannot be undone.`,
        )
      )
        return;
      await database.deleteAsset(asset.id);
      setAssets((previous) => previous.filter((a) => a.id !== asset.id));
    } catch (error) {
      report(error);
    }
  };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, dialog') || modal) return;
      if (event.defaultPrevented) return;
      if (event.code === 'Space' && target.closest('button, a, summary, [role="button"]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        void play();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save()
          .then(() => setMessage('Project saved locally.'))
          .catch(report);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        removeClip();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateClip();
      }
      if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 's' && clip) {
        event.preventDefault();
        change(splitClip(project, clip.id, position));
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        stop(false);
        setPosition(event.key === 'Home' ? 0 : projectDuration(project));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const hasClips = project.tracks.some((t) => t.clips.length);
  return (
    <main className="application">
      <header className="app-header">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()} aria-label="VAudioFX">
          <span className="brand-symbol">
            <AudioLines size={23} />
          </span>
          <span>
            VAudio<span className="brand-fx">FX</span>
          </span>
          <small>SOUND LAB</small>
        </a>
        <div className="project-heading">
          <input
            aria-label="Project name"
            value={project.name}
            maxLength={100}
            onChange={(e) => change({ ...project, name: e.target.value || 'Untitled sound' })}
          />
          <span>
            <span className="local-dot" /> LOCAL PROJECT
          </span>
        </div>
        <div className="header-actions">
          <Button label="New project" onClick={() => void createNew()} disabled={!ready || !!busy}>
            <FilePlus2 size={16} />
          </Button>
          <Button
            label="Open project"
            onClick={() => void openProjects()}
            disabled={!ready || !!busy}
          >
            <FolderOpen size={16} />
          </Button>
          <Button
            label="Save project locally (Ctrl+S)"
            onClick={() =>
              void save()
                .then(() => setMessage('Project saved locally.'))
                .catch(report)
            }
            disabled={!ready || !!busy}
          >
            <Save size={16} />
          </Button>
          <i />
          <Button label="Undo (Ctrl+Z)" disabled={!projectStore.canUndo} onClick={undo}>
            <Undo2 size={16} />
          </Button>
          <Button label="Redo (Ctrl+Shift+Z)" disabled={!projectStore.canRedo} onClick={redo}>
            <Redo2 size={16} />
          </Button>
          <i />
          <Button
            onClick={() => {
              stop(false);
              setModal('record');
            }}
            disabled={!ready || !!busy}
          >
            <Mic size={16} /> Record
          </Button>
          <Button
            className="primary"
            onClick={() => setModal('export')}
            disabled={!hasClips || !!busy}
          >
            <Download size={16} /> Export {project.export.format.toUpperCase()}
          </Button>
        </div>
      </header>
      <div className="workspace">
        <Library
          assets={assets}
          preferences={preferences}
          onAdd={(a) => add(a)}
          onPreview={(a) => void preview(a)}
          onImport={() => audioInput.current?.click()}
          onRecord={() => {
            stop(false);
            setModal('record');
          }}
          onFavorite={(id) =>
            preferenceChange({
              favorites: preferences.favorites.includes(id)
                ? preferences.favorites.filter((i) => i !== id)
                : [...preferences.favorites, id],
            })
          }
          onPack={(id) => void cachePack(id)}
          onTemplate={(id) => void template(id)}
          creativeBusy={!!busy || !ready}
          onGenerate={() => {
            stop(false);
            setModal('generate');
          }}
          onRecipe={(id) => {
            stop(false);
            recipeSession.current++;
            setRecipeId(id);
            setRecipeStep(0);
            setRecipeTarget('');
          }}
          onLicenses={() => setModal('licenses')}
          onRename={(a) => void renameAsset(a)}
          onDelete={(a) => void deleteAsset(a)}
          downloading={downloading}
        />
        <div className="editor-center">
          <div className="creative-heading">
            <div>
              <span className="eyebrow">MAKE SOMETHING ORIGINAL</span>
              <h1>Little layers. Big sounds.</h1>
            </div>
            <button className="learn-button" onClick={() => setModal('help')}>
              <CircleHelp size={16} /> Quick guide
            </button>
          </div>
          {activeRecipe && (
            <RecipeGuide
              recipe={activeRecipe}
              step={recipeStep}
              busy={!!busy}
              hasClips={hasClips}
              canAct={
                activeRecipe.steps[recipeStep].action === 'use-voice'
                  ? !!clip &&
                    !!selectedAsset &&
                    ['recording', 'import'].includes(selectedAsset.kind)
                  : ['fireball', 'ui'].includes(activeRecipe.steps[recipeStep].action ?? '') ||
                    !!recipeClip
              }
              onAction={() => void recipeAction()}
              onStep={setRecipeStep}
              onRecord={() => {
                stop(false);
                setModal('record');
              }}
              onPreview={() => void play()}
              onExport={() => {
                if (project.export.format !== 'wav')
                  change({ ...project, export: { ...project.export, format: 'wav' } });
                stop(false);
                setModal('export');
              }}
              onClose={() => {
                stop(false);
                recipeSession.current++;
                setRecipeId('');
              }}
            />
          )}
          <div className="transport">
            <div className="transport-buttons">
              <Button label="Stop playback" onClick={() => stop()}>
                <Square size={15} fill="currentColor" />
              </Button>
              <Button
                className="play-button"
                label={playing ? 'Pause playback' : 'Play composition'}
                onClick={() => void play()}
                disabled={!hasClips || !!busy}
              >
                {playing ? (
                  <Pause size={19} fill="currentColor" />
                ) : (
                  <Play size={19} fill="currentColor" />
                )}
              </Button>
              <span className="time-display">
                {formatTime(position)}
                <small> / {formatTime(projectDuration(project))}</small>
              </span>
            </div>
            <div className="monitor-volume">
              <Volume2 size={15} />
              <input
                type="range"
                aria-label="Preview volume"
                value={volume}
                min={0}
                max={100}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  playback.setVolume(Number(e.target.value) / 100);
                }}
              />
              <span>{volume}%</span>
            </div>
          </div>
          <LoopControls project={project} clip={clip} onChange={change} />
          <Timeline
            project={project}
            assets={assets}
            selectedClip={selectedClip}
            selectedTrack={selectedTrack}
            position={position}
            onChange={change}
            onSelectClip={(id) => {
              setSelectedClip(id);
              setSelectedTrack(
                projectStore.getSnapshot().tracks.find((t) => t.clips.some((c) => c.id === id))
                  ?.id ?? '',
              );
            }}
            onSelectTrack={(id) => {
              setSelectedTrack(id);
              setSelectedClip('');
            }}
            onSeek={(time) => {
              stop(false);
              setPosition(time);
            }}
            onDrop={(a, id, time) => add(a, id, time)}
            onDuplicate={duplicateClip}
            onSplit={() => {
              if (clip) change(splitClip(project, clip.id, position));
            }}
            onDelete={removeClip}
            onAddTrack={() =>
              change({ ...project, tracks: [...project.tracks, makeTrack(project.tracks.length)] })
            }
            onRecord={() => {
              stop(false);
              setModal('record');
            }}
          />
          <div className="workflow-note">
            <span>
              <Check size={13} /> Non-destructive editing
            </span>
            <span>
              <Check size={13} /> No accounts. No uploads.
            </span>
            <span>
              <Check size={13} /> Game-ready PCM WAV
            </span>
          </div>
        </div>
        <Inspector
          project={project}
          clip={clip}
          track={track}
          asset={selectedAsset}
          onClip={editSelected}
          onTrack={editTrack}
          onProject={change}
          position={position}
          onSeek={(time) => {
            stop(false);
            setPosition(time);
          }}
          cleanupBusy={cleanupBusy}
          onTrimSilence={() => void trimSilence()}
          onRepeat={(total) => {
            if (clip) {
              try {
                change(repeatClip(project, clip.id, total));
              } catch (error) {
                report(error);
              }
            }
          }}
          onDeleteTrack={() => {
            if (track) {
              change({ ...project, tracks: project.tracks.filter((t) => t.id !== track.id) });
              setSelectedTrack('');
            }
          }}
        />
      </div>
      <footer className="app-status">
        <span
          className={saved.includes('fail') || saved.includes('unavailable') ? 'status-error' : ''}
        >
          <span className="local-dot" /> {saved}
        </span>
        <span aria-live="polite">
          {busy || message || `${builtinSamples.length} CC0 samples · Your originals stay yours`}
        </span>
        {(pendingRender.current || pendingEncode.current || pendingPackage.current) && busy && (
          <Button
            onClick={() => {
              stop(false);
              setMessage('Audio work canceled.');
            }}
          >
            {pendingPackage.current ? 'Cancel project work' : 'Cancel audio work'}
          </Button>
        )}
        <Button label="Help and keyboard shortcuts" onClick={() => setModal('help')}>
          <CircleHelp size={14} />
        </Button>
      </footer>
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            ×
          </button>
        </div>
      )}
      <input
        ref={audioInput}
        type="file"
        accept=".wav,.ogg,.mp3,.m4a,.aac,.flac,.webm,.opus"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importAudio(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={projectInput}
        type="file"
        accept=".vafx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importProject(file);
          e.target.value = '';
        }}
      />
      {modal === 'record' && (
        <Recording position={position} onTake={take} onClose={() => setModal('')} />
      )}
      {modal === 'generate' && (
        <Generator
          hasTrack={!!track}
          onCreate={createSound}
          onClose={() => {
            stop(false);
            setModal('');
          }}
        />
      )}
      {modal === 'export' && (
        <Modal
          title="Export a game-ready sound"
          onClose={() => {
            stop(false);
            setModal('');
          }}
        >
          <div className="dialog-body">
            <p>Your complete mix, encoded locally from the same render used for preview.</p>
            <label className="field">
              Format
              <select
                aria-label="Export format"
                value={project.export.format}
                onChange={(e) =>
                  change({
                    ...project,
                    export: {
                      ...project.export,
                      format: e.target.value as Project['export']['format'],
                    },
                  })
                }
              >
                <option value="wav">WAV — lossless 16-bit PCM</option>
                <option value="ogg">OGG — Vorbis quality 5</option>
                <option value="mp3">MP3 — 192 kbps</option>
              </select>
            </label>
            <p className="help">
              OGG and MP3 use lossy compression. Encoder or browser decoder padding can change
              playback length; use WAV for precisely timed one-shots and seamless loops.
            </p>
            <label className="field">
              Sample rate
              <select
                aria-label="Export sample rate"
                value={project.export.sampleRate}
                onChange={(e) =>
                  change({
                    ...project,
                    export: {
                      ...project.export,
                      sampleRate: Number(e.target.value) as 44100 | 48000,
                    },
                  })
                }
              >
                <option value={48000}>48 kHz — game audio</option>
                <option value={44100}>44.1 kHz</option>
              </select>
            </label>
            <label className="field">
              Channels
              <select
                aria-label="Export channels"
                value={project.export.channels}
                onChange={(e) =>
                  change({
                    ...project,
                    export: { ...project.export, channels: Number(e.target.value) as 1 | 2 },
                  })
                }
              >
                <option value={2}>Stereo — preserves panning</option>
                <option value={1}>Mono — smaller files</option>
              </select>
            </label>
            <label className="check-control">
              <input
                type="checkbox"
                checked={project.export.normalize}
                onChange={(e) =>
                  change({ ...project, export: { ...project.export, normalize: e.target.checked } })
                }
              />{' '}
              Peak normalization (target −1 dB, up to 10× gain)
            </label>
            <label className="check-control">
              <input
                type="checkbox"
                checked={project.export.limiter}
                onChange={(e) =>
                  change({ ...project, export: { ...project.export, limiter: e.target.checked } })
                }
              />
              Hard peak limiter (−1 dB ceiling)
            </label>
            <p className="help">
              Limiting clips peaks at the ceiling and can add distortion. Normalization scales the
              whole mix; limiting follows normalization when both are enabled.
            </p>
            <label className="field">
              Room & echo tail (seconds)
              <input
                aria-label="Export effect tail"
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={project.export.tail}
                onChange={(e) =>
                  change({
                    ...project,
                    export: {
                      ...project.export,
                      tail: Math.max(0, Math.min(10, Number(e.target.value))),
                    },
                  })
                }
              />
            </label>
            <p className="help">
              At least 1.5s preserves room tails; use 2.2s when room and echo are combined. Monitor
              volume changes listening level only.
            </p>
            <div className="export-preview">
              <AudioLines size={22} />
              <div>
                <strong>
                  {safeFilename(project.name)}.{project.export.format}
                </strong>
                <small>
                  {projectDuration(project).toFixed(2)}s · {project.export.sampleRate / 1000} kHz ·{' '}
                  {project.export.channels === 2 ? 'stereo' : 'mono'}
                </small>
              </div>
            </div>
            <div className="dialog-actions">
              <Button
                onClick={() =>
                  change({
                    ...project,
                    export: {
                      format: 'wav',
                      sampleRate: 48000,
                      channels: 1,
                      normalize: true,
                      limiter: false,
                      tail: 2.2,
                    },
                  })
                }
              >
                Phaser / Web Game preset
              </Button>
              <Button className="primary" onClick={() => void exportAudio()} disabled={!!busy}>
                <Download size={15} /> {busy || `Download ${project.export.format.toUpperCase()}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {modal === 'projects' && (
        <Modal
          title="Your projects"
          wide
          onClose={() => {
            pendingPackage.current?.abort();
            setModal('');
          }}
        >
          <div className="dialog-body">
            <p>
              Local projects live in this browser. A portable .vafx backup includes the original
              audio and can move between devices.
            </p>
            <div className="project-actions">
              <Button onClick={() => projectInput.current?.click()} disabled={!!busy}>
                <Upload size={15} /> Import .vafx
              </Button>
              <Button onClick={() => void portable()} disabled={!hasClips || !!busy}>
                <Download size={15} /> Portable backup
              </Button>
              <Button onClick={() => void saveAs()} disabled={!!busy}>
                <Copy size={15} /> Save as a copy
              </Button>
              {pendingPackage.current && busy && (
                <Button onClick={() => pendingPackage.current?.abort()}>Cancel project work</Button>
              )}
            </div>
            <div className="project-list">
              {projects.map((p) => (
                <div key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {new Date(p.updatedAt).toLocaleString()} ·{' '}
                      {p.tracks.flatMap((t) => t.clips).length} clips
                    </small>
                  </div>
                  <Button onClick={() => void openLocal(p)}>Open</Button>
                  <Button
                    label={`Delete project ${p.name}`}
                    onClick={() => {
                      if (p.id === project.id) {
                        report(
                          new Error('Open a different project before deleting the active project.'),
                        );
                        return;
                      }
                      if (
                        window.confirm(
                          `Delete the local project “${p.name}”? Original audio remains in the library.`,
                        )
                      )
                        void database
                          .deleteProject(p.id)
                          .then(() =>
                            setProjects((previous) => previous.filter((item) => item.id !== p.id)),
                          )
                          .catch(report);
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {!projects.length && (
                <p className="help">Your first project will appear here after a local save.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
      {modal === 'licenses' && (
        <Modal title="Sound sources & licenses" wide onClose={() => setModal('')}>
          <div className="dialog-body">
            <p>
              {builtinSamples.length} original sound files by Kenney. License verification includes
              the publisher page, included license files, and SHA-256 hashes in the asset manifest.
            </p>
            <div className="license-grid">
              <a href="/third-party/index.html" target="_blank" rel="noreferrer">
                Audio DSP / encoder licenses & corresponding source ↗
              </a>
              <a href="/licenses/runtime-software.txt" target="_blank" rel="noreferrer">
                All runtime software notices ↗
              </a>
              <a href="https://kenney.nl/assets/impact-sounds" target="_blank" rel="noreferrer">
                Impact Sounds · Kenney · CC0 ↗
              </a>
              <a href="/licenses/kenney-impact.txt" target="_blank" rel="noreferrer">
                Read included impact license ↗
              </a>
              <a href="https://kenney.nl/assets/rpg-audio" target="_blank" rel="noreferrer">
                RPG Audio · Kenney · CC0 ↗
              </a>
              <a href="/licenses/kenney-rpg.txt" target="_blank" rel="noreferrer">
                Read included RPG license ↗
              </a>
            </div>
            <p>
              Procedural template sources are generated locally by VAudioFX and dedicated to CC0.
              You retain ownership of imported files and microphone recordings; their source
              licenses still apply.
            </p>
            <a
              href="https://creativecommons.org/publicdomain/zero/1.0/"
              target="_blank"
              rel="noreferrer"
            >
              Read the CC0 public-domain dedication ↗
            </a>
          </div>
        </Modal>
      )}
      {modal === 'help' && (
        <Modal title="From a little noise to a game sound" onClose={() => setModal('')}>
          <div className="dialog-body guide">
            <ol>
              <li>
                <strong>Find your starting point.</strong> Preview a library sound, import a file,
                or record a take.
              </li>
              <li>
                <strong>Build with layers.</strong> Add sounds with + or drag them onto the
                timeline. Move clips and drag their edges to trim.
              </li>
              <li>
                <strong>Make it yours.</strong> Select a clip. Lower depth for a creature voice, add
                dirt, or darken the sound. Your original stays intact.
              </li>
              <li>
                <strong>Hear the whole thing.</strong> Press Space. Click the ruler to choose where
                playback starts.
              </li>
              <li>
                <strong>Keep it and ship it.</strong> Local autosave keeps edits. Download a .vafx
                backup from Open, then export WAV for your game.
              </li>
            </ol>
            <p className="help">
              Ctrl+S saves · Ctrl+Z undoes · Ctrl+Shift+Z redoes · Ctrl+D duplicates · S splits at
              the playhead · Delete removes the selected clip. Focus a clip and use arrows to nudge;
              Shift moves it 50 ms. Home/End seeks. Depth/speed changes duration; independent pitch
              preserves it. Browser storage may be cleared or evicted, so download portable backups
              of important work.
            </p>
            <StorageStatus />
            {renderFootprint && <p className="help">{renderFootprint}</p>}
          </div>
        </Modal>
      )}
    </main>
  );
}
