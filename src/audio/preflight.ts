import { LIMITS } from '../domain/model';

/** Inspect supported container declarations before asking the native decoder to allocate PCM. */
export function preflightAudio(bytes: Uint8Array<ArrayBuffer>): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  const bounds = (channels: number, sampleRate: number, frames: number) => {
    if (
      channels < 1 ||
      channels > 2 ||
      sampleRate < 8000 ||
      sampleRate > 384000 ||
      frames > LIMITS.duration * sampleRate
    )
      throw new Error('Use mono or stereo audio no longer than 2 minutes.');
    if (frames * channels * 4 > LIMITS.totalBytes)
      throw new Error('This declared decoded file exceeds the audio memory limit.');
  };
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') {
    if (bytes.length < 12 || view.getUint32(4, true) + 8 !== bytes.length)
      throw new Error('WAV container length does not match its file.');
    let offset = 12,
      channels = 0,
      sampleRate = 0,
      blockAlign = 0,
      format = 0,
      dataBytes = 0;
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new Error('Truncated WAV chunk.');
      const size = view.getUint32(offset + 4, true),
        body = offset + 8;
      if (body + size > bytes.length) throw new Error('Truncated WAV audio.');
      if (text(offset, 4) === 'fmt ') {
        if (channels || size < 16) throw new Error('Invalid WAV format chunk.');
        format = view.getUint16(body, true);
        channels = view.getUint16(body + 2, true);
        sampleRate = view.getUint32(body + 4, true);
        blockAlign = view.getUint16(body + 12, true);
        const bits = view.getUint16(body + 14, true);
        bounds(channels, sampleRate, 0);
        if (
          !blockAlign ||
          ((format === 1 || format === 3 || format === 0xfffe) &&
            (![8, 16, 24, 32, 64].includes(bits) ||
              blockAlign !== (channels * bits) / 8 ||
              view.getUint32(body + 8, true) !== sampleRate * blockAlign))
        )
          throw new Error('Invalid WAV sample layout.');
      } else if (text(offset, 4) === 'data') dataBytes += size;
      else if (text(offset, 4) === 'fact' && size >= 4 && channels)
        bounds(channels, sampleRate, view.getUint32(body, true));
      offset = body + size + (size & 1);
    }
    if (!channels || !dataBytes || offset !== bytes.length)
      throw new Error('WAV audio is missing or truncated.');
    if (format === 1 || format === 3 || format === 0xfffe) {
      if (dataBytes % blockAlign) throw new Error('Truncated WAV sample frame.');
      bounds(channels, sampleRate, dataBytes / blockAlign);
    }
  } else if (text(0, 4) === 'OggS') {
    let offset = 0,
      serial: number | undefined,
      sampleRate = 0,
      channels = 0,
      preSkip = 0;
    while (offset < bytes.length) {
      if (offset + 27 > bytes.length || text(offset, 4) !== 'OggS' || bytes[offset + 4] !== 0)
        throw new Error('Invalid OGG page.');
      const count = bytes[offset + 26],
        body = offset + 27 + count;
      if (body > bytes.length) throw new Error('Truncated OGG page.');
      let size = 0;
      for (let i = offset + 27; i < body; i++) size += bytes[i];
      if (body + size > bytes.length) throw new Error('Truncated OGG audio.');
      const current = view.getUint32(offset + 14, true);
      if (serial === undefined) {
        serial = current;
        if (size >= 30 && text(body, 7) === '\x01vorbis') {
          channels = bytes[body + 11];
          sampleRate = view.getUint32(body + 12, true);
        } else if (size >= 19 && text(body, 8) === 'OpusHead') {
          channels = bytes[body + 9];
          sampleRate = 48000;
          preSkip = view.getUint16(body + 10, true);
        } else return; // Other OGG codecs continue through native format validation.
        bounds(channels, sampleRate, 0);
      }
      if (current !== serial) throw new Error('Use a single mono or stereo OGG stream.');
      const granule = view.getBigUint64(offset + 6, true);
      if (granule !== 0xffffffffffffffffn)
        bounds(channels, sampleRate, Math.max(0, Number(granule) - preSkip));
      offset = body + size;
    }
  }
  // Other supported containers use the native codec, followed by duration/channel/allocation checks.
}
