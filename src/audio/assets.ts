import { LIMITS, uid, type Asset } from '../domain/model';
import { database } from '../storage/database';
import { preflightAudio } from './preflight';

const supported = /\.(wav|ogg|mp3|m4a|aac|flac|webm|opus)$/i;
export class AssetRepository {
  private decoded = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer>>();
  private context?: AudioContext;
  private queue: Promise<unknown> = Promise.resolve();
  private memoryBytes = 0;
  async decode(asset: Asset): Promise<AudioBuffer> {
    const cached = this.decoded.get(asset.id);
    if (cached) return cached;
    const current = this.pending.get(asset.id);
    if (current) return current;
    const task = this.queue.then(async () => {
      let blob = asset.blob;
      if (!blob && asset.url) {
        const response = await fetch(asset.url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok)
          throw new Error(
            `Could not load ${asset.name}. Try again when the sample host is available.`,
          );
        blob = await response.blob();
      }
      if (!blob || !blob.size || blob.size > LIMITS.fileBytes)
        throw new Error('Audio file is missing or exceeds 30 MB.');
      const encoded = await blob.arrayBuffer();
      preflightAudio(new Uint8Array(encoded));
      if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
      let audio: AudioBuffer;
      try {
        audio = await this.context.decodeAudioData(encoded);
      } catch {
        throw new Error('This audio format could not be decoded. Try a WAV, OGG, or MP3 file.');
      }
      if (audio.duration > LIMITS.duration || audio.numberOfChannels > 2 || !audio.length)
        throw new Error('Use mono or stereo audio shorter than 2 minutes.');
      const bytes = audio.length * audio.numberOfChannels * 4;
      if (bytes > LIMITS.totalBytes)
        throw new Error('This decoded file exceeds the audio memory limit.');
      while (this.memoryBytes + bytes > LIMITS.totalBytes && this.decoded.size) {
        const entry = this.decoded.entries().next().value!;
        this.decoded.delete(entry[0]);
        this.memoryBytes -= entry[1].length * entry[1].numberOfChannels * 4;
      }
      this.decoded.set(asset.id, audio);
      this.memoryBytes += bytes;
      return audio;
    });
    this.queue = task.catch(() => undefined);
    this.pending.set(asset.id, task);
    try {
      return await task;
    } finally {
      this.pending.delete(asset.id);
    }
  }
  async import(blob: Blob, name: string, kind: 'import' | 'recording' = 'import'): Promise<Asset> {
    if (kind === 'import' && !supported.test(name))
      throw new Error('Choose a WAV, OGG, MP3, FLAC, M4A, AAC, Opus, or WebM audio file.');
    if (!blob.size || blob.size > LIMITS.fileBytes)
      throw new Error('Choose a non-empty audio file smaller than 30 MB.');
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    const formats: Record<string, string> = {
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      flac: 'audio/flac',
      opus: 'audio/opus',
      ogg: 'audio/ogg',
      webm: 'audio/webm',
    };
    const asset: Asset = {
      id: uid(),
      name: name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Recording',
      kind,
      category: kind === 'recording' ? 'Recordings' : 'Imported',
      tags: [kind],
      duration: 0,
      size: blob.size,
      mime: formats[extension] || blob.type.split(';')[0] || 'application/octet-stream',
      originalFilename: name,
      blob,
    };
    const decoded = await this.decode(asset);
    asset.duration = decoded.duration;
    await database.saveAsset(asset);
    return asset;
  }
  async cachePack(assets: Asset[], onProgress: (done: number) => void): Promise<Asset[]> {
    const cached: Asset[] = [];
    for (const asset of assets) {
      const existing = await database.get<Asset>('assets', asset.id);
      if (existing?.blob) {
        cached.push(existing);
        onProgress(cached.length);
        continue;
      }
      if (!asset.url) continue;
      const response = await fetch(asset.url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok)
        throw new Error(
          `Pack download failed at ${asset.name}. Completed files remain cached; retry to finish.`,
        );
      const blob = await response.blob();
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (blob.size !== asset.size || hash !== asset.checksum)
        throw new Error('Sample integrity check failed. The file was not cached.');
      const saved = { ...asset, blob };
      await database.saveAsset(saved);
      cached.push(saved);
      onProgress(cached.length);
    }
    return cached;
  }
  async dispose() {
    this.decoded.clear();
    this.memoryBytes = 0;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
}
export const assetRepository = new AssetRepository();
