export type RecordingState = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping';
export class MicrophoneRecorder {
  private stream?: MediaStream;
  private media?: MediaRecorder;
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private input?: MediaStreamAudioSourceNode;
  private monitor?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private chunks: Blob[] = [];
  private began = 0;
  private pausedAt = 0;
  private pausedFor = 0;
  private finishedDuration = 0;
  state: RecordingState = 'idle';
  constructor(
    private onState: (state: RecordingState) => void,
    private onTake: (blob: Blob) => void,
    private onError: (error: Error) => void,
  ) {}
  get duration() {
    if (this.state === 'idle' || this.state === 'stopping') return this.finishedDuration;
    return this.began
      ? Math.max(
          0,
          ((this.state === 'paused' ? this.pausedAt : performance.now()) -
            this.began -
            this.pausedFor) /
            1000,
        )
      : 0;
  }
  private setState(state: RecordingState) {
    this.state = state;
    this.onState(state);
  }
  async start(deviceId?: string, monitoring = false) {
    if (this.state !== 'idle') return;
    this.began = 0;
    this.finishedDuration = 0;
    const generation = ++this.generation;
    this.setState('requesting');
    try {
      if (
        !globalThis.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !globalThis.MediaRecorder
      )
        throw new Error('Recording requires a supported browser on HTTPS or localhost.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.context = new AudioContext();
      await this.context.resume();
      if (generation !== this.generation) {
        await this.cleanup();
        return;
      }
      this.input = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.input.connect(this.analyser);
      this.setMonitoring(monitoring);
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(
        (mime) => MediaRecorder.isTypeSupported(mime),
      );
      const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.media = media;
      this.chunks = [];
      media.ondataavailable = (event) => {
        if (event.data.size) this.chunks.push(event.data);
      };
      media.onerror = () => {
        this.onError(
          new Error('Recording failed. Any captured audio will be recovered if possible.'),
        );
        this.stop();
      };
      media.onstop = () => {
        this.finishedDuration = this.duration;
        const blob = new Blob(this.chunks, { type: media.mimeType });
        this.chunks = [];
        void this.cleanup().then(() => {
          this.setState('idle');
          if (blob.size) this.onTake(blob);
          else
            this.onError(new Error('No audio was captured. Check your microphone and try again.'));
        });
      };
      stream.getTracks().forEach((track) => {
        track.onended = () => {
          this.onError(
            new Error(
              'The microphone disconnected or permission was revoked. Captured audio is being recovered.',
            ),
          );
          this.stop();
        };
      });
      this.began = performance.now();
      this.pausedFor = 0;
      media.start(250);
      this.setState('recording');
      this.timer = setInterval(() => {
        if (
          this.duration >= 120 ||
          this.chunks.reduce((sum, chunk) => sum + chunk.size, 0) >= 30 * 1024 * 1024
        )
          this.stop();
      }, 250);
    } catch (error) {
      if (generation !== this.generation) return;
      await this.cleanup();
      this.setState('idle');
      const name = error instanceof Error ? error.name : '';
      this.onError(
        new Error(
          name === 'NotAllowedError'
            ? 'Microphone permission was denied. Allow microphone access in your browser and try again.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'The selected microphone is unavailable. Choose another device.'
              : error instanceof Error
                ? error.message
                : 'Could not start the microphone.',
        ),
      );
    }
  }
  pause() {
    if (this.media?.state === 'recording') {
      this.media.pause();
      this.pausedAt = performance.now();
      this.setState('paused');
    }
  }
  resume() {
    if (this.media?.state === 'paused') {
      this.pausedFor += performance.now() - this.pausedAt;
      this.media.resume();
      this.setState('recording');
    }
  }
  stop() {
    if (this.state === 'requesting') {
      this.generation++;
      void this.cleanup();
      this.setState('idle');
      return;
    }
    if (this.media && this.media.state !== 'inactive') {
      this.finishedDuration = this.duration;
      this.setState('stopping');
      this.media.stop();
      this.releaseTracks();
    }
  }
  setMonitoring(enabled: boolean) {
    if (this.monitor) {
      this.input?.disconnect(this.monitor);
      this.monitor.disconnect();
      this.monitor = undefined;
    }
    if (enabled && this.context && this.input) {
      this.monitor = this.context.createGain();
      this.monitor.gain.value = 0.25;
      this.input.connect(this.monitor).connect(this.context.destination);
    }
  }
  level() {
    if (!this.analyser) return 0;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let peak = 0;
    for (const value of data) peak = Math.max(peak, Math.abs(value));
    return peak;
  }
  private releaseTracks() {
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = undefined;
    this.setMonitoring(false);
  }
  private async cleanup() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.releaseTracks();
    this.input?.disconnect();
    this.analyser?.disconnect();
    const context = this.context;
    this.context = undefined;
    this.input = undefined;
    this.analyser = undefined;
    this.media = undefined;
    if (context && context.state !== 'closed') await context.close();
  }
  async dispose() {
    this.generation++;
    if (this.media) {
      this.media.onstop = null;
      this.media.ondataavailable = null;
      this.media.onerror = null;
      if (this.media.state !== 'inactive') this.media.stop();
    }
    this.chunks = [];
    await this.cleanup();
    this.state = 'idle';
  }
}
