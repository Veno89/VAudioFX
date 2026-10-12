export function encodeWav(
  buffer: Pick<AudioBuffer, 'sampleRate' | 'numberOfChannels' | 'length' | 'getChannelData'>,
): Blob {
  const channels = buffer.numberOfChannels,
    bytes = buffer.length * channels * 2;
  const array = new ArrayBuffer(44 + bytes),
    view = new DataView(array);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  for (let i = 0; i < buffer.length; i++)
    for (let c = 0; c < channels; c++) {
      const value = Math.max(-1, Math.min(1, data[c][i]));
      if (!Number.isFinite(value)) throw new Error('Cannot encode invalid audio samples.');
      view.setInt16(
        44 + (i * channels + c) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
  return new Blob([array], { type: 'audio/wav' });
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const safeFilename = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 70) || 'sound_effect';
