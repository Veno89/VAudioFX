import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Pause, Play, Download } from 'lucide-react';
import { MicrophoneRecorder, type RecordingState } from '../audio/recorder';
import { download } from '../export/wav';
import { Button, Modal, formatTime } from './ui';

export function Recording({
  onClose,
  onTake,
  position,
}: {
  onClose: () => void;
  onTake: (blob: Blob, name: string, atPlayhead: boolean) => Promise<void>;
  position: number;
}) {
  const [state, setState] = useState<RecordingState>('idle'),
    [duration, setDuration] = useState(0),
    [level, setLevel] = useState(0),
    [peak, setPeak] = useState(false),
    [error, setError] = useState(''),
    [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState(''),
    [monitor, setMonitor] = useState(false),
    [addToTimeline, setAddToTimeline] = useState(true),
    [name, setName] = useState(
      `Voice take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    ),
    [saving, setSaving] = useState(false),
    [failedTake, setFailedTake] = useState<Blob>();
  const takeHandler = useRef(onTake),
    nameRef = useRef(name),
    addRef = useRef(addToTimeline),
    closeAfterTake = useRef(false),
    closing = useRef(onClose);
  takeHandler.current = onTake;
  nameRef.current = name;
  addRef.current = addToTimeline;
  closing.current = onClose;
  const [recorder] = useState(
    () =>
      new MicrophoneRecorder(
        setState,
        (blob) => {
          setSaving(true);
          void takeHandler
            .current(blob, nameRef.current, addRef.current)
            .then(() => {
              setError('');
              setFailedTake(undefined);
              if (closeAfterTake.current) closing.current();
            })
            .catch((error) => {
              closeAfterTake.current = false;
              setFailedTake(blob);
              setError(
                `${error instanceof Error ? error.message : 'Take could not be saved.'} Download this take to keep it.`,
              );
            })
            .finally(() => setSaving(false));
        },
        (error) => setError(error.message),
      ),
  );
  useEffect(() => {
    const refresh = () => {
      if (navigator.mediaDevices?.enumerateDevices)
        void navigator.mediaDevices
          .enumerateDevices()
          .then((list) => setDevices(list.filter((d) => d.kind === 'audioinput')))
          .catch(() => undefined);
    };
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    const timer = setInterval(() => {
      setDuration(recorder.duration);
      const level = recorder.level();
      setLevel(level);
      if (level >= 0.98) setPeak(true);
    }, 70);
    const visibility = () => {
      if (document.visibilityState === 'hidden') recorder.stop();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      navigator.mediaDevices?.removeEventListener('devicechange', refresh);
      document.removeEventListener('visibilitychange', visibility);
      void recorder.dispose();
    };
  }, [recorder]);
  const active = state !== 'idle';
  const close = () => {
    if (saving || state === 'stopping') {
      closeAfterTake.current = true;
      return;
    }
    if (state === 'recording' || state === 'paused') {
      closeAfterTake.current = true;
      recorder.stop();
      return;
    }
    onClose();
  };
  return (
    <Modal title="Record an original sound" onClose={close}>
      <div className="recording-body">
        <div className={`recording-orb ${state === 'recording' ? 'recording-live' : ''}`}>
          <Mic size={34} />
        </div>
        <h3>
          {state === 'recording'
            ? 'Listening. Make it yours.'
            : state === 'paused'
              ? 'Recording paused'
              : state === 'requesting'
                ? 'Waiting for microphone permission…'
                : saving
                  ? 'Saving your original take…'
                  : 'Your voice is a sound library.'}
        </h3>
        <p className="help">Try a low gurgle, a breath, or a sharp snap. Shape it afterward.</p>
        <div className="recording-time">{formatTime(duration)}</div>
        <div
          className="meter"
          role="meter"
          aria-label="Microphone input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <div style={{ width: `${Math.min(100, level * 100)}%` }} />
        </div>
        <div className={`meter-caption ${peak ? 'clipping' : ''}`}>
          <span>INPUT LEVEL</span>
          <span>
            {peak
              ? 'Peak reached — move away from the mic'
              : 'Keep a little distance from the microphone'}
          </span>
        </div>
        <label className="field">
          Take name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          Microphone
          <select
            aria-label="Microphone device"
            value={device}
            disabled={active}
            onChange={(e) => setDevice(e.target.value)}
          >
            <option value="">System default</option>
            {devices
              .filter((d) => d.deviceId !== 'default')
              .map((d, index) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${index + 1}`}
                </option>
              ))}
          </select>
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={addToTimeline}
            disabled={active}
            onChange={(e) => setAddToTimeline(e.target.checked)}
          />{' '}
          Add take to timeline at {position.toFixed(2)}s
        </label>
        <label className="check-control">
          <input
            type="checkbox"
            checked={monitor}
            onChange={(e) => {
              setMonitor(e.target.checked);
              recorder.setMonitoring(e.target.checked);
            }}
          />{' '}
          Hear microphone through headphones
        </label>
        {monitor && (
          <p className="warning">Use headphones. Monitoring through speakers can cause feedback.</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {failedTake && (
          <Button
            onClick={() =>
              download(
                failedTake,
                `unsaved_take.${failedTake.type.includes('ogg') ? 'ogg' : failedTake.type.includes('mp4') ? 'm4a' : 'webm'}`,
              )
            }
          >
            <Download size={15} /> Download unsaved original
          </Button>
        )}
        <div className="record-buttons">
          {active ? (
            <>
              <Button
                className="record-stop"
                onClick={() => recorder.stop()}
                disabled={state === 'stopping'}
              >
                <Square size={15} fill="currentColor" />{' '}
                {state === 'requesting' ? 'Cancel' : 'Stop & keep take'}
              </Button>
              {state === 'recording' && (
                <Button onClick={() => recorder.pause()}>
                  <Pause size={15} /> Pause
                </Button>
              )}
              {state === 'paused' && (
                <Button onClick={() => recorder.resume()}>
                  <Play size={15} /> Resume
                </Button>
              )}
            </>
          ) : (
            <Button
              className="primary"
              disabled={saving || !name.trim()}
              onClick={() => {
                setError('');
                setPeak(false);
                void recorder.start(device, monitor);
              }}
            >
              <Mic size={16} /> Record take
            </Button>
          )}
        </div>
        <p className="help">
          Each take is saved separately on this device. Recording stops at 2 minutes, when this
          dialog closes, or when the tab is hidden.
        </p>
      </div>
    </Modal>
  );
}
