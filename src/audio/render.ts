import { audibleTracks, LIMITS, projectDuration, type Asset, type Project } from '../domain/model';
import { assetRepository } from './assets';
import { scheduleGraph, needsPreparation, preparationKey } from './graph';
import { audioWork } from './work';

export interface RenderResult {
  buffer: AudioBuffer;
  peak: number;
  limitedSamples: number;
  memory: { decodedBytes: number; preparedBytes: number; renderedBytes: number };
}

let rendering = false;
export async function renderProject(
  project: Project,
  assets: Asset[],
  signal?: AbortSignal,
): Promise<RenderResult> {
  signal?.throwIfAborted();
  if (rendering)
    throw new Error('A render is still finishing. Try playback or export again in a moment.');
  rendering = true;
  try {
    return await renderCurrentProject(project, assets, signal);
  } finally {
    rendering = false;
  }
}

async function renderCurrentProject(
  project: Project,
  assets: Asset[],
  signal?: AbortSignal,
): Promise<RenderResult> {
  const duration = projectDuration(project);
  if (!project.tracks.some((t) => t.clips.length))
    throw new Error('Add a sound to the timeline before exporting or playing.');
  if (duration <= 0 || duration > LIMITS.duration + 10)
    throw new Error('The project is too long to render.');
  const clips = audibleTracks(project).flatMap((t) => t.clips);
  const ids = [...new Set(clips.map((c) => c.assetId))];
  const buffers = new Map<string, AudioBuffer>();
  let bytes = 0;
  for (const id of ids) {
    const asset = assets.find((a) => a.id === id);
    if (!asset) throw new Error('A project source is missing. Reimport the portable backup.');
    const buffer = await assetRepository.decode(asset);
    signal?.throwIfAborted();
    bytes += buffer.length * buffer.numberOfChannels * 4;
    if (bytes > LIMITS.totalBytes)
      throw new Error('This composition exceeds the 150 MB decoded audio limit.');
    buffers.set(id, buffer);
  }
  const context = new OfflineAudioContext(
    project.export.channels,
    Math.ceil(duration * project.export.sampleRate),
    project.export.sampleRate,
  );
  const prepared = new Map<string, AudioBuffer>();
  let preparedBytes = 0;
  for (const clip of clips) {
    signal?.throwIfAborted();
    const source = buffers.get(clip.assetId)!;
    const asset = assets.find((a) => a.id === clip.assetId)!;
    // Compressed source metadata and native decoders can disagree about priming/padding.
    // Preserve the declared timeline endpoint while preparing only decoded source frames.
    if (
      clip.trimEnd > Math.max(asset.duration, source.duration) + 1 / source.sampleRate ||
      clip.trimStart >= source.duration
    )
      throw new Error(`Source trim exceeds available audio: ${clip.name}`);
    const key = preparationKey(clip);
    if (!needsPreparation(clip) || prepared.has(key)) continue;
    const first = Math.floor(clip.trimStart * source.sampleRate),
      last = Math.min(source.length, Math.ceil(clip.trimEnd * source.sampleRate));
    preparedBytes += (last - first) * source.numberOfChannels * 4;
    if (preparedBytes > LIMITS.totalBytes)
      throw new Error('Prepared audio exceeds the 150 MB processing limit.');
    const channels = Array.from({ length: source.numberOfChannels }, (_, c) =>
      source.getChannelData(c).slice(first, last),
    );
    const result = await audioWork(
      {
        kind: 'prepare',
        channels,
        sampleRate: source.sampleRate,
        cleanup: clip.cleanup,
        reverse: clip.reverse,
        pitch: clip.pitchSemitones,
      },
      signal,
    );
    const buffer = context.createBuffer(source.numberOfChannels, last - first, source.sampleRate);
    result.channels.forEach((channel, c) => buffer.copyToChannel(channel, c));
    prepared.set(key, buffer);
  }
  signal?.throwIfAborted();
  const graph = scheduleGraph(context, project, buffers, context.destination, 0, 0, prepared);
  // Web Audio has no native close/cancel for OfflineAudioContext. Stop and disconnect the
  // graph immediately; retain the render lock until the bounded native render finishes.
  const cancel = () => graph.stop();
  signal?.addEventListener('abort', cancel, { once: true });
  let buffer: AudioBuffer;
  try {
    buffer = await context.startRendering();
  } finally {
    graph.stop();
    signal?.removeEventListener('abort', cancel);
  }
  signal?.throwIfAborted();
  const mastered = await audioWork(
    {
      kind: 'master',
      channels: Array.from({ length: buffer.numberOfChannels }, (_, c) =>
        buffer.getChannelData(c).slice(),
      ),
      normalize: project.export.normalize,
      limiter: project.export.limiter,
    },
    signal,
  );
  mastered.channels.forEach((channel, c) => buffer.copyToChannel(channel, c));
  const { peak, limitedSamples } = mastered;
  return {
    buffer,
    peak,
    limitedSamples,
    memory: {
      decodedBytes: bytes,
      preparedBytes,
      renderedBytes: buffer.length * buffer.numberOfChannels * 4,
    },
  };
}
