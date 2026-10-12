import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneRecorder } from '../src/audio/recorder';

class FakeRecorder {
  static latest: FakeRecorder;
  constructor() {
    FakeRecorder.latest = this;
  }
  static isTypeSupported() {
    return true;
  }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['captured audio']) });
    queueMicrotask(() => this.onstop?.());
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
}
describe('microphone lifecycle', () => {
  const stopTrack = vi.fn();
  const track = { stop: stopTrack, onended: null as (() => void) | null };
  const stream = { getTracks: () => [track] };
  const getUserMedia = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined),
    connect = vi.fn().mockReturnThis(),
    disconnect = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMedia.mockResolvedValue(stream);
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal(
      'AudioContext',
      class {
        destination = {};
        resume = vi.fn().mockResolvedValue(undefined);
        close = close;
        createMediaStreamSource() {
          return { connect, disconnect };
        }
        createAnalyser() {
          return {
            fftSize: 1024,
            getFloatTimeDomainData: (data: Float32Array) => data.fill(0),
            disconnect,
          };
        }
        createGain() {
          return { gain: { value: 0 }, connect, disconnect };
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());
  it('captures, pauses, resumes, stops, releases tracks, and repeats with separate blobs', async () => {
    const take = vi.fn(),
      error = vi.fn();
    const recorder = new MicrophoneRecorder(vi.fn(), take, error);
    await recorder.start();
    expect(recorder.state).toBe('recording');
    expect(connect).toHaveBeenCalledTimes(1);
    recorder.pause();
    expect(recorder.state).toBe('paused');
    recorder.resume();
    recorder.stop();
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
    await recorder.start();
    recorder.stop();
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(2));
    expect(error).not.toHaveBeenCalled();
    await recorder.dispose();
  });
  it.each(['NotAllowedError', 'NotFoundError'])('handles %s and permits retry', async (name) => {
    getUserMedia.mockRejectedValueOnce(new DOMException('Denied', name));
    const error = vi.fn(),
      recorder = new MicrophoneRecorder(vi.fn(), vi.fn(), error);
    await recorder.start();
    expect(error).toHaveBeenCalled();
    expect(recorder.state).toBe('idle');
    await recorder.start();
    expect(recorder.state).toBe('recording');
    await recorder.dispose();
    expect(stopTrack).toHaveBeenCalled();
  });
  it('releases a permission stream arriving after cancellation', async () => {
    let resolve!: (value: unknown) => void;
    getUserMedia.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const take = vi.fn(),
      recorder = new MicrophoneRecorder(vi.fn(), take, vi.fn());
    const starting = recorder.start();
    recorder.stop();
    resolve(stream);
    await starting;
    expect(stopTrack).toHaveBeenCalled();
    expect(recorder.state).toBe('idle');
    expect(take).not.toHaveBeenCalled();
  });
  it('recovers an interrupted recording and disables monitoring', async () => {
    const take = vi.fn(),
      error = vi.fn(),
      recorder = new MicrophoneRecorder(vi.fn(), take, error);
    await recorder.start(undefined, true);
    expect(track.onended).toBeTypeOf('function');
    track.onended?.();
    await vi.waitFor(() => expect(take).toHaveBeenCalled());
    expect(error).toHaveBeenCalled();
    expect(track.onended).toBe(null);
    expect(disconnect).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    await recorder.dispose();
  });
  it('recovers encoder failure and also releases tracks on unmount', async () => {
    const error = vi.fn(),
      take = vi.fn();
    const recorder = new MicrophoneRecorder(vi.fn(), take, error);
    await recorder.start();
    FakeRecorder.latest.onerror?.();
    await vi.waitFor(() => expect(take).toHaveBeenCalled());
    expect(error).toHaveBeenCalled();
    await recorder.start();
    await recorder.dispose();
    expect(stopTrack).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalled();
    expect(recorder.state).toBe('idle');
  });
  it('freezes the elapsed time when a take stops', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const recorder = new MicrophoneRecorder(vi.fn(), vi.fn(), vi.fn());
    try {
      await recorder.start();
      clock.mockReturnValue(2000);
      expect(recorder.duration).toBe(1);
      recorder.stop();
      clock.mockReturnValue(4000);
      await vi.waitFor(() => expect(recorder.state).toBe('idle'));
      expect(recorder.duration).toBe(1);
    } finally {
      await recorder.dispose();
      clock.mockRestore();
    }
  });
});
