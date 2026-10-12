import type { Cleanup, ExportSettings } from '../domain/model';
export type AudioWork =
  | {
      kind: 'prepare';
      channels: Float32Array<ArrayBuffer>[];
      sampleRate: number;
      cleanup: Cleanup;
      reverse: boolean;
      pitch: number;
    }
  | { kind: 'master'; channels: Float32Array<ArrayBuffer>[]; normalize: boolean; limiter: boolean }
  | {
      kind: 'encode';
      channels: Float32Array<ArrayBuffer>[];
      sampleRate: number;
      format: ExportSettings['format'];
    };
export type AudioWorkResult =
  | { kind: 'prepare'; channels: Float32Array<ArrayBuffer>[] }
  | { kind: 'master'; channels: Float32Array<ArrayBuffer>[]; peak: number; limitedSamples: number }
  | { kind: 'encode'; blob: Blob };
