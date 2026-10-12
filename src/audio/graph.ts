import { audibleTracks, clipDuration, LIMITS, type Clip, type Project } from '../domain/model';
import { processCleanup } from './cleanup';
import { automationAt, type AutomationPoint } from '../domain/automation';

export const preparationKey = (clip: Clip) =>
  JSON.stringify([
    clip.assetId,
    clip.trimStart,
    clip.trimEnd,
    clip.reverse,
    clip.cleanup,
    clip.pitchSemitones,
  ]);
export const needsPreparation = (clip: Clip) =>
  clip.reverse ||
  clip.cleanup.gateEnabled ||
  clip.cleanup.normalize ||
  clip.cleanup.dcRemove ||
  clip.cleanup.humHz !== 0 ||
  clip.pitchSemitones !== 0;

export function envelopeAt(
  time: number,
  duration: number,
  fadeIn: number,
  fadeOut: number,
): number {
  return Math.max(
    0,
    Math.min(1, fadeIn ? time / fadeIn : 1, fadeOut ? (duration - time) / fadeOut : 1),
  );
}
export function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4096);
  const k = 1 + amount * 24;
  for (let i = 0; i < curve.length; i++) {
    const x = (i * 2) / (curve.length - 1) - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}
function impulse(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(2, Math.ceil(context.sampleRate * 1.5), context.sampleRate);
  let seed = 9173;
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = (seed / 2147483648 - 1) * (1 - i / data.length) ** 3;
    }
  }
  return buffer;
}
export interface GraphSession {
  sources: AudioBufferSourceNode[];
  stop: () => void;
}
export function scheduleGraph(
  context: BaseAudioContext,
  project: Project,
  buffers: Map<string, AudioBuffer>,
  output: AudioNode,
  at = 0,
  position = 0,
  prepared = new Map<string, AudioBuffer>(),
): GraphSession {
  const sources: AudioBufferSourceNode[] = [];
  const preparedBuffers = new Map<string, AudioBuffer>();
  let preparedBytes = 0;
  const nodes: AudioNode[] = [];
  let room: AudioBuffer | undefined;
  const trackNode = (track: Project['tracks'][number]) => {
    const gain = context.createGain(),
      pan = context.createStereoPanner();
    gain.gain.value = track.gain;
    pan.pan.value = track.pan;
    gain.connect(pan).connect(output);
    nodes.push(gain, pan);
    return gain;
  };
  for (const track of audibleTracks(project)) {
    const destination = trackNode(track);
    for (const clip of track.clips) {
      const buffer = buffers.get(clip.assetId);
      if (!buffer) throw new Error(`Missing audio: ${clip.name}`);
      const duration = clipDuration(clip);
      if (clip.start + duration <= position) continue;
      const source = context.createBufferSource();
      let sourceBuffer = buffer;
      let sourceOffset = clip.trimStart;
      if (needsPreparation(clip)) {
        const key = preparationKey(clip);
        const cached = prepared.get(key) ?? preparedBuffers.get(key);
        if (cached) sourceBuffer = cached;
        else {
          if (clip.pitchSemitones !== 0)
            throw new Error('Prepare independent pitch audio before scheduling.');
          const first = Math.floor(clip.trimStart * buffer.sampleRate);
          const last = Math.min(buffer.length, Math.ceil(clip.trimEnd * buffer.sampleRate));
          preparedBytes += (last - first) * buffer.numberOfChannels * 4;
          if (preparedBytes > LIMITS.totalBytes)
            throw new Error(
              'Cleanup and reversed regions exceed the 150 MB processing limit. Reduce the number of different regions.',
            );
          sourceBuffer = context.createBuffer(
            buffer.numberOfChannels,
            Math.max(1, last - first),
            buffer.sampleRate,
          );
          const channels: Float32Array<ArrayBuffer>[] = [];
          for (let c = 0; c < buffer.numberOfChannels; c++)
            channels.push(buffer.getChannelData(c).slice(first, last));
          processCleanup(channels, buffer.sampleRate, clip.cleanup);
          for (let c = 0; c < channels.length; c++)
            sourceBuffer.copyToChannel(clip.reverse ? channels[c].reverse() : channels[c], c);
          preparedBuffers.set(key, sourceBuffer);
        }
        sourceOffset = 0;
      }
      source.buffer = sourceBuffer;
      source.playbackRate.value = clip.rate;
      sources.push(source);
      nodes.push(source);
      const gain = context.createGain(),
        pan = context.createStereoPanner();
      pan.pan.value = clip.pan;
      const elapsed = Math.max(0, position - clip.start),
        when = at + Math.max(0, clip.start - position);
      scheduleEnvelope(gain.gain, clip, duration, elapsed, when);
      source.connect(gain);
      nodes.push(gain, pan);
      let last: AudioNode = gain;
      if (clip.automation.gain.length) {
        const automated = context.createGain();
        scheduleAutomation(automated.gain, clip.automation.gain, 1, duration, elapsed, when);
        last.connect(automated);
        last = automated;
        nodes.push(automated);
      }
      scheduleAutomation(pan.pan, clip.automation.pan, clip.pan, duration, elapsed, when);
      if (clip.effects.enabled) {
        for (const effect of clip.effects.order) {
          if (clip.effects.bypassed.includes(effect)) continue;
          if (effect === 'highpass' || effect === 'lowpass') {
            const filter = context.createBiquadFilter();
            filter.type = effect;
            filter.frequency.value = Math.min(clip.effects[effect], context.sampleRate / 2 - 1);
            if (effect === 'lowpass')
              scheduleAutomation(
                filter.frequency,
                clip.automation.lowpass,
                clip.effects.lowpass,
                duration,
                elapsed,
                when,
                context.sampleRate / 2 - 1,
              );
            filter.Q.value = 0.707;
            last.connect(filter);
            last = filter;
            nodes.push(filter);
          }
          if (effect === 'eq') {
            for (const [type, frequency, level] of [
              ['lowshelf', 180, clip.effects.eq.low],
              ['peaking', 1000, clip.effects.eq.mid],
              ['highshelf', 4500, clip.effects.eq.high],
            ] as const) {
              if (level === 0) continue;
              const filter = context.createBiquadFilter();
              filter.type = type;
              filter.frequency.value = Math.min(frequency, context.sampleRate / 2 - 1);
              filter.Q.value = 0.8;
              filter.gain.value = level;
              last.connect(filter);
              last = filter;
              nodes.push(filter);
            }
          }
          if (effect === 'compressor') {
            const compressor = context.createDynamicsCompressor(),
              settings = clip.effects.compressor;
            compressor.threshold.value = settings.threshold;
            compressor.ratio.value = settings.ratio;
            compressor.knee.value = settings.knee;
            compressor.attack.value = settings.attackMs / 1000;
            compressor.release.value = settings.releaseMs / 1000;
            last.connect(compressor);
            last = compressor;
            nodes.push(compressor);
          }
          if (effect === 'distortion' && clip.effects.distortion > 0) {
            const dirt = context.createWaveShaper();
            dirt.curve = distortionCurve(clip.effects.distortion);
            dirt.oversample = '2x';
            last.connect(dirt);
            last = dirt;
            nodes.push(dirt);
          }
          if (effect === 'reverb' && clip.effects.reverb > 0) {
            const wet = context.createGain(),
              reverb = context.createConvolver(),
              mix = context.createGain();
            room ??= impulse(context);
            reverb.buffer = room;
            wet.gain.value = clip.effects.reverb * 0.65;
            last.connect(reverb).connect(wet).connect(mix);
            last.connect(mix);
            last = mix;
            nodes.push(wet, reverb, mix);
          }
          if (effect === 'echo' && clip.effects.echo > 0) {
            const mix = context.createGain();
            last.connect(mix);
            for (let i = 1; i <= 3; i++) {
              const delay = context.createDelay(1),
                wet = context.createGain();
              delay.delayTime.value = i * 0.22;
              wet.gain.value = (clip.effects.echo * 0.55) ** i;
              last.connect(delay).connect(wet).connect(mix);
              nodes.push(delay, wet);
            }
            last = mix;
            nodes.push(mix);
          }
        }
      }
      last.connect(pan).connect(destination);
      const offset = sourceOffset + elapsed * clip.rate;
      source.start(when, Math.max(0, offset), (duration - elapsed) * clip.rate);
    }
  }
  return {
    sources,
    stop: () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          /* An ended source is already stopped. */
        }
      }
      for (const node of nodes) node.disconnect();
    },
  };
}
function scheduleAutomation(
  param: AudioParam,
  points: AutomationPoint[],
  fallback: number,
  duration: number,
  elapsed: number,
  when: number,
  ceiling = Infinity,
) {
  param.setValueAtTime(Math.min(ceiling, automationAt(points, elapsed / duration, fallback)), when);
  for (const point of points)
    if (point.time * duration > elapsed)
      param.linearRampToValueAtTime(
        Math.min(ceiling, point.value),
        when + point.time * duration - elapsed,
      );
}
function scheduleEnvelope(
  param: AudioParam,
  clip: Clip,
  duration: number,
  elapsed: number,
  when: number,
) {
  const points = [elapsed, clip.fadeIn, duration - clip.fadeOut, duration];
  if (clip.fadeIn + clip.fadeOut > duration)
    points.push((duration * clip.fadeIn) / (clip.fadeIn + clip.fadeOut));
  param.setValueAtTime(clip.gain * envelopeAt(elapsed, duration, clip.fadeIn, clip.fadeOut), when);
  for (const time of [...new Set(points)].sort((a, b) => a - b))
    if (time > elapsed && time <= duration)
      param.linearRampToValueAtTime(
        clip.gain * envelopeAt(time, duration, clip.fadeIn, clip.fadeOut),
        when + time - elapsed,
      );
}
