export function peaksForRegion(
  buffer: AudioBuffer,
  start = 0,
  end = buffer.duration,
  count = 160,
  reverse = false,
): number[] {
  const from = Math.max(0, Math.floor(start * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
    buffer.getChannelData(c),
  );
  const peaks = Array.from({ length: count }, (_, bin) => {
    const a = from + Math.floor((bin * (to - from)) / count),
      b = from + Math.floor(((bin + 1) * (to - from)) / count);
    let peak = 0;
    for (const channel of channels)
      for (let i = a; i < Math.max(a + 1, b) && i < to; i++)
        peak = Math.max(peak, Math.abs(channel[i]));
    return peak;
  });
  return reverse ? peaks.reverse() : peaks;
}
