import { audioWork } from '../audio/work';
import type { ExportSettings } from '../domain/model';
export async function encodeAudio(
  buffer: AudioBuffer,
  format: ExportSettings['format'],
  signal?: AbortSignal,
): Promise<Blob> {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c).slice(),
  );
  return (
    await audioWork({ kind: 'encode', channels, sampleRate: buffer.sampleRate, format }, signal)
  ).blob;
}
