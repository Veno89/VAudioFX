import type { LoopRegion } from '../domain/model';

export class PlaybackEngine {
  private context?: AudioContext;
  private source?: AudioBufferSourceNode;
  private gain?: GainNode;
  private began = 0;
  private offset = 0;
  private end = 0;
  private volume = 0.35;
  private generation = 0;
  private loop?: LoopRegion;
  get playing() {
    return !!this.source;
  }
  get position() {
    if (!this.source || !this.context) return this.offset;
    const time = this.offset + this.context.currentTime - this.began;
    return this.loop
      ? this.loop.start + ((time - this.loop.start) % (this.loop.end - this.loop.start))
      : Math.min(this.end, time);
  }
  async play(
    buffer: AudioBuffer,
    position = 0,
    onEnd?: () => void,
    loop?: LoopRegion,
  ): Promise<void> {
    this.stop();
    if (
      loop?.enabled &&
      (!Number.isFinite(loop.start) ||
        !Number.isFinite(loop.end) ||
        loop.start < 0 ||
        loop.end > buffer.duration + 1e-6 ||
        loop.end - loop.start < 0.05 - 1e-9)
    )
      throw new Error(
        'The audition loop must fit within the rendered audio and be at least 50 ms long.',
      );
    const generation = this.generation;
    if (!this.context || this.context.state === 'closed') this.context = new AudioContext();
    await this.context.resume();
    if (generation !== this.generation) return;
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.value = this.volume;
    source.connect(gain).connect(this.context.destination);
    this.source = source;
    this.gain = gain;
    this.offset = Math.min(position, Math.max(0, buffer.duration - 0.001));
    this.loop = loop?.enabled ? { ...loop } : undefined;
    if (this.loop) {
      source.loop = true;
      source.loopStart = this.loop.start;
      source.loopEnd = this.loop.end;
      if (this.offset < this.loop.start || this.offset >= this.loop.end)
        this.offset = this.loop.start;
    }
    this.end = buffer.duration;
    this.began = this.context.currentTime;
    source.onended = () => {
      if (this.source !== source) return;
      this.source = undefined;
      this.offset = 0;
      source.disconnect();
      gain.disconnect();
      onEnd?.();
    };
    source.start(0, this.offset);
  }
  pause() {
    const position = this.position;
    this.stop();
    this.offset = position;
    return position;
  }
  stop() {
    this.generation++;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.gain?.disconnect();
      this.source = undefined;
    }
    this.offset = 0;
    this.loop = undefined;
  }
  setVolume(value: number) {
    this.volume = value;
    if (this.context && this.gain)
      this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.015);
  }
  async dispose() {
    this.stop();
    await this.context?.close();
  }
}
export const playback = new PlaybackEngine();
